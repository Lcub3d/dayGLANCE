import { describe, expect, it } from 'vitest';
import { createDoRecord, pickJoboRecord, tombstoneDoRecord, validateDoRecord } from './core.js';
import { doRecordFingerprint, prepareDoUndo } from './undo.js';

const T0 = '2026-09-27T10:00:00.000Z';
const T1 = '2026-09-27T10:01:00.000Z';
const record = (patch = {}) => createDoRecord({
  id: 'manual:one', taskId: 'task-1', title: 'Captured task', source: 'manual',
  date: '2026-09-27', timing: 'timed', startTime: '10:00', endDate: '2026-09-27', endTime: '10:30',
  planSnapshot: { date: '2026-09-27', startTime: '09:00', duration: 30 }, progress: 'completed',
  createdAt: T0, updatedAt: T0, observedAt: T0, extra: { preserved: ['opaque'] }, ...patch,
});

describe('versioned Do undo adapter', () => {
  it('undoes creation with a retained tombstone and redoes the same identity with a newer version', () => {
    const created = record();
    const deleted = prepareDoUndo({ records: [created], expected: created, target: null, now: 0 });
    expect(deleted.deleted).toBe(true);
    expect(deleted.updatedAt).toBe('2026-09-27T10:00:00.001Z');
    const redone = prepareDoUndo({ records: [deleted], expected: deleted, target: created, now: 0 });
    expect(redone).toEqual({ ...created, updatedAt: '2026-09-27T10:00:00.002Z' });
    expect(pickJoboRecord(deleted, redone)).toBe(redone);
    expect(validateDoRecord(redone).ok).toBe(true);
  });

  it('undoes and redoes interval, progress and note edits without changing captured fields', () => {
    const before = record({ notes: 'before' });
    const after = record({ startTime: '10:10', endTime: '10:50', progress: 'mostly', notes: 'after', updatedAt: T1 });
    const undone = prepareDoUndo({ records: [after], expected: after, target: before, now: 0 });
    expect(undone).toEqual({ ...before, updatedAt: '2026-09-27T10:01:00.001Z' });
    const redone = prepareDoUndo({ records: [undone], expected: undone, target: after, now: 0 });
    expect(redone).toEqual({ ...after, updatedAt: '2026-09-27T10:01:00.002Z' });
    expect(after.updatedAt).toBe(T1);
    expect(before.updatedAt).toBe(T0);
  });

  it('undoes only its own exact deletion and redoes deletion as a newer tombstone', () => {
    const before = record();
    const removed = tombstoneDoRecord(before, T1);
    const restored = prepareDoUndo({ records: [removed], expected: removed, target: before, now: 0 });
    expect(restored.deleted).toBe(false);
    const redone = prepareDoUndo({ records: [restored], expected: restored, target: removed, now: 0 });
    expect(redone).toEqual({ ...removed, updatedAt: '2026-09-27T10:01:00.002Z' });
    expect(prepareDoUndo({ records: [redone], expected: removed, target: before, now: 0 })).toBeNull();
    expect(() => prepareDoUndo({ records: [removed], expected: removed, target: record({ progress: 'started' }), now: 0 })).toThrow(/exact tombstone/);
  });

  it('refuses pending, missing, newer and same-timestamp remote changes', () => {
    const expected = record();
    expect(prepareDoUndo({ records: [expected], pendingIds: [expected.id], expected, now: 0 })).toBeNull();
    expect(prepareDoUndo({ records: [], expected, now: 0 })).toBeNull();
    for (const remote of [record({ updatedAt: T1 }), record({ notes: 'remote' }), record({ extra: { other: true } }), record({ deleted: true })]) {
      expect(prepareDoUndo({ records: [remote], expected, now: 0 })).toBeNull();
    }
    // Unrelated pending rows do not block this record's history.
    expect(prepareDoUndo({ records: [expected], pendingIds: ['other'], expected, now: 0 }).deleted).toBe(true);
  });

  it('resolves duplicate ids with the same merge rule and ignores unrelated invalid legacy data', () => {
    const old = record();
    const current = record({ updatedAt: T1 });
    const records = [{ id: 'legacy' }, current, old];
    expect(prepareDoUndo({ records, expected: old, now: 0 })).toBeNull();
    expect(prepareDoUndo({ records, expected: current, now: 0 }).deleted).toBe(true);
  });

  it('uses key-order-independent exact fingerprints and preserves opaque content', () => {
    const expected = record();
    const reordered = Object.fromEntries(Object.entries(expected).reverse());
    expect(doRecordFingerprint(expected)).toBe(doRecordFingerprint(reordered));
    expect(prepareDoUndo({ records: [reordered], expected, now: 0 }).extra).toEqual(expected.extra);
    expect(doRecordFingerprint(record({ updatedAt: T1 }))).not.toBe(doRecordFingerprint(expected));
  });

  it('rejects captured-field replacement and malformed timestamps or records', () => {
    const expected = record();
    for (const patch of [{ id: 'other' }, { taskId: null }, { title: 'changed' }, { source: 'focus' }, { planSnapshot: null }, { observedAt: T1 }]) {
      expect(() => prepareDoUndo({ records: [expected], expected, target: record(patch), now: 0 })).toThrow(/captured field/);
    }
    expect(() => prepareDoUndo({ records: [expected], expected, now: 'today' })).toThrow(TypeError);
    expect(() => doRecordFingerprint({ id: 'invalid' })).toThrow(TypeError);
  });
});
