import { describe, it, expect } from 'vitest';
import { canonicalJson, describeSliceDiff, explainSnapshotMerge } from './snapshotMergeExplain.js';
import { mergeSyncData } from '../mergeSync.js';

const task = (id, over = {}) => ({
  id, title: `t${id}`, date: '2026-10-05', completed: false, notes: '', subtasks: [],
  lastModified: '2026-10-01T00:00:00.000Z', ...over,
});

describe('canonicalJson', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe('describeSliceDiff', () => {
  it('reports nothing for equal content', () => {
    expect(describeSliceDiff('tasks', [task(1), task(2)], [task(2), task(1)].reverse())).toBeNull();
    expect(describeSliceDiff('x', { a: 1 }, { a: 1 })).toBeNull();
    expect(describeSliceDiff('x', undefined, undefined)).toBeNull();
  });

  it('matches id collections by id and names the changed ids', () => {
    const d = describeSliceDiff('tasks', [task(1, { title: 'new' }), task(2), task(3)], [task(1), task(2), task(4)]);
    expect(d.kind).toBe('items');
    expect(d.summary).toBe('tasks: 1 changed (1), +1 only in result, -1 only on other side');
  });

  it('reports a pure reorder as order, not as items', () => {
    const d = describeSliceDiff('tasks', [task(1), task(2)], [task(2), task(1)]);
    expect(d).toEqual({ key: 'tasks', kind: 'order', summary: 'tasks: order differs' });
  });

  it('does set arithmetic on scalar lists and spots duplicates', () => {
    expect(describeSliceDiff('completedTaskUids', ['a', 'b', 'c'], ['b', 'd']).summary).toBe('completedTaskUids: +2 / -1');
    expect(describeSliceDiff('completedTaskUids', ['a', 'a'], ['a']).kind).toBe('duplicates');
    expect(describeSliceDiff('completedTaskUids', ['a'], ['a'])).toBeNull();
  });

  it('counts differing entries in a map and flags added or dropped slices', () => {
    expect(describeSliceDiff('habitLogs', { d1: 1, d2: 2 }, { d1: 1, d2: 3, d3: 1 }).summary).toBe('habitLogs: 2 of 3 entries differ');
    expect(describeSliceDiff('areas', [{ id: 'a' }], undefined).kind).toBe('added');
    expect(describeSliceDiff('areas', undefined, [{ id: 'a' }]).kind).toBe('dropped');
    expect(describeSliceDiff('syncUrl', 'a', 'b').kind).toBe('value');
  });
});

describe('explainSnapshotMerge with the real merge', () => {
  // A payload as a device that has synced before holds it: run the merge over a
  // minimal payload once so every default slice the merge fills in is present,
  // the way it is in any file this app has already written.
  const settle = (data) => mergeSyncData(data, data, 90).data;
  const base = () => settle({
    tasks: [task(1), task(2)],
    unscheduledTasks: [],
    recycleBin: [],
    completedTaskUids: [],
    habits: [],
    habitLogs: {},
    dailyNotes: {},
  });

  it('an identical file and device raise no flags and show no diffs', () => {
    const r = explainSnapshotMerge({ local: base(), remote: base(), retentionDays: 90, merge: mergeSyncData });
    expect(r.error).toBeNull();
    expect(r.fileDiffs).toEqual([]);
    expect(r.deviceDiffs).toEqual([]);
    expect(r.remoteChanged).toBe(false);
    expect(r.flagWithoutDiff).toBe(false);
  });

  it('ignores the per-merge tombstone fence and treats absent and empty slices alike', () => {
    expect(describeSliceDiff('tombstonePrunedBefore', '2026-08-01T00:00:00.000Z', '2026-08-06T00:00:00.000Z')).toBeNull();
    expect(describeSliceDiff('routineCompletionTimestamps', {}, undefined)).toBeNull();
    expect(describeSliceDiff('areas', [], null)).toBeNull();
  });

  it('a local edit newer than the file is a write, named by slice and id', () => {
    const local = base();
    local.tasks[0] = task(1, { title: 'renamed', lastModified: '2026-10-05T01:00:00.000Z' });
    const r = explainSnapshotMerge({ local, remote: base(), retentionDays: 90, merge: mergeSyncData });
    expect(r.remoteChanged).toBe(true);
    expect(r.fileDiffs.map((d) => d.summary)).toContain('tasks: 1 changed (1)');
    expect(r.deviceDiffs.filter((d) => d.key === 'tasks')).toEqual([]);
  });

  it('a file edit newer than the device is an apply, not a write', () => {
    const remote = base();
    remote.tasks[1] = task(2, { title: 'from file', lastModified: '2026-10-05T01:00:00.000Z' });
    const r = explainSnapshotMerge({ local: base(), remote, retentionDays: 90, merge: mergeSyncData });
    expect(r.localChanged).toBe(true);
    expect(r.deviceDiffs.map((d) => d.summary)).toContain('tasks: 1 changed (2)');
    expect(r.fileDiffs.filter((d) => d.key === 'tasks')).toEqual([]);
  });

  it('flags a write that would change nothing in the file as a change-flag bug', () => {
    const merge = (local) => ({ data: local, localChanged: false, remoteChanged: true });
    const r = explainSnapshotMerge({ local: base(), remote: base(), retentionDays: 90, merge });
    expect(r.remoteChanged).toBe(true);
    expect(r.fileDiffs).toEqual([]);
    expect(r.flagWithoutDiff).toBe(true);
  });

  it('a merge that throws is reported, not thrown', () => {
    const r = explainSnapshotMerge({ local: {}, remote: {}, retentionDays: 90, merge: () => { throw new Error('boom'); } });
    expect(r.error).toBe('boom');
    expect(r.fileDiffs).toEqual([]);
  });
});
