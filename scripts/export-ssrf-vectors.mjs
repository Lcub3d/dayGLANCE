#!/usr/bin/env node
// Writes the canonical SSRF address-policy vectors to api/ssrf-vectors.json.
//
// WHY THIS FILE EXISTS
//
// The same address table is implemented four times across three repositories:
//
//   krelltunez/dayGLANCE    api/_ssrfGuard.mjs         (four proxies)
//                           electron/proxyUrlPolicy.ts (desktop IPC proxy)
//   krelltunez/lastGLANCE   api/webdav-proxy.js
//   krelltunez/lifeGLANCE   proxy/ssrfGuard.js
//
// They are separate on purpose (strict TypeScript compiled into an Electron
// bundle; plain ESM copied into a Docker image; a Vercel function), but a range
// added to one and forgotten in another is the drift that produced four
// divergent copies in the first place. This mirrors the dayDial vectors pattern
// (scripts/export-dial-vectors.mjs): one committed file of expected results,
// and a test in each repo that fails when its implementation stops matching.
//
// WHAT IT DOES AND DOES NOT CATCH
//
// Catches: an implementation drifting from the agreed table. That is the common
// failure, and it becomes a red test in whichever repo drifted.
//
// Does NOT catch: the table itself being changed in one repo and not copied to
// the others. Keeping the three copies of the JSON identical is a manual step
// (see the checklist below). Automating that is what publishing the guard as a
// package alongside @glance-apps/sync would buy, and is the reason to revisit
// it if these copies ever start costing real time.
//
// CHANGING THE POLICY
//   1. Edit VECTORS below and the implementation(s).
//   2. npm run ssrf:vectors
//   3. Copy api/ssrf-vectors.json to the same path in lastGLANCE and lifeGLANCE
//      and run their suites.
//
// Usage: npm run ssrf:vectors

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VECTORS_PATH = 'api/ssrf-vectors.json';

// `class` is the three-way classification for implementations that expose one.
// `hosted` / `selfHost` are the verdicts EVERY implementation must produce from
// its outermost validate function, which is what the conformance tests drive:
// the two postures are allowPrivate:false (a shared cloud deployment) and
// allowPrivate:true (an instance on the operator's own network).
//
// Derived rather than written out, so a vector cannot claim a verdict its class
// does not imply.
const CLASS_VERDICTS = {
  ok:      { hosted: 'allow', selfHost: 'allow' },
  private: { hosted: 'deny',  selfHost: 'allow' },
  always:  { hosted: 'deny',  selfHost: 'deny'  },
};

