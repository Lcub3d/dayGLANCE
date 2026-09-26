// Local experimental undo adapter. Each compensation is a newer version of
// one Do; the ledger remains the only writer and is never snapshot-restored.
import { createDoRecord, pickJoboRecord, tombstoneDoRecord } from './core.js';

const CAPTURED_FIELDS = ['id', 'taskId', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt'];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Exact semantic fingerprint, including opaque extensions and tie versions. */
export function doRecordFingerprint(record) {
  return canonical(createDoRecord(record));
}

const without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

/**
 * Prepare undo/redo against an exact expected winner, including tombstones.
 * target=null retracts a created record; target=before/after restores content.
 * Return null for a pending/missing/stale row. Callers must advance expected
 * to the newly confirmed record after every compensation, not to an old stamp.
 * This is an optimistic view guard, not an atomic cross-tab ledger CAS.
 */
export function prepareDoUndo({ records, pendingIds = [], expected, target = null, now } = {}) {
  if (!Array.isArray(records) || !Array.isArray(pendingIds)) throw new TypeError('records and pendingIds must be arrays');
  const expectedFingerprint = doRecordFingerprint(expected);
  if (pendingIds.some(id => String(id) === expected.id)) return null;
  let current = null;
  for (const candidate of records) {
    if (String(candidate?.id) !== expected.id) continue;
    createDoRecord(candidate);
    current = current === null ? candidate : pickJoboRecord(current, candidate);
  }
  if (!current || doRecordFingerprint(current) !== expectedFingerprint) return null;

  let restored = null;
  if (target !== null) {
    restored = createDoRecord(target);
    for (const key of CAPTURED_FIELDS) {
      if (canonical(restored[key]) !== canonical(current[key])) throw new TypeError(`Undo cannot change captured field: ${key}`);
    }
    // Explicit restore is the sole experimental exception to ordinary edit's
    // no-revival rule. It can only restore the exact content this deletion
    // hid, and only while this history action still owns that tombstone.
    if (current.deleted && !restored.deleted
      && canonical(without(current, ['updatedAt', 'deleted'])) !== canonical(without(restored, ['updatedAt', 'deleted']))) {
      throw new TypeError('Undo can only restore the content of its exact tombstone');
    }
    if (canonical(without(current, ['updatedAt'])) === canonical(without(restored, ['updatedAt']))) return current;
  } else if (current.deleted) return current;

  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new TypeError('now must be a valid epoch millisecond number');
  }
  const epoch = Math.max(now, Date.parse(current.updatedAt) + 1, restored ? Date.parse(restored.updatedAt) + 1 : 0);
  const updatedAt = new Date(epoch).toISOString();
  return restored === null ? tombstoneDoRecord(current, updatedAt) : createDoRecord({ ...restored, updatedAt });
}
