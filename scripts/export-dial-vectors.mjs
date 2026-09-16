#!/usr/bin/env node
// Writes the Day Dial geometry test vectors to dayglance-ios/TestFixtures/
// dayDial.vectors.json. See src/utils/dayDialVectors.js for what and why;
// dayDialVectors.test.js fails when the committed file no longer matches, so
// run this after any change to dayDial.js's geometry and commit the result.
//
// Usage: npm run ios:vectors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

import { buildDialVectors, VECTORS_PATH, VECTORS_TIMEZONE } from '../src/utils/dayDialVectors.js';

// The sky section reads the host clock's zone; pin it before building. Node
// re-reads TZ on assignment, and the builder constructs every Date at call
// time, so this is enough — no re-exec.
process.env.TZ = VECTORS_TIMEZONE;

const vectors = buildDialVectors();
const out = resolve(root, VECTORS_PATH);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`export-dial-vectors: wrote ${VECTORS_PATH} — ${vectors.counts.geometry} geometry + ${vectors.counts.sky} sky + ${vectors.counts.snapshot} snapshot cases (TZ=${VECTORS_TIMEZONE})`);
