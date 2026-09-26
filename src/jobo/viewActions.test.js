import { describe, expect, it, vi } from 'vitest';
import {
  completeDoAttempt,
  createDoRecord,
  DO_PROGRESS,
} from './core.js';
import {
  buildJoboRecords,
  findJoboEdges,
  snapshotJoboState,
} from './detector.js';
import {
  commitDoEdit,
  copyDoRecord,
  createManualDo,
  doIntervalAt,
  moveDoInterval,
  prepareDoDelete,
  prepareDoEdit,
  resolveDropTarget,
  resolvePlanDropTarget,
  resizeDoInterval,
} from './viewActions.js';

const NOW = Date.parse('2026-09-26T10:00:00.000Z');

describe('doIntervalAt', () => {
  it('uses UTC civil arithmetic across midnight', () => {
    expect(doIntervalAt('2026-09-26', 23 * 60 + 30, 90)).toEqual({
      timing: 'timed', date: '2026-09-26', startTime: '23:30',
      endDate: '2026-09-27', endTime: '01:00',
    });
  });

  it('strictly rejects malformed and sub-five-minute inputs', () => {
    expect(() => doIntervalAt('2026-02-29', 60, 30)).toThrow();
    expect(() => doIntervalAt('2026-09-26', 1440, 30)).toThrow();
    expect(() => doIntervalAt('2026-09-26', 60.5, 30)).toThrow();
    expect(() => doIntervalAt('2026-09-26', 60, 4)).toThrow();
  });
});

describe('resolveDropTarget', () => {
  it('snaps and clamps a Plan to the final in-day interval', () => {
    expect(resolvePlanDropTarget({ date: '2026-09-26', minute: 1438, duration: 90 })).toEqual({
      minute: 1350,
      duration: 90,
      visibleDuration: 90,
      interval: {
        timing: 'timed', date: '2026-09-26', startTime: '22:30',
        endDate: '2026-09-27', endTime: '00:00',
      },
    });
    const resolved = resolveDropTarget({
      lane: 'plan', type: 'plan', date: '2026-09-26', minute: 1438,
      item: { plan: { duration: 90 } },
    });
    expect(resolved).toEqual(resolvePlanDropTarget({ date: '2026-09-26', minute: 1438, duration: 90 }));
  });

  it('moves a cross-midnight Do from the visible grabbed edge without shortening it', () => {
    const interval = doIntervalAt('2026-09-26', 23 * 60 + 30, 90);
    const record = {
      ...interval, id: 'manual:midnight', taskId: null, title: 'Night work', planSnapshot: null,
      source: 'manual', progress: DO_PROGRESS.STARTED,
      createdAt: '2026-09-26T15:00:00.000Z', updatedAt: '2026-09-26T15:00:00.000Z',
      observedAt: '2026-09-26T15:00:00.000Z', deleted: false,
    };
    const target = resolveDropTarget({
      lane: 'do', type: 'do', date: '2026-09-26', minute: 0,
      item: { record, startMinute: 23 * 60 + 30 },
    });
    expect(target.minute).toBe(0);
    expect(target.duration).toBe(90);
    expect(target.interval).toEqual({
      timing: 'timed', date: '2026-09-26', startTime: '00:00',
      endDate: '2026-09-26', endTime: '01:30',
    });
  });

  it('reports the final visible slice when moving a clipped cross-midnight Do', () => {
    const interval = doIntervalAt('2026-09-26', 23 * 60, 120);
    const record = {
      ...interval, id: 'manual:clipped', taskId: null, title: 'Clipped work', planSnapshot: null,
      source: 'manual', progress: DO_PROGRESS.STARTED,
      createdAt: '2026-09-26T15:00:00.000Z', updatedAt: '2026-09-26T15:00:00.000Z',
      observedAt: '2026-09-26T15:00:00.000Z', deleted: false,
    };
    const target = resolveDropTarget({
      lane: 'do', type: 'do', date: '2026-09-27', minute: 60,
      item: { record, startMinute: 0 },
    });
    expect(target.interval).toEqual({
      timing: 'timed', date: '2026-09-27', startTime: '00:00',
      endDate: '2026-09-27', endTime: '02:00',
    });
    expect(target.minute).toBe(0);
    expect(target.visibleDuration).toBe(120);
  });
});

