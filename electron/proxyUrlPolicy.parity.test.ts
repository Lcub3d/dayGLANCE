import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, isNeverExemptibleIp } from './proxyUrlPolicy.js';
// @ts-expect-error - plain JS module, no type declarations
import { classifyAddress } from '../api/_ssrfGuard.mjs';

// dayGLANCE judges addresses in two places that must not disagree:
//
//   electron/proxyUrlPolicy.ts  the desktop app's IPC proxy (issue #1642)
//   api/_ssrfGuard.mjs          the four server-side proxies (issue #1664)
//
// They are separate modules on purpose — one is strict TypeScript compiled into
// the Electron main bundle, the other is plain ESM copied into a Docker image
// and bundled by Vercel — but they encode the SAME table, and a range added to
// one and forgotten in the other is exactly the drift that left four divergent
// copies of this logic in the repo to begin with.
//
// The mapping is exact:
//   classify === 'ok'      → neither private nor never-exemptible
//   classify === 'private' → private, but grantable
//   classify === 'always'  → private AND never exemptible
//
// If this fails, do not relax it: make the two tables agree.

const ADDRESSES = [
  // public
  '8.8.8.8', '1.1.1.1', '203.0.113.10', '172.15.0.1', '172.32.0.1',
  '100.63.255.255', '100.128.0.0', '2606:4700::1111', '::ffff:8.8.8.8',
  // private, grantable
  '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.254',
  '192.168.0.1', '192.168.255.255', '127.0.0.1', '127.1.2.3',
  '100.64.0.0', '100.101.102.103', '100.127.255.255',
  '::1', 'fd00::1', 'fc00::1', 'fd7a:115c:a1e0::1',
  '::ffff:127.0.0.1', '::ffff:10.0.0.5', '::ffff:7f00:1',
  // always blocked
  '0.0.0.0', '0.1.2.3', '169.254.169.254', '169.254.0.1',
  '192.0.0.1', '192.0.0.255', '198.18.0.1', '198.19.255.255',
  '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  '::', 'fe80::1', 'feb0::1', 'ff02::1',
  '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:0.0.0.0',
];

describe('desktop policy and proxy guard agree on every address', () => {
  it.each(ADDRESSES)('%s', (ip) => {
    const family = ip.includes(':') ? 6 : 4;
    const cls = classifyAddress(ip, family) as 'ok' | 'private' | 'always';

    expect({ ip, private: isPrivateOrReservedIp(ip), never: isNeverExemptibleIp(ip) })
      .toEqual({ ip, private: cls !== 'ok', never: cls === 'always' });
  });

  it('never marks an address exemptible-but-public, in either module', () => {
    for (const ip of ADDRESSES) {
      if (isNeverExemptibleIp(ip)) expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it('refuses the mapped metadata endpoint that used to be grantable', () => {
    // Regression pin. Before the tables were aligned, ::ffff:169.254.169.254
    // read as merely "private" on the desktop side, so a user could consent to
    // the cloud metadata endpoint by spelling it in IPv4-mapped form.
    expect(isNeverExemptibleIp('::ffff:169.254.169.254')).toBe(true);
    expect(isNeverExemptibleIp('::ffff:a9fe:a9fe')).toBe(true);
  });
});
