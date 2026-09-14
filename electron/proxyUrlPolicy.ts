// SSRF policy for the renderer's IPC proxy (main.ts `proxy-fetch`), extracted as
// pure decision functions in the localIntegrations.ts style: the ranges, the
// never-exemptible set, the trusted-host record shape and the allow/deny/consent
// decision all live here, tested; DNS, disk and the consent dialog live in main.ts.
//
// WHY THIS IS NOT A FLAT BLOCK (issue #1642)
//
// The proxy used to reject every private, loopback, link-local, CGNAT or ULA
// address outright. On a hosted relay (api/webdav-proxy.js, docker/proxy-server.js)
// that is correct and stays correct: those run on someone else's network and a
// flat block is the only thing standing between a stranger's URL and the
// operator's internal services.
//
// The Electron proxy is a different machine with a different threat model. It
// runs on the user's own desktop, and the whole point of a self-hosted
// GLANCEvault is that it lives on the user's own network: a LAN box on
// 192.168.x.x, a Docker host on 10.x.x.x, or a Tailscale node, whose addresses
// are CGNAT (100.64.0.0/10) and ULA (fd7a:115c:a1e0::/48) and so hit two of the
// blocked ranges at once. A flat block there does not protect the user from a
// stranger; it locks the user out of their own server on desktop ONLY, while
// Android/iOS (native HTTP bridge) and the browser build reach it fine.
//
// So the range check stays, and an address in one of those ranges is still
// refused by default. What changes is that the user can grant one specific
// host:port an exemption, through a native dialog main.ts raises from an
// explicit button press. Three properties keep that from being a hole:
//
//   1. Consent is per host:port:scheme, never per range, and never a wildcard.
//   2. Redirect targets are NEVER exempt, whatever is on the list. A public URL
//      that 302s into private space is the classic SSRF shape and the one this
//      guard exists for; a grant for the vault must not also buy a redirect hop
//      from some unrelated calendar feed. Callers pass `isRedirect: true`.
//   3. Loopback and link-local are never exemptible at all (see NEVER_EXEMPTIBLE).

/** A granted exemption. Scoped to one origin, never to a range. */
export interface TrustedHost {
  /** Lowercased hostname or bare IP literal (IPv6 without brackets). */
  host: string;
  /** 'http:' or 'https:'. A grant for one scheme does not cover the other. */
  protocol: string;
  /** Port as written, or '' for the scheme default. */
  port: string;
  /** ISO timestamp of the user's consent. */
  grantedAt: string;
  /** Addresses the host resolved to when consent was given, for the settings list. */
  addresses: string[];
}

export interface TrustedHostsFile {
  version: 1;
  hosts: TrustedHost[];
}

/** The origin an exemption is keyed by. */
export interface HostKey {
  host: string;
  protocol: string;
  port: string;
}

export function defaultTrustedHosts(): TrustedHostsFile {
  return { version: 1, hosts: [] };
}

// True for an IP address (v4 or v6 literal, no brackets) that is loopback,
// private (RFC1918), link-local, CGNAT, or otherwise reserved. Shared by the
// literal-host path and the DNS-resolution path so both judge the same ranges.
export function isPrivateOrReservedIp(ip: string): boolean {
  const h = ip.toLowerCase();

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  return (
    h === '::1' || h === '::' ||
    /^::ffff:/i.test(h) || /^fe80:/i.test(h) ||
    /^fc/i.test(h)      || /^fd/i.test(h)
  );
}

// Addresses NO consent can unlock, because nothing a user would legitimately
// call a vault lives there and every one of them is a known SSRF prize:
//
//   127.0.0.0/8, ::1, ::   loopback. Every other app's unauthenticated local
//                          API is here (model runners, database admin UIs, and
//                          dayGLANCE's own MCP listener). Note this preserves
//                          the pre-#1642 behaviour exactly: `localhost` and
//                          `0.0.0.0` were already refused by name. A vault on
//                          the same machine as the desktop app is therefore
//                          still out of reach; if that turns out to be a real
//                          deployment, moving loopback out of this function is
//                          the whole change.
//   169.254.0.0/16, fe80::/10  link-local, which carries the cloud metadata
//                          endpoint 169.254.169.254 (instance credentials).
//   0.0.0.0/8              "this network"; 0.0.0.0 is a common loopback alias.
//
// Everything else private (RFC1918, CGNAT/Tailscale, ULA) is refused by default
// but CAN be granted per origin.
export function isNeverExemptibleIp(ip: string): boolean {
  const h = ip.toLowerCase();

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }

  return h === '::1' || h === '::' || /^fe80:/i.test(h);
}

