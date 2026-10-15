// The sync proxy: a user-configured outbound proxy server (HTTP/HTTPS/SOCKS5)
// that the desktop app's sync traffic connects through. Extracted as pure
// decision functions in the proxyUrlPolicy.ts style: the config shape, its
// validation, the Chromium proxy rules it compiles to, and the settings
// snapshot all live here, tested. Disk, the dedicated session and the IPC live
// in main.ts.
//
// WHAT IT COVERS, AND WHAT IT DELIBERATELY DOES NOT
//
// Everything that funnels through the `proxy-fetch` IPC (WebDAV/Nextcloud,
// CalDAV/ICS, GLANCEvault REST, intents, roster, auto-backup) is issued, WHEN
// THE FEATURE IS ON, by main.ts from ONE dedicated session (`sync-proxy`,
// in-memory). Pointing that session's proxy at the user's server is the whole
// feature: no request call site changes, and everything else — vault SSE (a
// streaming renderer fetch the IPC proxy cannot carry), AI, weather, update
// checks — stays on the default session. So it is UNAFFECTED by this setting,
// which is not the same claim as "direct": the default session follows the OS
// proxy configuration either way. That is also why OFF uses net.fetch exactly
// as it always did (see transportFor) — for someone whose sync reaches its
// server through a corporate proxy today, that IS the working path.
//
// Naming: this is the THIRD "proxy" in the codebase, after the hosted relay
// (api/webdav-proxy.js) and the main process's own IPC proxy (`proxy-fetch`).
// "Sync proxy" always means the outbound proxy server setting; never reuse
// plain "proxy" for it in user-facing strings or channel names.
//
// SSRF INTERACTION. The guard in proxyUrlPolicy.ts still runs BEFORE every
// request, and this feature does not widen it: a target that resolves into a
// private or reserved range is refused until its origin is granted, whether or
// not a proxy is configured. What changes is what that answer MEANS. The guard
// judges the target by THIS machine's DNS, while an HTTP or SOCKS5 proxy
// resolves the target hostname on the proxy side (Chromium defers name
// resolution to the proxy), so with the proxy enabled the guard has checked an
// address that is not necessarily the one the proxy connects to. The proxy is
// the user's own, configured on the user's own machine, so that is an accepted
// trust boundary — but it is a real difference, and saying "unchanged" would
// oversell it. Two consequences follow:
//
//   1. Trusted-host grants are NOT auto-merged into the bypass list, and the
//      consent itself is required in BOTH private-address modes: a proxy is the
//      user's own, not a licence to reach private space.
//   2. Private addresses are a CHOICE, not a rule — because Chromium resolves a
//      proxy from URL text, before any DNS or connection, it cannot tell "I am
//      on that LAN, send me direct" from "I am away, that address is only
//      reachable through this proxy". The same 192.168.1.50 wants opposite
//      answers, and whichever blanket rule won would silently break the other
//      half. `privateAddresses` is that choice; its default is the safe one.
//      Loopback bypasses in both modes (see LOOPBACK_BYPASS_RULES).
//
// Bypass rules are matched against the URL's host before any name resolution,
// so an IP range only matches a URL written as an IP literal. That is why the
// direct mode carries both the ranges (for `http://192.168.1.10:5005`) and
// `<local>` / `*.local` (for the simple and mDNS hostnames a LAN server usually
// has), and why the UI asks for a hostname pattern when the machine is reached
// by a dotted name.
//
// NO CREDENTIALS, ON PURPOSE. Chromium's `user:pass@host` proxy-rule form is
// not honored for authentication, and the `login` event is documented for
// webContents and utility processes — not for a main-process session.fetch —
// so an authenticated proxy cannot be answered reliably from here. Anyone who
// needs one runs a local proxy client in front of it. Nothing in this file
// stores a secret, so there is no password file, no keychain question and no
// auth handler.

export type SyncProxyScheme = 'http' | 'https' | 'socks5';

/**
 * Which transport a sync request takes. `system` is the request going out
 * exactly as it did before this feature existed: `net.fetch` on the default
 * session, which follows the OS proxy configuration (system, PAC, auto-detect).
 * `proxy-session` is the dedicated session this feature configures.
 */
