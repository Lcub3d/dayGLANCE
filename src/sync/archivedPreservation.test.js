import { describe, it, expect } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { applyRemoteEntity } from './dbAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the `archived` flag survives whole-entity last-writer-wins on BOTH
// sync transports.
//
// Root cause (confirmed by reproduction): archiving a task did not bump
// `lastModified`, so an older archived copy loses LWW to a newer copy from a
// device that never archived it. Both the file-tier merge (mergeArrayById, whole
// winner) and the vault merge (upsertCollection, whole replace) then drop
// `archived`, leaving the in-memory task with `archived: undefined` while storage
// keeps `archived: true` — a phantom diff that re-stamps lastModified on every
// cold-open (the DB-sync push churn / SSE self-nudge).
//
// The fix carries `archived: true` forward when the LWW winner OMITS it (undefined)
// but either side had it, while an explicit `archived: false` (a real unarchive)
// still propagates. Complemented by the write side stamping lastModified on
// archive/unarchive (in App.jsx) so future toggles win LWW outright.
// ─────────────────────────────────────────────────────────────────────────────

const item = (extra) => ({
  id: 'x1', title: 'old inbox', completed: true, completedAt: '2026-06-21',
  lastModified: '2026-06-21T10:00:00.000Z', ...extra,
});

describe('file-tier mergeSyncData preserves archived across LWW', () => {
  it('local archived:true vs a NEWER remote without archived → archived kept', () => {
    const local = { unscheduledTasks: [item({ archived: true })] };
    const remote = { unscheduledTasks: [item({ lastModified: '2026-07-01T10:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBe(true);       // not dropped
    expect(data.unscheduledTasks[0].completedAt).toBe('2026-06-21'); // other fields intact
  });

  it('honors a real unarchive: NEWER remote archived:false wins over local archived:true', () => {
    const local = { unscheduledTasks: [item({ archived: true })] };
    const remote = { unscheduledTasks: [item({ archived: false, lastModified: '2026-07-01T10:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBe(false); // explicit false is not clobbered
  });

  it('remote archived:true vs a NEWER local without archived → archived kept', () => {
    const local = { unscheduledTasks: [item({ lastModified: '2026-07-01T10:00:00.000Z' })] };
    const remote = { unscheduledTasks: [item({ archived: true })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBe(true);
  });

  it('a never-archived task stays absent (no archived key injected)', () => {
    const local = { unscheduledTasks: [item()] };
    const remote = { unscheduledTasks: [item({ lastModified: '2026-07-01T10:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBeUndefined();
  });
});

describe('vault applyRemoteEntity preserves archived across LWW', () => {
  it('pulling a remote task WITHOUT archived over local archived:true keeps it + re-pushes', () => {
    const data = { unscheduledTasks: [item({ archived: true })] };
    const pulled = { _kind: 'unscheduledTasks', value: item({ lastModified: '2026-07-01T10:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.unscheduledTasks[0].archived).toBe(true);   // carried forward
    expect(rePush).toHaveLength(1);                          // vault converges to the superset
  });

  it('pulling an explicit archived:false (unarchive) is honored, no re-push', () => {
    const data = { unscheduledTasks: [item({ archived: true })] };
    const pulled = { _kind: 'unscheduledTasks', value: item({ archived: false, lastModified: '2026-07-01T10:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.unscheduledTasks[0].archived).toBe(false);
    expect(rePush).toEqual([]);
  });

  it('pulling over a non-archived local leaves it absent, no re-push', () => {
    const data = { unscheduledTasks: [item()] };
    const pulled = { _kind: 'unscheduledTasks', value: item({ lastModified: '2026-07-01T10:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.unscheduledTasks[0].archived).toBeUndefined();
    expect(rePush).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The same hazard, aimed at `originalPlan` (utils/originalPlan.js): the schedule
// a task was first given. It is written only by the device that observed the
// scheduling, so every fleet with a device on an older build — or simply one that
// has not reloaded since — has copies without it, and whole-entity LWW drops the
// baseline the moment one of those wins.
//
// Unlike archived there is no explicit-value case to honor: the field is
// write-once and nothing in the app can clear it, so absent on the winner can
// only ever mean "that device never had it".
// ─────────────────────────────────────────────────────────────────────────────

const PLAN = { date: '2026-09-17', startTime: '09:00', duration: 60 };
const task = (extra) => ({
  id: 'p1', title: 'Report', date: '2026-09-17', startTime: '09:00',
  lastModified: '2026-09-17T09:00:00.000Z', ...extra,
});

describe('file-tier mergeSyncData preserves originalPlan across LWW', () => {
  it('local baseline vs a NEWER remote without one → baseline kept', () => {
    const local = { tasks: [task({ originalPlan: PLAN })] };
    const remote = { tasks: [task({ title: 'Report v2', startTime: '16:00', lastModified: '2026-09-17T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
    expect(data.tasks[0].startTime).toBe('16:00'); // the reschedule still wins
    expect(data.tasks[0].title).toBe('Report v2');
  });

  it('remote baseline vs a NEWER local without one → baseline kept', () => {
    const local = { tasks: [task({ lastModified: '2026-09-17T12:00:00.000Z' })] };
    const remote = { tasks: [task({ originalPlan: PLAN })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
  });

  it('a task with no baseline on either side stays without one', () => {
    const local = { tasks: [task()] };
    const remote = { tasks: [task({ lastModified: '2026-09-17T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].originalPlan).toBeUndefined();
  });

  it('survives into the recycle bin, so a restored task keeps its baseline', () => {
    const local = { recycleBin: [task({ originalPlan: PLAN })] };
    const remote = { recycleBin: [task({ lastModified: '2026-09-17T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.recycleBin[0].originalPlan).toEqual(PLAN);
  });
});

describe('vault applyRemoteEntity preserves originalPlan across LWW', () => {
  it('pulling a task WITHOUT a baseline over a local one keeps it + re-pushes', () => {
    const data = { tasks: [task({ originalPlan: PLAN })] };
    const pulled = { _kind: 'tasks', value: task({ title: 'Report v2', lastModified: '2026-09-17T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
    expect(data.tasks[0].title).toBe('Report v2'); // the real edit still applies
    expect(rePush).toHaveLength(1);                // vault converges to the superset
  });

  it('pulling over a local without a baseline leaves it absent, no re-push', () => {
    const data = { tasks: [task()] };
    const pulled = { _kind: 'tasks', value: task({ lastModified: '2026-09-17T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].originalPlan).toBeUndefined();
    expect(rePush).toEqual([]);
  });

  it('a pulled baseline is taken when the local copy has none', () => {
    const data = { tasks: [task()] };
    const pulled = { _kind: 'tasks', value: task({ originalPlan: PLAN, lastModified: '2026-09-17T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
    expect(rePush).toEqual([]);
  });

  it('carries archived and originalPlan independently in one pull', () => {
    const data = { tasks: [task({ archived: true, originalPlan: PLAN })] };
    const pulled = { _kind: 'tasks', value: task({ lastModified: '2026-09-17T12:00:00.000Z' }) };
    applyRemoteEntity(data, pulled);
    expect(data.tasks[0].archived).toBe(true);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
  });
});
