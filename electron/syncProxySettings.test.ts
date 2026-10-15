import { describe, it, expect } from 'vitest';
import {
  defaultSyncProxyConfig,
  parseSyncProxyConfig,
  parseSyncProxySettingsFile,
  fileCarriesCredentials,
  transportFor,
  proxyRulesFor,
  bypassRulesFor,
  snapshotFor,
  LOOPBACK_BYPASS_RULES,
  PRIVATE_BYPASS_RULES,
  type SyncProxyConfig,
} from './syncProxySettings.js';

// The sync proxy's rules under test: a malformed payload fails CLOSED (the
// caller keeps the previous config), a corrupt settings file yields the
// DISABLED default (never an invented proxy), OFF keeps the pre-feature
// transport, and the Chromium rules compiled from a valid config carry no
// credential — this version stores no secret at all.

const valid = (over: Partial<SyncProxyConfig> = {}): SyncProxyConfig => ({
  enabled: true,
  scheme: 'http',
  host: 'proxy.example.com',
  port: 8080,
  privateAddresses: 'direct',
  bypassRules: [],
  ...over,
});

describe('parseSyncProxyConfig', () => {
  it('accepts a valid http config and normalises the host', () => {
    const parsed = parseSyncProxyConfig({ ...valid(), host: ' Proxy.Example.COM ' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.host).toBe('proxy.example.com');
      expect(parsed.config.enabled).toBe(true);
    }
  });

  it('accepts the three schemes and nothing else', () => {
    for (const scheme of ['http', 'https', 'socks5']) {
      expect(parseSyncProxyConfig(valid({ scheme })).ok).toBe(true);
    }
    expect(parseSyncProxyConfig(valid({ scheme: 'socks4' })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ scheme: 'ftp' })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ scheme: 5 })).ok).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(parseSyncProxyConfig(null).ok).toBe(false);
    expect(parseSyncProxyConfig('proxy').ok).toBe(false);
    expect(parseSyncProxyConfig(undefined).ok).toBe(false);
  });

  it('rejects a host that is empty, spaced, or implausibly long', () => {
    expect(parseSyncProxyConfig(valid({ host: '' })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ host: 'proxy example.com' })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ host: 'a'.repeat(254) })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ host: 'a'.repeat(253) })).ok).toBe(true);
  });

  it('rejects ports outside 1-65535, in both number and numeric-string form', () => {
    expect(parseSyncProxyConfig(valid({ port: 0 })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ port: 65536 })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ port: 3.5 })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ port: '8080' })).ok).toBe(true);
    expect(parseSyncProxyConfig(valid({ port: 'eight' })).ok).toBe(false);
  });

  it('drops credentials a previous build stored, rather than failing the load', () => {
    // The pre-release build shipped username/password fields, so a real user's
    // file can carry them. Failing CLOSED here would silently disable their
    // proxy; keeping them would keep a secret in memory this version cannot use.
    const parsed = parseSyncProxyConfig({ ...valid(), username: 'user', password: 'hunter2' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config).not.toHaveProperty('username');
      expect(parsed.config).not.toHaveProperty('password');
      expect(JSON.stringify(parsed.config)).not.toContain('hunter2');
    }
  });

  it('accepts both private-address modes and defaults an absent one to direct', () => {
    expect(parseSyncProxyConfig(valid({ privateAddresses: 'proxy' }))).toEqual({
      ok: true, config: valid({ privateAddresses: 'proxy' }),
    });
    const absent = parseSyncProxyConfig({ ...valid(), privateAddresses: undefined });
    if (absent.ok) expect(absent.config.privateAddresses).toBe('direct');
    expect(parseSyncProxyConfig(valid({ privateAddresses: 'bypass' })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ privateAddresses: 1 })).ok).toBe(false);
  });

  it('validates bypass rules and rejects list-shaped garbage', () => {
    const parsed = parseSyncProxyConfig(valid({ bypassRules: ['192.168.0.0/24', '*.internal'] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config.bypassRules).toEqual(['192.168.0.0/24', '*.internal']);
    expect(parseSyncProxyConfig(valid({ bypassRules: '192.168.0.0/24' })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ bypassRules: [''] })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ bypassRules: ['x'.repeat(201)] })).ok).toBe(false);
    expect(parseSyncProxyConfig(valid({ bypassRules: Array(21).fill('a') })).ok).toBe(false);
  });
});

describe('parseSyncProxySettingsFile', () => {
  it('round-trips a written config', () => {
    const config = valid({ bypassRules: ['10.0.0.0/8'] });
    const parsed = parseSyncProxySettingsFile(JSON.stringify(config));
    expect(parsed).toEqual(config);
  });

  it('loads a credential-bearing file from an earlier build without them', () => {
    const loaded = parseSyncProxySettingsFile(JSON.stringify({ ...valid(), username: 'u', password: 'p' }));
    expect(loaded).toEqual(valid());
  });

  it('yields the DISABLED default for a corrupt file', () => {
    const parsed = parseSyncProxySettingsFile('{ not json');
    expect(parsed).toEqual(defaultSyncProxyConfig());
    expect(parsed.enabled).toBe(false);
  });

  it('yields the DISABLED default for a structurally wrong file', () => {
    expect(parseSyncProxySettingsFile('[]')).toEqual(defaultSyncProxyConfig());
    expect(parseSyncProxySettingsFile(JSON.stringify({ enabled: true }))).toEqual(defaultSyncProxyConfig());
  });
});