export type SyncProxyTransport = 'system' | 'proxy-session';

/**
 * What to do with private and link-local addresses while a proxy is configured.
 * `direct` bypasses the proxy for them (the safe default: a home NAS an
 * external proxy cannot reach); `proxy` sends them anyway, which is the shape
 * of a proxy sitting INSIDE the target network.
 */
export type SyncProxyPrivateMode = 'direct' | 'proxy';

export interface SyncProxyConfig {
  enabled: boolean;
  scheme: SyncProxyScheme;
  /** Lowercase hostname or bare IP literal (IPv6 without brackets). */
  host: string;
  port: number;
  /** How private and link-local addresses are routed. See SyncProxyPrivateMode. */
  privateAddresses: SyncProxyPrivateMode;
  /**
   * Extra Chromium proxyBypassRules entries the user asked for, verbatim.
   * The always-bypassed rules are prepended by bypassRulesFor and never stored
   * here, so the user's list stays exactly what they typed.
   */
  bypassRules: string[];
}

/** What the renderer's settings UI sees. */
export interface SyncProxySnapshot {
  active: boolean;
  scheme: SyncProxyScheme;
  host: string;
  port: number;
  privateAddresses: SyncProxyPrivateMode;
  bypassRules: string[];
}

export function defaultSyncProxyConfig(): SyncProxyConfig {
  return { enabled: false, scheme: 'http', host: '', port: 0, privateAddresses: 'direct', bypassRules: [] };
}

const MAX_HOST_LENGTH = 253;
const MAX_BYPASS_ENTRIES = 20;
const MAX_BYPASS_LENGTH = 200;

/**
 * Rules no proxy may intercept, in EITHER private-address mode. Loopback is the
 * one the review on #2082 pinned: Chromium treats it as a secure origin, and
 * letting a user-configured proxy reach it grants powers the web platform does
 * not. `<local>` lives here too because it is not a private range at all —
 * Chromium documents it as dot-less hostnames, which is how a bare
 * `http://nas:5005` is written.
 */
export const LOOPBACK_BYPASS_RULES: readonly string[] = [
  '<local>',
  '127.0.0.0/8',
  '[::1]',
];

/**
 * Added only in `direct` mode: RFC1918, both link-local families and the mDNS
 * suffix. A user whose proxy sits INSIDE the target network turns these off by
 * choosing `proxy` — for them, bypassing is the failure.
 */
export const PRIVATE_BYPASS_RULES: readonly string[] = [
  '*.local',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
];

/**
 * Coerce whatever arrived over IPC (or off disk) into a validated config.
 * Anything malformed fails CLOSED: the caller keeps the previous config, so a
 * bad payload can never enable a half-parsed proxy or inject rules. Unknown keys
 * are dropped, which is what lets a settings file written by the build that
 * still had credentials load as the credential-less shape.
 */