describe('moveDoInterval and resizeDoInterval', () => {
  const source = doIntervalAt('2026-09-26', 23 * 60 + 30, 90);
  const record = {
    ...source,
    id: 'manual:night',
    taskId: null,
    title: 'Night work',
    planSnapshot: null,
    source: 'manual',
    progress: DO_PROGRESS.STARTED,
    createdAt: '2026-09-26T15:00:00.000Z',
    updatedAt: '2026-09-26T15:00:00.000Z',
    observedAt: '2026-09-26T15:00:00.000Z',
    deleted: false,
  };

  it('moves the whole interval and retains its real cross-day duration', () => {
    expect(moveDoInterval(record, 60)).toEqual({
      timing: 'timed', date: '2026-09-27', startTime: '00:30',
      endDate: '2026-09-27', endTime: '02:00',
    });
  });

  it('resizes either edge and clamps to five minutes', () => {
    expect(resizeDoInterval(record, 'start', 40)).toEqual({
      timing: 'timed', date: '2026-09-27', startTime: '00:10',
      endDate: '2026-09-27', endTime: '01:00',
    });
    expect(resizeDoInterval(record, 'end', -1000)).toEqual({
      timing: 'timed', date: '2026-09-26', startTime: '23:30',
      endDate: '2026-09-26', endTime: '23:35',
    });
    expect(() => moveDoInterval({ ...record, timing: 'untimed', startTime: null, endDate: null, endTime: null }, 5)).toThrow();
    expect(() => resizeDoInterval(record, 'middle', 5)).toThrow();
  });
});

describe('createManualDo', () => {
  it('captures a linked recurring id and supplied plan/title once', () => {
    const plan = { date: '2026-09-26', startTime: '09:00', duration: 60 };
    const task = { id: 'occurrence-1', recurringTemplateId: 'routine-1', title: 'Live title' };
    const record = createManualDo({
      id: 'manual:1', title: 'Captured title', task, planSnapshot: plan,
      date: '2026-09-26', startMinute: 600, duration: 30, now: NOW,
    });
    expect(record.taskId).toBe('routine-1');
    expect(record.title).toBe('Captured title');
    expect(record.planSnapshot).toEqual(plan);
    expect(record.source).toBe('manual');
    expect(record.progress).toBe('started');
    task.title = 'Changed live title';
    plan.duration = 5;
    expect(record.title).toBe('Captured title');
    expect(record.planSnapshot.duration).toBe(60);
  });

  it('keeps null-task manual work independent and never creates completed progress', () => {
    const record = createManualDo({
      id: 'manual:independent', title: 'Unlinked work', date: '2026-09-26',
      startMinute: 60, now: NOW,
    });
    expect(record.taskId).toBeNull();
    expect(record.planSnapshot).toBeNull();
    expect(() => createManualDo({
      id: 'manual:bad', title: 'Bad', date: '2026-09-26', startMinute: 60,
      progress: DO_PROGRESS.COMPLETED, now: NOW,
    })).toThrow();
  });
});