describe('fileCarriesCredentials', () => {
  it('spots the keys an earlier build wrote', () => {
    expect(fileCarriesCredentials(JSON.stringify(valid()))).toBe(false);
    expect(fileCarriesCredentials(JSON.stringify({ ...valid(), password: 'p' }))).toBe(true);
    expect(fileCarriesCredentials(JSON.stringify({ ...valid(), username: 'u' }))).toBe(true);
  });

  it('is false for a file it cannot parse, so startup never rewrites garbage', () => {
    expect(fileCarriesCredentials('{ not json')).toBe(false);
    expect(fileCarriesCredentials('[]')).toBe(false);
  });
});

describe('transportFor', () => {
  it('keeps OFF on the pre-feature path: the default session, OS proxy included', () => {
    // The one behaviour this feature must never change: a user syncing through
    // a corporate or system proxy today must not lose sync on update without
    // touching the setting, so OFF means `net.fetch`, not a forced-direct
    // dedicated session.
    expect(transportFor(defaultSyncProxyConfig())).toBe('system');
    expect(transportFor(valid({ enabled: false }))).toBe('system');
  });

  it('uses the dedicated session only when the proxy is enabled', () => {
    expect(transportFor(valid())).toBe('proxy-session');
    expect(transportFor(valid({ scheme: 'socks5' }))).toBe('proxy-session');
  });
});

describe('proxyRulesFor', () => {
  it('formats each scheme with its port', () => {
    expect(proxyRulesFor(valid())).toBe('http://proxy.example.com:8080');
    expect(proxyRulesFor(valid({ scheme: 'https', port: 443 }))).toBe('https://proxy.example.com:443');
    expect(proxyRulesFor(valid({ scheme: 'socks5', host: 'proxy.example.com', port: 1080 })))
      .toBe('socks5://proxy.example.com:1080');
  });

  it('brackets IPv6 literals, which Chromium requires', () => {
    expect(proxyRulesFor(valid({ host: '::1', port: 8080 }))).toBe('http://[::1]:8080');
  });
});

describe('bypassRulesFor', () => {
  // Both modes, per the #2082 thread: the review asked for the private ranges
  // to be bypassed always, then agreed they must be a choice, because a proxy
  // sitting INSIDE the target network is reached THROUGH those addresses.
  it('DIRECT mode bypasses the private and link-local space an external proxy cannot reach', () => {
    const rules = bypassRulesFor(valid({ privateAddresses: 'direct' }));
    for (const required of [...LOOPBACK_BYPASS_RULES, ...PRIVATE_BYPASS_RULES]) {
      expect(rules).toContain(required);
    }
    // `<local>` alone is NOT "local addresses": Chromium documents it as
    // dot-less hostnames, and its implicit list stops at loopback and
    // link-local — so 10.x, 172.16-31.x and 192.168.x need explicit rules.
    expect(rules).toContain('192.168.0.0/16');
    expect(rules).toContain('10.0.0.0/8');
    expect(rules).toContain('172.16.0.0/12');
    expect(rules).toContain('169.254.0.0/16');
    expect(rules).toContain('fc00::/7');
    expect(rules).toContain('*.local');
  });

  it('PROXY mode sends the private ranges to the proxy — the away-from-home case', () => {
    const rules = bypassRulesFor(valid({ privateAddresses: 'proxy' }));
    for (const privateRule of PRIVATE_BYPASS_RULES) expect(rules).not.toContain(privateRule);
  });

  it('bypasses loopback in BOTH modes, which is not offered as a choice', () => {
    for (const mode of ['direct', 'proxy'] as const) {
      const rules = bypassRulesFor(valid({ privateAddresses: mode }));
      for (const required of LOOPBACK_BYPASS_RULES) expect(rules).toContain(required);
      expect(rules.startsWith('<local>')).toBe(true);
    }
  });

  it('appends the user rules and de-duplicates against the built-ins', () => {
    const builtIns = [...LOOPBACK_BYPASS_RULES, ...PRIVATE_BYPASS_RULES].join(',');
    expect(bypassRulesFor(valid({ bypassRules: ['192.168.0.0/24', '*.internal'] })))
      .toBe(`${builtIns},192.168.0.0/24,*.internal`);
    expect(bypassRulesFor(valid({ bypassRules: ['10.0.0.0/8', '*.lan'] })))
      .toBe(`${builtIns},*.lan`);
    // In PROXY mode a rule the user typed by hand still means what it says.
    expect(bypassRulesFor(valid({ privateAddresses: 'proxy', bypassRules: ['10.0.0.0/8'] })))
      .toBe(`${LOOPBACK_BYPASS_RULES.join(',')},10.0.0.0/8`);
  });

  it('never emits a subtractive rule, which would undo the loopback guarantee', () => {
    expect(bypassRulesFor(valid({ bypassRules: ['*.example.com'] }))).not.toContain('<-');
  });
});

describe('snapshotFor', () => {
  it('exposes exactly what the user configured', () => {
    expect(snapshotFor(valid({ bypassRules: ['*.internal'] }))).toEqual({
      active: true,
      scheme: 'http',
      host: 'proxy.example.com',
      port: 8080,
      privateAddresses: 'direct',
      bypassRules: ['*.internal'],
    });
  });

  it('carries no secret and no derived bypass rules', () => {
    const snapshot = snapshotFor(valid());
    expect(snapshot).not.toHaveProperty('password');
    expect(snapshot).not.toHaveProperty('hasCredentials');
    expect(JSON.stringify(snapshot)).not.toContain('hunter2');
    expect(snapshot.bypassRules).toEqual([]);
  });

  it('copies the bypass rules so a caller cannot mutate the config', () => {
    const config = valid({ bypassRules: ['10.0.0.0/8'] });
    const snapshot = snapshotFor(config);
    snapshot.bypassRules.push('*.evil');
    expect(config.bypassRules).toEqual(['10.0.0.0/8']);
  });
});