export function parseSyncProxyConfig(raw: unknown): { ok: true; config: SyncProxyConfig } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Invalid proxy settings' };
  const source = raw as Record<string, unknown>;

  const enabled = source.enabled === true;

  const schemeRaw = typeof source.scheme === 'string' ? source.scheme.toLowerCase() : '';
  if (schemeRaw !== 'http' && schemeRaw !== 'https' && schemeRaw !== 'socks5') {
    return { ok: false, reason: 'Proxy type must be http, https or socks5' };
  }

  const hostRaw = typeof source.host === 'string' ? source.host.trim().toLowerCase() : '';
  if (!hostRaw || /\s/.test(hostRaw) || hostRaw.length > MAX_HOST_LENGTH) {
    return { ok: false, reason: 'Enter the proxy server\'s hostname or IP address' };
  }

  const portRaw = source.port;
  const port = typeof portRaw === 'number' ? portRaw : typeof portRaw === 'string' ? Number(portRaw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'Enter a port between 1 and 65535' };
  }

  // Absent means the default, so a file written before this choice existed
  // loads instead of failing closed into "no proxy at all". PRESENT but wrong
  // still fails closed — silently coercing garbage to `direct` would quietly
  // reroute a user who meant `proxy`.
  let privateAddresses: SyncProxyPrivateMode = 'direct';
  if (source.privateAddresses !== undefined) {
    const privateRaw = typeof source.privateAddresses === 'string'
      ? source.privateAddresses.toLowerCase()
      : '';
    if (privateRaw !== 'direct' && privateRaw !== 'proxy') {
      return { ok: false, reason: 'Private addresses must connect directly or through the proxy' };
    }
    privateAddresses = privateRaw;
  }

  const bypassRules: string[] = [];
  if (source.bypassRules !== undefined) {
    if (!Array.isArray(source.bypassRules)) return { ok: false, reason: 'Bypass rules must be a list' };
    for (const entry of source.bypassRules) {
      if (typeof entry !== 'string' || !entry.trim() || entry.length > MAX_BYPASS_LENGTH) {
        return { ok: false, reason: 'Each bypass rule must be a non-empty rule of at most 200 characters' };
      }
      bypassRules.push(entry.trim());
    }
    if (bypassRules.length > MAX_BYPASS_ENTRIES) {
      return { ok: false, reason: `At most ${MAX_BYPASS_ENTRIES} bypass rules are allowed` };
    }
  }

  return {
    ok: true,
    config: { enabled, scheme: schemeRaw, host: hostRaw, port, privateAddresses, bypassRules },
  };
}

/**
 * Read the settings file off disk. A missing, corrupt or unrecognised file
 * yields the DISABLED default — the failure direction forgets the user's
 * proxy, it never invents one (mirrors parseTrustedHosts).
 */
export function parseSyncProxySettingsFile(raw: string): SyncProxyConfig {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return defaultSyncProxyConfig(); }
  const parsed = parseSyncProxyConfig(data);
  return parsed.ok ? parsed.config : defaultSyncProxyConfig();
}

/**
 * True when a settings file still carries the credentials this version no
 * longer supports. The parsed config drops them either way, but dropping them
 * from memory leaves a plaintext password on disk, so main.ts rewrites the file
 * once on startup instead.
 */
export function fileCarriesCredentials(raw: string): boolean {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return false; }
  if (!data || typeof data !== 'object') return false;
  const source = data as Record<string, unknown>;
  return typeof source.username === 'string' || typeof source.password === 'string';
}

/**
 * The transport a sync request takes. OFF must be today's code path exactly: a
 * machine whose OS proxy is what carries sync today must keep working after
 * this ships without ever opening the settings, so the dedicated session is not
 * used — and not even created — while the toggle is off.
 */
export function transportFor(config: SyncProxyConfig): SyncProxyTransport {
  return config.enabled ? 'proxy-session' : 'system';
}

/**
 * Chromium proxyRules for the dedicated session. Scheme-specific rules are not
 * needed — one server handles every scheme — and this version carries no
 * credentials, so nothing else is embedded here.
 */
export function proxyRulesFor(config: SyncProxyConfig): string {
  const host = config.host.includes(':') ? `[${config.host}]` : config.host;
  return `${config.scheme}://${host}:${config.port}`;
}

/**
 * Chromium proxyBypassRules for the given config: loopback always, the private
 * and link-local ranges only in `direct` mode, then the user's own rules,
 * de-duplicated. Trusted-host grants are NOT merged (see header).
 */
export function bypassRulesFor(config: SyncProxyConfig): string {
  const rules = config.privateAddresses === 'proxy'
    ? [...LOOPBACK_BYPASS_RULES, ...config.bypassRules]
    : [...LOOPBACK_BYPASS_RULES, ...PRIVATE_BYPASS_RULES, ...config.bypassRules];
  return [...new Set(rules)].join(',');
}

/** The settings UI's view: exactly what the user configured, nothing derived. */
export function snapshotFor(config: SyncProxyConfig): SyncProxySnapshot {
  return {
    active: config.enabled,
    scheme: config.scheme,
    host: config.host,
    port: config.port,
    privateAddresses: config.privateAddresses,
    bypassRules: [...config.bypassRules],
  };
}