/**
 * Parse a URL into the origin an exemption is keyed by.
 * Returns null for anything not an http(s) URL.
 */
export function hostKeyOf(urlString: string): HostKey | null {
  let parsed: URL;
  try { parsed = new URL(urlString); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const lower = parsed.hostname.toLowerCase();
  // URL keeps the brackets on IPv6 literals (e.g. "[::1]"); strip them so the
  // stored key matches what the range checks and net.isIP see.
  const host = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  return { host, protocol: parsed.protocol, port: parsed.port };
}

export function sameHostKey(a: HostKey, b: HostKey): boolean {
  return a.host === b.host && a.protocol === b.protocol && a.port === b.port;
}

export function findTrustedHost(file: TrustedHostsFile, key: HostKey): TrustedHost | null {
  return file.hosts.find((h) => sameHostKey(h, key)) ?? null;
}

/** Add or replace a grant. Re-granting refreshes the timestamp and addresses. */
export function grantTrustedHost(file: TrustedHostsFile, entry: TrustedHost): TrustedHostsFile {
  return {
    version: 1,
    hosts: [...file.hosts.filter((h) => !sameHostKey(h, entry)), entry],
  };
}

export function revokeTrustedHost(file: TrustedHostsFile, key: HostKey): TrustedHostsFile {
  return { version: 1, hosts: file.hosts.filter((h) => !sameHostKey(h, key)) };
}

/**
 * Read a trusted-hosts file off disk into a usable value. A corrupt or
 * unrecognised file is treated as EMPTY, never as "allow": an exemption must
 * always trace back to a consent the user actually gave, so the failure
 * direction here is to forget grants, not to invent them.
 */
export function parseTrustedHosts(raw: string): TrustedHostsFile {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return defaultTrustedHosts(); }
  if (!data || typeof data !== 'object') return defaultTrustedHosts();

  const hostsRaw = (data as { hosts?: unknown }).hosts;
  if (!Array.isArray(hostsRaw)) return defaultTrustedHosts();

  const hosts: TrustedHost[] = [];
  for (const h of hostsRaw) {
    if (!h || typeof h !== 'object') continue;
    const { host, protocol, port, grantedAt, addresses } = h as Record<string, unknown>;
    if (typeof host !== 'string' || !host) continue;
    if (protocol !== 'http:' && protocol !== 'https:') continue;
    if (typeof port !== 'string') continue;
    // A grant for an address no consent could have covered is dropped rather
    // than honoured, so hand-editing the file cannot widen the policy.
    if (isNeverExemptibleIp(host)) continue;
    hosts.push({
      host: host.toLowerCase(),
      protocol,
      port,
      grantedAt: typeof grantedAt === 'string' ? grantedAt : '',
      addresses: Array.isArray(addresses) ? addresses.filter((a): a is string => typeof a === 'string') : [],
    });
  }
  return { version: 1, hosts };
}

export type ProxyUrlDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'needs-consent'; key: HostKey; addresses: string[] };

export interface DecideProxyUrlInput {
  urlString: string;
  /**
   * Every A/AAAA record the hostname resolved to, or the single literal when the
   * host is already an IP. main.ts owns the lookup so this stays pure.
   */
  resolvedAddresses: string[];
  trusted: TrustedHostsFile;
  /** True for a redirect target. Redirect hops are never exempt (see header). */
  isRedirect?: boolean;
}

/**
 * The whole policy in one place.
 *
 * `deny` reasons are the strings main.ts throws, so they are the strings the
 * renderer sees in the proxy's 400 body. 'Private/reserved address' is kept
 * verbatim from the pre-#1642 guard: it is what existing error paths match on.
 */
