import { describe, expect, it } from 'vitest';
import { findLockDrift } from './check-installed-deps.mjs';

const lock = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'dayglance' },
    'node_modules/@glance-apps/sync': { version: '2.1.2' },
    'node_modules/@glance-apps/agenda-core': { resolved: 'packages/agenda-core', link: true },
    'node_modules/@esbuild/darwin-arm64': { version: '0.25.0', optional: true },
    'node_modules/a/node_modules/b': { version: '1.0.0' },
    'packages/agenda-core': { version: '0.0.0' },
  },
};

const installed = (versions) => (path) => versions[path] ?? null;

describe('findLockDrift', () => {
  const matching = {
    'node_modules/@glance-apps/sync': '2.1.2',
    'node_modules/a/node_modules/b': '1.0.0',
  };

  it('passes a node_modules that matches the lockfile', () => {
    expect(findLockDrift(lock, installed(matching))).toEqual([]);
  });

  // #2090: the 5.8.0 Android bundle was built against sync 2.1.1.
  it('reports a stale package', () => {
    expect(findLockDrift(lock, installed({ ...matching, 'node_modules/@glance-apps/sync': '2.1.1' }))).toEqual([
      { path: 'node_modules/@glance-apps/sync', expected: '2.1.2', installed: '2.1.1' },
    ]);
  });

  it('reports a missing package, including a nested one', () => {
    const { 'node_modules/a/node_modules/b': _, ...rest } = matching;
    expect(findLockDrift(lock, installed(rest))).toEqual([
      { path: 'node_modules/a/node_modules/b', expected: '1.0.0', installed: null },
    ]);
  });

  it('skips links and absent optional packages, but checks a present optional one', () => {
    expect(findLockDrift(lock, installed({ ...matching, 'node_modules/@esbuild/darwin-arm64': '0.24.0' }))).toEqual([
      { path: 'node_modules/@esbuild/darwin-arm64', expected: '0.25.0', installed: '0.24.0' },
    ]);
  });
});
