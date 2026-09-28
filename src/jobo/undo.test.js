import { describe, it, expect } from 'vitest';
import { createDoRecord, pickJoboRecord, tombstoneDoRecord } from './core.js';
import { mergeJoboCollections } from './ledger.js';
import { joboUndoEntry, planJoboUndo, movesIntoCompleted } from './undo.js';
import { prepareDoEdit, prepareDoDelete, createManualDo } from './viewActions.js';

// Undo of a Do edit is a fresh edit (#1726): the earlier content under the
// same id, strictly newer than the current version, and only while the
// current version is the one the step left behind.

const stamp = '2026-09-28T15:00:00.000Z';
const NOW = Date.parse('2026-09-28T16:00:00.000Z');
const row = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: 't1', title: 'Deep work', source: 'manual', progress: 'partial',
  timing: 'timed', date: '2026-09-28', startTime: '09:00', endDate: '2026-09-28', endTime: '10:00',
  planSnapshot: null, createdAt: stamp, observedAt: stamp, updatedAt: stamp, ...over,
});
const later = (ms) => new Date(Date.parse(stamp) + ms).toISOString();

describe('an edit', () => {
  const before = row();
  const after = prepareDoEdit({ records: [before], record: before, patch: { startTime: '09:30' }, now: NOW });
  const entry = () => joboUndoEntry(before, after);

  it('undoes to the earlier interval as a newer version, and redoes forward again', () => {
    const e = entry();
    const undo = planJoboUndo(e, 'undo', [after], NOW + 1000);
    expect(undo.record).toMatchObject({ id: before.id, startTime: '09:00', deleted: false });
    expect(Date.parse(undo.record.updatedAt)).toBeGreaterThan(Date.parse(after.updatedAt));
    expect(pickJoboRecord(after, undo.record)).toBe(undo.record);
    e.expect = undo.record;
    const redo = planJoboUndo(e, 'redo', [undo.record], NOW + 2000);
    expect(redo.record).toMatchObject({ startTime: '09:30' });
    expect(pickJoboRecord(undo.record, redo.record)).toBe(redo.record);
  });

  // MUTATION: drop the +1 and a device whose clock is behind writes an undo
  // that loses to the version it is meant to replace.
  it('stays strictly newer than the current version even when the clock is behind', () => {
    const undo = planJoboUndo(entry(), 'undo', [after], 0);
    expect(Date.parse(undo.record.updatedAt)).toBe(Date.parse(after.updatedAt) + 1);
  });

  // MUTATION: skip the expected-version check and the undo overwrites
  // another device's newer edit.
  it('reports a conflict when the record has moved on, and writes nothing', () => {
    const elsewhere = createDoRecord({ ...after, endTime: '11:00', updatedAt: later(3_600_000 * 2) });
    expect(planJoboUndo(entry(), 'undo', [elsewhere], NOW)).toEqual({ conflict: true });
    expect(planJoboUndo(entry(), 'undo', [], NOW)).toEqual({ conflict: true });
  });

  it('reads the winning copy when the list holds more than one', () => {
    const stale = before;
    expect(planJoboUndo(entry(), 'undo', [stale, after], NOW).record).toMatchObject({ startTime: '09:00' });
  });
});

describe('a deletion', () => {
  const live = row();
  const tombstone = prepareDoDelete({ records: [live], record: live, now: NOW });

  // Lcub3d's answer on #1726: a newer live version wins over the older
  // tombstone in the ledger and in both sync tiers.
  it('is undone by a newer live copy that wins over the tombstone everywhere', () => {
    const { record } = planJoboUndo(joboUndoEntry(live, tombstone), 'undo', [tombstone], NOW + 1000);
    expect(record.deleted).toBe(false);
    expect(record).toMatchObject({ startTime: '09:00', endTime: '10:00', progress: 'partial' });
    expect(pickJoboRecord(tombstone, record)).toBe(record);
    expect(pickJoboRecord(record, tombstone)).toBe(record);
    // File tier: either side can hold either copy.
    expect(mergeJoboCollections([tombstone], [record]).merged).toEqual([record]);
    expect(mergeJoboCollections([record], [tombstone]).merged).toEqual([record]);
  });

  it('redoes as a newer tombstone', () => {
    const e = joboUndoEntry(live, tombstone);
    const undo = planJoboUndo(e, 'undo', [tombstone], NOW + 1000);
    e.expect = undo.record;
    const redo = planJoboUndo(e, 'redo', [undo.record], NOW + 2000);
    expect(redo.record.deleted).toBe(true);
    expect(pickJoboRecord(undo.record, redo.record)).toBe(redo.record);
  });

  it('a stale live copy from another device still loses to the tombstone', () => {
    expect(mergeJoboCollections([live], [tombstone]).merged[0].deleted).toBe(true);
  });
});

describe('an added Do', () => {
  const added = createManualDo({ id: 'manual:new', title: 'Walk', task: null, date: '2026-09-28', startMinute: 600, duration: 30, progress: 'started', now: NOW });

  it('is undone by deleting it, and redone by bringing it back', () => {
    const e = joboUndoEntry(null, added);
    const undo = planJoboUndo(e, 'undo', [added], NOW + 1000);
    expect(undo.record).toMatchObject({ id: 'manual:new', deleted: true });
    e.expect = undo.record;
    const redo = planJoboUndo(e, 'redo', [undo.record], NOW + 2000);
    expect(redo.record).toMatchObject({ id: 'manual:new', deleted: false, startTime: '10:00' });
    expect(pickJoboRecord(undo.record, redo.record)).toBe(redo.record);
  });
});

// Until the completion change (#1867) lands with its eligibility rules, undo
// never writes Completed onto a record that is not Completed.
describe('Completed stays out of undo for now', () => {
  const completed = row({ progress: 'completed', source: 'completion', id: 'do:t1:x' });

  // MUTATION: drop the guard and undoing a reassessment writes Completed
  // with no completion event behind it.
  it('refuses to undo a reassessment from Completed', () => {
    const reassessed = prepareDoEdit({ records: [completed], record: completed, progress: 'partial', now: NOW });
    expect(planJoboUndo(joboUndoEntry(completed, reassessed), 'undo', [reassessed], NOW + 1000)).toEqual({ blocked: 'completion' });
  });

  it('still undoes a time edit on a Completed record, and a deleted Completed record comes back', () => {
    const moved = prepareDoEdit({ records: [completed], record: completed, patch: { startTime: '09:15' }, now: NOW });
    expect(planJoboUndo(joboUndoEntry(completed, moved), 'undo', [moved], NOW + 1000).record).toMatchObject({ progress: 'completed', startTime: '09:00' });
    const gone = tombstoneDoRecord(completed, later(1000));
    expect(planJoboUndo(joboUndoEntry(completed, gone), 'undo', [gone], NOW + 1000).record).toMatchObject({ progress: 'completed', deleted: false });
  });

  it('says which moves count', () => {
    expect(movesIntoCompleted({ progress: 'partial' }, { progress: 'completed', deleted: false })).toBe(true);
    expect(movesIntoCompleted({ progress: 'completed' }, { progress: 'completed', deleted: false })).toBe(false);
    expect(movesIntoCompleted({ progress: 'partial' }, { progress: 'completed', deleted: true })).toBe(false);
  });
});
