import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import dns from 'node:dns';
import { isPrivateOrReservedIp, isNeverExemptibleIp } from './proxyUrlPolicy.js';
// @ts-expect-error - plain JS modules, no type declarations
import { classifyAddress, assertSafeUrl } from '../api/_ssrfGuard.mjs';
// @ts-expect-error - plain JS module, no type declarations
import { buildSsrfVectors, VECTORS_PATH } from '../scripts/export-ssrf-vectors.mjs';

// Conformance against the canonical address table in api/ssrf-vectors.json.
//
// The same policy is implemented four times across three repositories, for
// good reasons (strict TypeScript compiled into the Electron bundle; plain ESM
// copied into a Docker image; a Vercel function), and a range added to one and
// forgotten in another is the drift that produced four divergent copies to
// begin with. Each repo commits the same vectors file and checks its own
// implementation against it, the way dayDial.vectors.json keeps the JS and
// Swift dial geometry in agreement.
//
// dayGLANCE holds two implementations, so both are checked here:
//   api/_ssrfGuard.mjs         the four server-side proxies
//   electron/proxyUrlPolicy.ts the desktop IPC proxy (issue #1642)
//
// If this fails, do not relax it: make the implementation match the table, or
// change the table deliberately and re-run `npm run ssrf:vectors`.

interface Vector {
  address: string;
  family: number;
  class: 'ok' | 'private' | 'always';
  hosted: 'allow' | 'deny';
  selfHost: 'allow' | 'deny';
  note: string;
}

const committed = JSON.parse(readFileSync(VECTORS_PATH, 'utf-8'));
const vectors: Vector[] = committed.vectors;

afterEach(() => { vi.restoreAllMocks(); });

describe('ssrf-vectors.json', () => {
  it('matches what the generator produces, so the committed file is current', () => {
    // The dayDial vectors guard: an edited implementation with a stale file
    // would otherwise pass. Run `npm run ssrf:vectors` and commit the result.
    expect(committed).toEqual(buildSsrfVectors());
  });

  it('covers all three classes and both families', () => {
    const classes = new Set(vectors.map((v) => v.class));
    expect([...classes].sort()).toEqual(['always', 'ok', 'private']);
    expect(vectors.some((v) => v.family === 6)).toBe(true);
    expect(vectors.length).toBeGreaterThan(40);
  });
});

describe('api/_ssrfGuard.mjs classifies every vector as the table says', () => {
  it.each(vectors.map((v) => [v.address, v.family, v.class, v.note] as const))(
    '%s (%s) is %s: %s',
    (address, family, expected) => {
      expect(classifyAddress(address, family)).toBe(expected);
    },
  );
});

describe('electron/proxyUrlPolicy.ts agrees with the same table', () => {
  // The desktop module answers with two predicates rather than a classifier.
  // The mapping is exact: `ok` is neither, `private` is private but grantable,
  // `always` is both private and never exemptible.
  it.each(vectors.map((v) => [v.address, v.class, v.note] as const))(
    '%s is %s: %s',
    (address, expected) => {
      expect({
        private: isPrivateOrReservedIp(address),
        never: isNeverExemptibleIp(address),
      }).toEqual({
        private: expected !== 'ok',
        never: expected === 'always',
      });
    },
  );

  it('never marks an address exemptible but public', () => {
    for (const { address } of vectors) {
      if (isNeverExemptibleIp(address)) expect(isPrivateOrReservedIp(address)).toBe(true);
    }
  });
});

// The verdicts are the contract every implementation in every repo must meet,
// driven through its outermost validate function rather than an internal
// classifier, so a repo that exposes no classifier can run the same table.
describe('assertSafeUrl produces the table verdict in both postures', () => {
  const stub = (address: string, family: number) =>
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address, family } as never]);

  it.each(vectors.map((v) => [v.address, v.family, v.hosted, v.note] as const))(
    'hosted: %s (%s) -> %s: %s',
    async (address, family, verdict) => {
      stub(address, family);
      const call = assertSafeUrl('https://target.example.com/x', { allowPrivate: false });
      if (verdict === 'allow') await expect(call).resolves.toBeTruthy();
      else await expect(call).rejects.toMatchObject({ status: 403 });
    },
  );

  it.each(vectors.map((v) => [v.address, v.family, v.selfHost, v.note] as const))(
    'self-host: %s (%s) -> %s: %s',
    async (address, family, verdict) => {
      stub(address, family);
      const call = assertSafeUrl('https://target.example.com/x', { allowPrivate: true });
      if (verdict === 'allow') await expect(call).resolves.toBeTruthy();
      else await expect(call).rejects.toMatchObject({ status: 403 });
    },
  );
});