describe('copyDoRecord', () => {
  const source = createManualDo({
    id: 'completion:original', title: 'Ship report',
    task: { id: 'task-1', title: 'Live title' },
    planSnapshot: { date: '2026-09-26', startTime: '09:00', duration: 60 },
    date: '2026-09-26', startMinute: 600, duration: 45, now: NOW,
  });

  it('creates a new manual attempt with the original link and snapshot', () => {
    const copied = copyDoRecord({
      records: [source], record: source, id: 'manual:copy',
      date: '2026-09-27', startMinute: 11 * 60, duration: 50, now: NOW + 1000,
    });
    expect(copied.id).toBe('manual:copy');
    expect(copied.id).not.toBe(source.id);
    expect(copied.source).toBe('manual');
    expect(copied.progress).toBe(DO_PROGRESS.STARTED);
    expect(copied.taskId).toBe(source.taskId);
    expect(copied.planSnapshot).toEqual(source.planSnapshot);
    expect(copied.date).toBe('2026-09-27');
    expect(copied.startTime).toBe('11:00');
    expect(copied.endTime).toBe('11:50');
    expect(copied).not.toHaveProperty('eventId');
  });

  it('downgrades a completed source and never copies completion identity fields', () => {
    const completed = { ...source, source: 'completion', progress: DO_PROGRESS.COMPLETED, eventId: 'completion-event' };
    const copied = copyDoRecord({
      records: [completed], record: completed, id: 'manual:from-completion',
      patch: doIntervalAt('2026-09-26', 12 * 60, 30), now: NOW + 2000,
    });
    expect(copied.source).toBe('manual');
    expect(copied.progress).toBe(DO_PROGRESS.STARTED);
    expect(copied.id).toBe('manual:from-completion');
    expect(copied).not.toHaveProperty('eventId');
    expect(copied.taskId).toBe(source.taskId);
    expect(copied.planSnapshot).toEqual(source.planSnapshot);
  });

  it('returns null for a stale opened record and does not build a duplicate', () => {
    const newer = { ...source, updatedAt: '2026-09-26T10:00:00.001Z' };
    expect(copyDoRecord({
      records: [newer], record: source, id: 'manual:stale',
      date: '2026-09-27', startMinute: 600, now: NOW + 1000,
    })).toBeNull();
  });

  it('requires a target interval when copying an untimed record', () => {
    const untimed = createDoRecord({
      id: 'manual:untimed', taskId: null, title: 'Unplanned', source: 'manual',
      progress: DO_PROGRESS.STARTED, timing: 'untimed', date: '2026-09-26',
      startTime: null, endDate: null, endTime: null, planSnapshot: null,
      createdAt: '2026-09-26T10:00:00.000Z', updatedAt: '2026-09-26T10:00:00.000Z',
      observedAt: '2026-09-26T10:00:00.000Z',
    });
    expect(() => copyDoRecord({ records: [untimed], record: untimed, id: 'manual:untimed-copy', now: NOW })).toThrow();
    expect(copyDoRecord({
      records: [untimed], record: untimed, id: 'manual:timed-copy',
      date: '2026-09-26', startMinute: 13 * 60, duration: 25, now: NOW + 1,
    }).timing).toBe('timed');
  });
});

describe('prepareDoEdit and prepareDoDelete', () => {
  const record = createManualDo({
    id: 'manual:edit', title: 'Edit me', date: '2026-09-26', startMinute: 600,
    duration: 30, now: NOW,
  });

  it('handles clock skew monotonically and reassesses progress in one prepared edit', () => {
    const next = prepareDoEdit({
      records: [record], record,
      patch: moveDoInterval(record, 30), progress: DO_PROGRESS.PARTIAL,
      now: NOW - 60 * 60 * 1000,
    });
    expect(next.date).toBe('2026-09-26');
    expect(next.startTime).toBe('10:30');
    expect(next.progress).toBe('partial');
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(record.updatedAt));
    expect(next.updatedAt).not.toBe(record.updatedAt);
  });

  it('returns null for stale/deleted rows and preserves no-op identity', () => {
    expect(prepareDoEdit({ records: [record], record, patch: {}, now: NOW })).toBe(record);
    const newer = { ...record, updatedAt: '2026-09-26T10:00:00.001Z' };
    expect(prepareDoEdit({ records: [newer], record, patch: moveDoInterval(record, 5), now: NOW })).toBeNull();
    const deleted = { ...record, deleted: true, updatedAt: '2026-09-26T10:00:00.001Z' };
    expect(prepareDoDelete({ records: [deleted], record, now: NOW })).toBeNull();
  });

  it('does not restore completed progress through a manual edit', () => {
    const completed = completeDoAttempt([], {
      id: 'do:t:stamp', taskId: 't', timing: 'untimed', date: '2026-09-26',
      startTime: null, endDate: null, endTime: null, title: 'Done',
      planSnapshot: null, createdAt: '2026-09-26T09:00:00.000Z',
      updatedAt: '2026-09-26T09:00:00.000Z', observedAt: '2026-09-26T09:00:01.000Z',
    })[0];
    expect(() => prepareDoEdit({
      records: [completed], record: completed, progress: DO_PROGRESS.COMPLETED, now: NOW,
    })).not.toThrow();
    expect(() => prepareDoEdit({
      records: [record], record, progress: DO_PROGRESS.COMPLETED, now: NOW,
    })).toThrow();
  });

  it('tombstones the current version without deleting history', () => {
    const deleted = prepareDoDelete({ records: [record], record, now: NOW - 1000 });
    expect(deleted.deleted).toBe(true);
    expect(deleted.id).toBe(record.id);
    expect(Date.parse(deleted.updatedAt)).toBeGreaterThan(Date.parse(record.updatedAt));
  });
});

