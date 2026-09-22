import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCaptureSafeDoRecord,
  mergeCaptureSafeDoRecords,
  updateCaptureSafeDoRecord,
  tombstoneCaptureSafeDoRecord,
} from '../src/jobo/captureMerge.js';

// Point this probe at a checkout of the upstream ledger controller, for example:
// node scripts/check-jobo-capture-ledger.mjs /path/to/dayGLANCE/src/jobo/ledger.js
// JSON below is a transport round-trip, not a live sync tier.
if (!process.argv[2]) {
  throw new Error('Usage: node scripts/check-jobo-capture-ledger.mjs /absolute/path/to/ledger.js');
}
const ledgerPath = resolve(process.argv[2]);
const { createLedger } = await import(pathToFileURL(ledgerPath).href);
assert.equal(typeof createLedger, 'function', 'Expected ledger module to export createLedger');
const pick = mergeCaptureSafeDoRecords;
const jsonCopy = value => JSON.parse(JSON.stringify(value));

function strictMemoryStore(initial = []) {
  let disk = jsonCopy(initial);
  let writes = 0;
  let queue = Promise.resolve();
  return {
    async read() { return { ok: true, value: jsonCopy(disk) }; },
    async writable() { return true; },
    update(fn) {
      const operation = queue.then(() => {
        const next = fn(jsonCopy(disk));
        assert.ok(Array.isArray(next));
        disk = jsonCopy(next);
        writes += 1;
        return { ok: true, value: jsonCopy(disk) };
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
    disk: () => jsonCopy(disk),
    writes: () => writes,
  };
}

const A = createCaptureSafeDoRecord({
  id: 'completion:task-42:event-7', taskId: 'task-42',
  date: '2026-09-20', startTime: '09:00',
  endDate: '2026-09-20', endTime: '10:00',
  title: 'Original task title',
  planSnapshot: { date: '2026-09-20', startTime: '09:00', duration: 60 },
  source: 'completion', progress: 'completed', deleted: false,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  observedAt: '2026-09-20T10:00:01.000Z',
});
const { _joboMerge: unusedMergeMetadata, ...baseB } = A;
void unusedMergeMetadata;
const B = createCaptureSafeDoRecord({
  ...baseB,
  title: 'Later renamed task',
  planSnapshot: { date: '2026-09-20', startTime: '14:00', duration: 90 },
  observedAt: '2026-09-20T14:00:00.000Z',
});
const editedB = updateCaptureSafeDoRecord(B, { endTime: '10:10', progress: 'mostly' },
  '2026-09-20T14:10:00.000Z');

function assertPreserved(record) {
  assert.equal(record.title, A.title);
  assert.deepEqual(record.planSnapshot, A.planSnapshot);
  assert.equal(record.endTime, editedB.endTime);
  assert.equal(record.progress, editedB.progress);
  assert.equal(record.updatedAt, editedB.updatedAt);
}
function assertCommitted(ledger, store) {
  assert.deepEqual(ledger.get().records, store.disk());
}
async function ready(initial = []) {
  const store = strictMemoryStore(initial);
  const ledger = createLedger({ store, pick });
  await ledger.load();
  assert.equal(ledger.get().loaded, true);
  return { ledger, store };
}
async function transfer(from, to) {
  const payload = JSON.stringify({ joboRecords: from.get().records });
  const decoded = JSON.parse(payload);
  const result = await to.applyRemote(decoded.joboRecords);
  assert.equal(result.ok, true);
  return result;
}

const checks = [];

// A captured early; B edited its own late capture while offline.
const left = await ready();
const right = await ready();
assert.equal((await left.ledger.commit([A])).ok, true);
assert.equal((await right.ledger.commit([editedB])).ok, true);
assertCommitted(left.ledger, left.store);
assertCommitted(right.ledger, right.store);
await transfer(right.ledger, left.ledger);
assertPreserved(left.ledger.get().records[0]);
assertCommitted(left.ledger, left.store);
checks.push('offline edit preserves earlier capture through commit/state/JSON/applyRemote');

// Reverse incoming order must produce the same row and persist it.
await transfer(left.ledger, right.ledger);
assert.deepEqual(right.ledger.get().records, left.ledger.get().records);
assertCommitted(right.ledger, right.store);
const independentReverse = await ready([editedB]);
await independentReverse.ledger.applyRemote(jsonCopy([A]));
assert.deepEqual(independentReverse.ledger.get().records, left.ledger.get().records);
checks.push('reverse arrival order converges');

// Recreate a controller using the actual committed store, then hydrate.
const reloaded = createLedger({ store: left.store, pick });
await reloaded.load();
assert.deepEqual(reloaded.get().records, left.ledger.get().records);
assertPreserved(reloaded.get().records[0]);
checks.push('capture provenance survives persisted JSON and fresh controller reload');

// Replaying either original copy must not undo the combined result.
const merged = jsonCopy(reloaded.get().records);
await reloaded.applyRemote(jsonCopy([A, editedB, B]));
assert.deepEqual(reloaded.get().records, merged);
assertCommitted(reloaded, left.store);
checks.push('older and duplicate live-row replays are idempotent');

// A later deletion wins, and old completion replay cannot resurrect it.
const deleted = tombstoneCaptureSafeDoRecord(reloaded.get().records[0], '2026-09-20T14:20:00.000Z');
await reloaded.commit([deleted]);
await reloaded.applyRemote(jsonCopy([A, editedB]));
assert.equal(reloaded.get().records[0].deleted, true);
assert.equal(reloaded.get().records[0].title, A.title);
assert.deepEqual(reloaded.get().records[0].planSnapshot, A.planSnapshot);
assertCommitted(reloaded, left.store);
checks.push('stale live replay does not resurrect a later tombstone');

// The actual controller queues remote rows before hydration, then merges them
// against disk rather than treating unloaded state as an empty collection.
const heldStore = strictMemoryStore([A]);
const heldLedger = createLedger({ store: heldStore, pick });
const held = await heldLedger.applyRemote(jsonCopy([editedB]));
assert.deepEqual(held, { ok: true, held: true });
assert.equal(heldLedger.get().records, undefined);
assert.equal(heldLedger.heldCount(), 1);
await heldLedger.load();
assert.equal(heldLedger.heldCount(), 0);
assertPreserved(heldLedger.get().records[0]);
assertCommitted(heldLedger, heldStore);
checks.push('remote apply held before load merges with hydrated capture');

console.log(JSON.stringify({
  ok: true,
  controller: ledgerPath,
  candidateExport: 'mergeCaptureSafeDoRecords',
  checks,
  limit: 'In-memory strict store and JSON transport only; no live sync providers, IndexedDB, React, or backup/restore integration.',
}, null, 2));
