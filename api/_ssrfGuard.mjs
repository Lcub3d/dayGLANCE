// Shared SSRF address guard for all three proxy entry points:
//   • api/webdav-proxy.js     (Vercel, hosted)      allowPrivate: false
//   • api/calendar-proxy.js   (Vercel, hosted)      allowPrivate: false
//   • docker/proxy-server.mjs (self-hosted image)   allowPrivate: true by default
//
// Ported from krelltunez/lifeGLANCE `proxy/ssrfGuard.js`, which had already
// worked this problem out. See issue #1664 for the comparison that led here.
//
// The leading underscore keeps Vercel from exposing this module as a serverless
// route of its own (same convention as _proxyGuard.js, which is a different
// concern: that one is the ORIGIN allowlist, this one is the TARGET address
// check). The .mjs extension is load-bearing: the repo is "type": "module", but
// the Docker image copies bare files into /app with no package.json beside them,
// where a .js file would be read as CommonJS. .mjs is ESM in both places.
//
// ── Why a three-way classification, not a boolean ──────────────────────────
// Every one of these proxies accepts a client-supplied target URL and forwards
// the user's Authorization header to it, so an unguarded one is an open relay.
// But "block everything private" and "check nothing" are both wrong answers for
// the self-hosted image: a self-hoster legitimately points it at a NAS on
// 192.168.x.x, a Docker host on 10.x, or a Tailscale node on 100.64/10, while
// nobody has a legitimate reason to reach the cloud metadata endpoint. Before
// #1664 the Docker proxy resolved that tension by checking nothing at all.
//
//   'always'  — never allowed, whatever the deployment: metadata/link-local,
//               multicast, reserved, benchmarking, IETF assignments, the
//               unspecified address. Nothing serves WebDAV or CalDAV here.
//   'private' — allowed only with allowPrivate: RFC1918, loopback, CGNAT, ULA.
//               A real destination for a self-hoster; a classic SSRF target on
//               a multi-tenant deployment.
//   'ok'      — everything else.
//
// ── What this does NOT do ──────────────────────────────────────────────────
// It does not pin the connection. lifeGLANCE's version exports a `pinnedLookup`
// for http.request's `lookup` option, so the socket reuses the addresses that
// were validated and DNS cannot be re-resolved to a different IP in between
// (rebinding). All three dayGLANCE proxies issue their request with global
// fetch, which has no lookup hook, so that window stays open here. Closing it
// means moving them off fetch onto http(s).request; see #1664.
import dns from 'node:dns';

export class SsrfError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SsrfError';
    this.status = status;
  }
}

// Parse a dotted-decimal IPv4 string to an unsigned 32-bit int, or null.
function ipv4ToInt(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function inV4Range(n, base, bits) {
  const baseInt = ipv4ToInt(base);
  const shift = 32 - bits;
  return (n >>> shift) === (baseInt >>> shift);
}

// Never a legitimate proxy target and the highest-value SSRF pivots (especially
// the cloud metadata endpoint at 169.254.169.254). ALWAYS blocked, even when a
// self-hoster has opted to allow private/LAN addresses.
function isAlwaysBlockedIPv4(n) {
  return (
    inV4Range(n, '0.0.0.0', 8) ||       // "this" network / 0.0.0.0
    inV4Range(n, '169.254.0.0', 16) ||  // link-local incl. 169.254.169.254 metadata
    inV4Range(n, '192.0.0.0', 24) ||    // IETF protocol assignments
    inV4Range(n, '198.18.0.0', 15) ||   // benchmarking
    inV4Range(n, '224.0.0.0', 4) ||     // multicast
    inV4Range(n, '240.0.0.0', 4)        // reserved / 255.255.255.255
  );
}

// Private / LAN ranges: a legitimate destination for a self-hoster syncing to
// their own NAS, but a classic SSRF target on a public deployment. Blocked
// unless the caller passes allowPrivate. Loopback is HERE rather than in the
// always-blocked set on purpose: a self-hoster running WebDAV on the same host
// (network_mode: host, or a sidecar) is a real deployment.
function isPrivateIPv4(n) {
  return (
    inV4Range(n, '10.0.0.0', 8) ||      // RFC 1918 private
    inV4Range(n, '100.64.0.0', 10) ||   // RFC 6598 CGNAT (Tailscale)
    inV4Range(n, '127.0.0.0', 8) ||     // loopback
    inV4Range(n, '172.16.0.0', 12) ||   // RFC 1918 private
    inV4Range(n, '192.168.0.0', 16)     // RFC 1918 private
  );
}

function classifyIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return 'ok';
  if (isAlwaysBlockedIPv4(n)) return 'always';
  if (isPrivateIPv4(n)) return 'private';
  return 'ok';
}

// Extract the embedded IPv4 from an IPv4-mapped IPv6 address, or null. The URL
// parser and dns.lookup emit the compressed hex form (::ffff:a9fe:a9fe), not the
// dotted form (::ffff:169.254.169.254), so handle both.
function mappedIPv4(s) {
  const m = s.match(/^::ffff:(.+)$/i);
  if (!m) return null;
  const rest = m[1];
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest)) return rest;
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

function classifyIPv6(ip) {
  const s = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const embedded = mappedIPv4(s);
  if (embedded) return classifyIPv4(embedded);
  if (s === '::') return 'always';               // unspecified
  if (/^fe[89ab]/.test(s)) return 'always';      // fe80::/10 link-local
  if (/^ff/.test(s)) return 'always';            // ff00::/8 multicast
  if (s === '::1') return 'private';             // loopback
  if (/^f[cd]/.test(s)) return 'private';        // fc00::/7 unique-local
  return 'ok';
}

export function classifyAddress(address, family) {
  return family === 6 ? classifyIPv6(address) : classifyIPv4(address);
}

/**
 * Validate a client-supplied target URL. Rejects a malformed URL, a non-http(s)
 * scheme, a DNS failure, or any resolved address the policy disallows.
 *
 * The hostname is RESOLVED and EVERY returned address is checked, rather than
 * pattern-matching the hostname string: that is what defeats "evil.com points at
 * 10.0.0.5". The WHATWG URL parser already canonicalises encoded IPv4 literals
 * (0x7f000001, 2130706433, 0177.0.0.1 all become 127.0.0.1), so those arrive
 * here as real addresses and are caught by the same check.
 *
 * @param {string} target
 * @param {{allowPrivate?: boolean}} [opts]
 * @returns {Promise<{url: URL, addresses: {address: string, family: number}[]}>}
 * @throws {SsrfError}
 */
export async function assertSafeUrl(target, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new SsrfError(400, 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(400, 'Only http and https URLs are allowed');
  }
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');

  let addresses;
  try {
    // Resolved through dns.promises at CALL time, not a reference captured at
    // import: a captured one cannot be substituted, which silently turns every
    // address-rejection test into a DNS-failure test that passes for the wrong
    // reason. (This is a deliberate deviation from lifeGLANCE's original.)
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new SsrfError(502, 'DNS resolution failed');
  }
  if (!addresses.length) {
    throw new SsrfError(502, 'DNS resolution failed');
  }
  for (const { address, family } of addresses) {
    const cls = classifyAddress(address, family);
    if (cls === 'always' || (cls === 'private' && !allowPrivate)) {
      throw new SsrfError(403, 'Private/reserved addresses are not allowed');
    }
  }
  return { url, addresses };
}