describe('slice 4 detector and view lifecycle', () => {
  it('keeps one completion id through untimed capture, correction, reassessment, tombstone, and re-observation', () => {
    const task = {
      id: 'task-1', title: 'Ship report', date: '2026-09-26', startTime: '09:00', duration: 60,
      completed: false,
    };
    const done = { ...task, completed: true, completedAt: '2026-09-26T10:00:00.000Z' };
    const prev = snapshotJoboState([task], [], []);
    const next = snapshotJoboState([done], [], []);
    const edges = findJoboEdges(prev, next, { tasks: [done], unscheduledTasks: [], recurringTasks: [] });
    let [untimed] = buildJoboRecords(edges, [], { observedAt: '2026-09-26T10:00:01.000Z' });
    expect(untimed.timing).toBe('untimed');
    const corrected = prepareDoEdit({
      records: [untimed], record: untimed,
      patch: doIntervalAt('2026-09-26', 10 * 60, 30), now: NOW,
    });
    expect(corrected.id).toBe(untimed.id);
    const moved = prepareDoEdit({
      records: [corrected], record: corrected,
      patch: moveDoInterval(corrected, 15), now: NOW,
    });
    const resized = prepareDoEdit({
      records: [moved], record: moved,
      patch: resizeDoInterval(moved, 'end', 15), now: NOW,
    });
    const partial = prepareDoEdit({
      records: [resized], record: resized, progress: DO_PROGRESS.PARTIAL, now: NOW,
    });
    const tombstone = prepareDoDelete({ records: [partial], record: partial, now: NOW });
    expect(tombstone.id).toBe(untimed.id);
    const observedAgain = buildJoboRecords(edges, [tombstone], { observedAt: '2026-09-26T10:05:00.000Z' });
    expect(observedAgain).toEqual([]);
  });
});

describe('commitDoEdit', () => {
  it('accepts durable success and held retry ownership with one ledger call', async () => {
    const recordJobo = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: false, held: true, error: 'temporarily unavailable' });
    const record = { id: 'prepared' };
    await expect(commitDoEdit(recordJobo, record)).resolves.toEqual({ ok: true, value: [] });
    await expect(commitDoEdit(recordJobo, record)).resolves.toEqual({ ok: false, held: true, error: 'temporarily unavailable' });
    expect(recordJobo).toHaveBeenCalledTimes(2);
    expect(recordJobo).toHaveBeenNthCalledWith(1, [record]);
    expect(recordJobo).toHaveBeenNthCalledWith(2, [record]);
  });

  it('surfaces a rejected ledger result instead of writing elsewhere', async () => {
    const recordJobo = vi.fn().mockResolvedValue({ ok: false, error: 'readOnly' });
    await expect(commitDoEdit(recordJobo, { id: 'prepared' })).rejects.toThrow('readOnly');
    expect(recordJobo).toHaveBeenCalledTimes(1);
  });
});
