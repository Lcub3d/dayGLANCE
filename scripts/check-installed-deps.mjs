#!/usr/bin/env node
// Refuse to build a native web bundle against a node_modules that does not
// match package-lock.json.
//
// The Android and iOS bundles are built on a local machine, where node_modules
// is whatever the last `npm install` left behind. 5.8.0 shipped to Android
// built against @glance-apps/sync 2.1.1 while the lockfile pinned 2.1.2: 2.1.1
// does not await the (now async) native HTTP bridge, so every WebDAV request
// read a Promise as its response and Test Connection said "Unexpected
// response: undefined" (#2090). CI builds (web, desktop) run `npm ci` and
// cannot drift; this guards the builds that do not.
//
// Runs as `prebuild:android` / `prebuild:ios`. Fix a failure with `npm ci`.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lockfile entries whose installed copy is missing or at another version.
 *
 * @param {object} lock - parsed package-lock.json (lockfileVersion 2 or 3)
 * @param {(path: string) => string|null} installedVersion - the version in
 *   `<path>/package.json`, or null when it is not installed
 * @returns {{path: string, expected: string, installed: string|null}[]}
 */
export function findLockDrift(lock, installedVersion) {
  const drift = [];
  for (const [path, entry] of Object.entries(lock?.packages || {})) {
    if (!path.startsWith('node_modules/')) continue;
    // Workspace links (file:packages/*) have no registry version to compare.
    if (entry.link || !entry.version) continue;
    const installed = installedVersion(path);
    // Optional packages are platform-specific (esbuild, rollup binaries): their
    // absence on this machine is expected, but a present one must still match.
    if (installed == null && entry.optional) continue;
    if (installed !== entry.version) drift.push({ path, expected: entry.version, installed });
  }
  return drift;
}

const main = () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf-8'));
  const installedVersion = (path) => {
    try {
      return JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf-8')).version ?? null;
    } catch {
      return null;
    }
  };
  const drift = findLockDrift(lock, installedVersion);
  if (drift.length === 0) return;
  console.error('node_modules does not match package-lock.json:');
  for (const d of drift.slice(0, 20)) {
    console.error(`  ${d.path.replace(/^node_modules\//, '')}: lockfile ${d.expected}, installed ${d.installed ?? '(missing)'}`);
  }
  if (drift.length > 20) console.error(`  …and ${drift.length - 20} more`);
  console.error('\nRun `npm ci` and build again. A bundle built from these would not be the code the lockfile describes.');
  process.exit(1);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
