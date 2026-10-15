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
// checks — stays direct. When the feature is OFF, `proxy-fetch` uses net.fetch
// exactly as it always did (see transportFor): the default session follows the
// OS proxy configuration, and for someone whose sync reaches its server
// through a corporate proxy today, that IS the working path.
//
// Naming: this is the THIRD "proxy" in the codebase, after the hosted relay
// (api/webdav-proxy.js) and the main process's own IPC proxy (`proxy-fetch`).
// "Sync proxy" always means the outbound proxy server setting; never reuse
// plain "proxy" for it in user-facing strings or channel names.
//
// SSRF INTERACTION. The guard in proxyUrlPolicy.ts runs BEFORE any connection
// and is unchanged: it judges the target by local DNS. A target that resolves
// to a private or reserved range is still refused until its origin is granted,
// whether or not a proxy is configured — the proxy changes where the connection
// comes from, never what is allowed to be connected to. One consequence is
// deliberate:
//
//   1. Trusted-host grants are NOT auto-merged into the bypass list. A granted
//      LAN vault must connect DIRECT (an external proxy usually cannot reach
//      it), but a granted public-looking origin whose local DNS is poisoned
//      into private space must go THROUGH the proxy — the two want opposite
//      bypass answers, so the user decides via the explicit bypass rules
//      instead of either one winning silently. `<local>` is always bypassed.
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

export interface SyncProxyConfig {
  enabled: boolean;
  scheme: SyncProxyScheme;
  /** Lowercase hostname or bare IP literal (IPv6 without brackets). */
  host: string;
  port: number;
  /**
   * Extra Chromium proxyBypassRules entries the user asked for, verbatim.
   * `<local>` is always prepended by bypassRulesFor and never stored here.
   */
  bypassRules: string[];
}

/** What the renderer's settings UI sees. */
export interface SyncProxySnapshot {
  active: boolean;
  scheme: SyncProxyScheme;
  host: string;
  port: number;
  bypassRules: string[];
}

export function defaultSyncProxyConfig(): SyncProxyConfig {
  return { enabled: false, scheme: 'http', host: '', port: 0, bypassRules: [] };
}

const MAX_HOST_LENGTH = 253;
const MAX_BYPASS_ENTRIES = 20;
const MAX_BYPASS_LENGTH = 200;

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
    config: { enabled, scheme: schemeRaw, host: hostRaw, port, bypassRules },
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
 * Chromium proxyBypassRules. `<local>` always bypasses: localhost targets are
 * exactly the destinations an external proxy can rarely reach and the ones the
 * guard's loopback grant exists for (issue #1642). The user's own rules come
 * after; trusted-host grants are NOT merged (see header).
 */
export function bypassRulesFor(config: SyncProxyConfig): string {
  return ['<local>', ...config.bypassRules].join(',');
}

/** The settings UI's view: exactly what the user configured, nothing derived. */
export function snapshotFor(config: SyncProxyConfig): SyncProxySnapshot {
  return {
    active: config.enabled,
    scheme: config.scheme,
    host: config.host,
    port: config.port,
    bypassRules: [...config.bypassRules],
  };
}