export function decideProxyUrl(input: DecideProxyUrlInput): ProxyUrlDecision {
  const { urlString, resolvedAddresses, trusted, isRedirect = false } = input;

  let parsed: URL;
  try { parsed = new URL(urlString); } catch { return { kind: 'deny', reason: 'Invalid URL' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'deny', reason: 'Only http and https URLs are allowed' };
  }
  const key = hostKeyOf(urlString)!;

  // Refused by name before any resolution, so a resolver that hands back a
  // public address for these cannot talk the policy into allowing them.
  if (key.host === 'localhost' || key.host === '0.0.0.0') {
    return { kind: 'deny', reason: 'Private/reserved address' };
  }

  const privateHits = resolvedAddresses.filter((a) => isPrivateOrReservedIp(a));
  if (privateHits.length === 0) return { kind: 'allow' };

  if (privateHits.some((a) => isNeverExemptibleIp(a))) {
    return { kind: 'deny', reason: 'Private/reserved address' };
  }

  // A public URL that redirects into private space is the attack this guard was
  // written for. No grant reaches here.
  if (isRedirect) return { kind: 'deny', reason: 'Private/reserved address' };

  if (findTrustedHost(trusted, key)) return { kind: 'allow' };

  return { kind: 'needs-consent', key, addresses: privateHits };
}

/**
 * Whether main.ts may offer the consent dialog for this URL at all. Called by
 * the `proxy-trust:request` IPC before any dialog is shown, so a URL that could
 * never be granted is refused without putting a pointless prompt on screen.
 */
export function canRequestConsent(
  urlString: string,
  resolvedAddresses: string[],
): { ok: true; key: HostKey; addresses: string[] } | { ok: false; reason: string } {
  const decision = decideProxyUrl({
    urlString,
    resolvedAddresses,
    trusted: defaultTrustedHosts(),
  });
  if (decision.kind === 'needs-consent') {
    return { ok: true, key: decision.key, addresses: decision.addresses };
  }
  if (decision.kind === 'allow') {
    // Nothing private about it, so there is nothing to grant.
    return { ok: false, reason: 'This address does not need permission.' };
  }
  return { ok: false, reason: decision.reason };
}

// The consent dialog's translated chrome. dayGLANCE ships eight languages and
// the main process holds no locale bundle, so the renderer passes the strings
// through with the request, the way the application menu already does
// (applicationMenu.ts). What the renderer CANNOT influence is the security
// content: the origin and the addresses it resolved to are composed by main.ts
// and appended positionally, never interpolated into a renderer template, so no
// label can reorder or hide them.
export interface ConsentLabels {
  title: string;
  question: string;
  resolvesTo: string;
  warning: string;
  scope: string;
  allow: string;
  cancel: string;
}

export const DEFAULT_CONSENT_LABELS: ConsentLabels = {
  title: 'Allow a private network address?',
  question: 'Allow dayGLANCE to connect to this address?',
  resolvesTo: 'It resolves to a private network address:',
  warning:
    'Only allow this if it is your own server, on your own network (a home or office LAN, '
    + 'a Docker host, or a VPN such as Tailscale). dayGLANCE will be able to reach it, and '
    + 'anything it returns becomes part of your data.',
  scope: 'This applies to this one address only. You can remove it later in Settings, under Cloud Sync.',
  allow: 'Allow',
  cancel: 'Cancel',
};

const MAX_LABEL_LENGTH = 400;

/**
 * Coerce whatever arrived over IPC into usable dialog chrome. Anything missing,
 * non-string, empty, or implausibly long falls back to the English default, so a
 * broken or absent labels payload still produces a readable prompt rather than
 * an empty or attacker-shaped one. Control characters are stripped: a label must
 * not be able to inject blank lines that push the origin out of view.
 */
export function sanitizeConsentLabels(raw: unknown): ConsentLabels {
  const source = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const out = { ...DEFAULT_CONSENT_LABELS };
  for (const field of Object.keys(DEFAULT_CONSENT_LABELS) as (keyof ConsentLabels)[]) {
    // Own properties only: a plain `source[field]` would read an inherited one,
    // so a payload carrying a prototype could supply the dialog's button text.
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (typeof value !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!cleaned || cleaned.length > MAX_LABEL_LENGTH) continue;
    out[field] = cleaned;
  }
  return out;
}

/** Render a grant's origin the way the dialog and the settings list show it. */
export function formatHostKey(key: HostKey): string {
  const scheme = key.protocol === 'https:' ? 'https' : 'http';
  const host = key.host.includes(':') ? `[${key.host}]` : key.host;
  return key.port ? `${scheme}://${host}:${key.port}` : `${scheme}://${host}`;
}