const VECTORS = [
  // ── public ────────────────────────────────────────────────────────────────
  ['8.8.8.8', 4, 'ok', 'ordinary public address'],
  ['203.0.113.10', 4, 'ok', 'TEST-NET-3, documentation range, routable as far as this policy cares'],
  ['1.1.1.1', 4, 'ok', 'ordinary public address'],
  ['2606:4700::1111', 6, 'ok', 'ordinary public v6'],
  ['::ffff:8.8.8.8', 6, 'ok', 'IPv4-mapped PUBLIC address must not be lumped in with private ones'],
  // boundaries just outside the blocked ranges
  ['172.15.0.1', 4, 'ok', 'one below 172.16.0.0/12'],
  ['172.32.0.1', 4, 'ok', 'one above 172.16.0.0/12'],
  ['100.63.255.255', 4, 'ok', 'one below the 100.64.0.0/10 CGNAT block'],
  ['100.128.0.0', 4, 'ok', 'one above the 100.64.0.0/10 CGNAT block'],
  ['192.167.0.1', 4, 'ok', 'one below 192.168.0.0/16'],
  ['192.169.0.1', 4, 'ok', 'one above 192.168.0.0/16'],
  ['198.17.0.1', 4, 'ok', 'one below 198.18.0.0/15'],
  ['198.20.0.1', 4, 'ok', 'one above 198.18.0.0/15'],
  ['223.255.255.255', 4, 'ok', 'one below the 224.0.0.0/4 multicast block'],
  ['192.1.0.1', 4, 'ok', 'outside 192.0.0.0/24'],

  // ── private: a real destination for a self-hoster ─────────────────────────
  ['10.0.0.5', 4, 'private', 'RFC1918, a Docker host or LAN server'],
  ['10.255.255.255', 4, 'private', 'top of 10.0.0.0/8'],
  ['172.16.0.1', 4, 'private', 'bottom of 172.16.0.0/12'],
  ['172.17.0.1', 4, 'private', 'the default Docker bridge'],
  ['172.31.255.254', 4, 'private', 'top of 172.16.0.0/12'],
  ['192.168.0.1', 4, 'private', 'RFC1918, a home LAN NAS'],
  ['192.168.255.255', 4, 'private', 'top of 192.168.0.0/16'],
  ['127.0.0.1', 4, 'private', 'loopback: a server on the same host is a real deployment'],
  ['127.1.2.3', 4, 'private', 'the whole of 127.0.0.0/8 is loopback'],
  ['100.64.0.0', 4, 'private', 'bottom of the CGNAT block, where Tailscale lives'],
  ['100.101.102.103', 4, 'private', 'a Tailscale node'],
  ['100.127.255.255', 4, 'private', 'top of the CGNAT block'],
  ['::1', 6, 'private', 'v6 loopback'],
  ['fd00::1', 6, 'private', 'v6 unique-local'],
  ['fc00::1', 6, 'private', 'bottom of fc00::/7'],
  ['fd7a:115c:a1e0::1', 6, 'private', "Tailscale's own v6 prefix"],
  ['::ffff:10.0.0.5', 6, 'private', 'IPv4-mapped RFC1918'],
  ['::ffff:127.0.0.1', 6, 'private', 'IPv4-mapped loopback, dotted form'],
  ['::ffff:7f00:1', 6, 'private', 'IPv4-mapped loopback, the compressed hex form dns.lookup emits'],

  // ── always: no deployment may reach these ─────────────────────────────────
  ['169.254.169.254', 4, 'always', 'the cloud metadata endpoint; hands out instance credentials'],
  ['169.254.0.1', 4, 'always', 'the rest of the link-local block'],
  ['0.0.0.0', 4, 'always', 'unspecified; on some platforms it lands on loopback'],
  ['0.1.2.3', 4, 'always', 'the rest of 0.0.0.0/8'],
  ['192.0.0.1', 4, 'always', 'IETF protocol assignments'],
  ['192.0.0.255', 4, 'always', 'top of 192.0.0.0/24'],
  ['198.18.0.1', 4, 'always', 'benchmarking'],
  ['198.19.255.255', 4, 'always', 'top of 198.18.0.0/15'],
  ['224.0.0.1', 4, 'always', 'multicast'],
  ['239.255.255.255', 4, 'always', 'top of the multicast block'],
  ['240.0.0.1', 4, 'always', 'reserved'],
  ['255.255.255.255', 4, 'always', 'broadcast'],
  ['::', 6, 'always', 'v6 unspecified'],
  ['fe80::1', 6, 'always', 'v6 link-local'],
  ['feb0::1', 6, 'always', 'top of fe80::/10'],
  ['ff02::1', 6, 'always', 'v6 multicast'],
  // Regression pin. dayGLANCE's desktop policy judged these on their v6
  // spelling, so the metadata endpoint read as merely `private` and was
  // therefore GRANTABLE by user consent. Both forms must classify as `always`.
  ['::ffff:169.254.169.254', 6, 'always', 'IPv4-mapped metadata endpoint, dotted form'],
  ['::ffff:a9fe:a9fe', 6, 'always', 'IPv4-mapped metadata endpoint, compressed hex form'],
  ['::ffff:0.0.0.0', 6, 'always', 'IPv4-mapped unspecified'],
];

export function buildSsrfVectors() {
  return {
    version: 1,
    description:
      'Canonical SSRF address-policy vectors for the GLANCE apps. Each entry is '
      + 'an address, its three-way class, and the verdict every implementation '
      + 'must produce in each posture. Generated file: do not hand-edit.',
    generatedBy: 'scripts/export-ssrf-vectors.mjs in krelltunez/dayGLANCE',
    postures: {
      hosted: { allowPrivate: false, description: 'a shared cloud deployment' },
      selfHost: { allowPrivate: true, description: "an instance on the operator's own network" },
    },
    vectors: VECTORS.map(([address, family, cls, note]) => ({
      address,
      family,
      class: cls,
      ...CLASS_VERDICTS[cls],
      note,
    })),
  };
}

// Only write when run directly, so the builder above stays importable by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(root, VECTORS_PATH);
  writeFileSync(out, `${JSON.stringify(buildSsrfVectors(), null, 2)}\n`);
  process.stdout.write(`wrote ${VECTORS_PATH} (${buildSsrfVectors().vectors.length} vectors)\n`);
  process.stdout.write('now copy it to lastGLANCE and lifeGLANCE at the same path and run their suites\n');
}
