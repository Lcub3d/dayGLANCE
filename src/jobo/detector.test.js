import { describe, it, expect, vi } from 'vitest';
import {
  snapshotJoboState, findJoboEdges, planJoboTransitions, buildJoboRecords,
  civilDateOf, planSnapshotOf, completionKey, recurringKey,
} from './detector.js';
import { createDoRecord, tombstoneDoRecord, reassessDoProgress, DO_PROGRESS } from './core.js';

// The detector's load-bearing claims: only edges make records, first sight
// never does, the key is the task's own completion stamp and never this
// device's clock, creation is ensure-present, a completion is untimed with the
// plan captured as it stands, an uncheck targets the previous key and drops
// the attempt to Partially completed, and the gate holds or consumes exactly
// as the design says. The mutation that must break each one is named beside it.

const DONE_AT = '2026-09-19T15:10:02-05:00';       // completionTimestamp(): local with offset
const DONE_Z = '2026-09-19T20:10:02.000Z';          // the recurring stamp: toISOString()
const OBSERVED = '2026-09-19T20:10:03.418Z';
const snap = (tasks = [], inbox = [], recurring = []) => snapshotJoboState(tasks, inbox, recurring);
const task = (over = {}) => ({ id: 't1', title: 'Draft the report', date: '2026-09-19', startTime: '14:30', duration: 60, completed: false, ...over });
const done = (t, completedAt = DONE_AT) => ({ ...t, completed: true, completedAt });
const template = (over = {}) => ({ id: 'r1', title: 'Gym', startTime: '07:00', duration: 45, completedDates: [], completedDatesTimestamps: {}, ...over });

describe('the snapshot', () => {
  it('keeps the completion stamp, since the uncheck erases it from the live task', () => {
    const s = snap([done(task()), task({ id: 't2' }), done(task({ id: 't3' }), null)], [], [template({ completedDates: ['2026-09-18'], completedDatesTimestamps: { '2026-09-18': DONE_Z } })]);
    expect(s.items).toEqual({ t1: DONE_AT, t2: false, t3: true });
    expect(s.recurring).toEqual({ r1: { '2026-09-18': DONE_Z } });
  });
});

describe('edges', () => {
  it('a false→true edge is a completion; first sight and already-completed are not', () => {
    const prev = snap([task(), done(task({ id: 'old' }))]);
    const tasks = [done(task()), done(task({ id: 'old' })), done(task({ id: 'arrived' }))];
    const { completions, uncompletions } = findJoboEdges(prev, snap(tasks), { tasks });
    expect(completions.map((c) => c.id)).toEqual([completionKey('t1', DONE_AT)]);
    expect(uncompletions).toEqual([]);
  });

  it('the key is the task\'s own stamp, and the record is untimed with the plan captured as it stands', () => {
    const prev = snap([task()]);
    const tasks = [done(task())];
    const [c] = findJoboEdges(prev, snap(tasks), { tasks }).completions;
    expect(c).toEqual({
      id: 'do:t1:2026-09-19T15:10:02-05:00', taskId: 't1', title: 'Draft the report',
      date: '2026-09-19', planSnapshot: { date: '2026-09-19', startTime: '14:30', duration: 60 }, completedAt: DONE_AT,
    });
    // MUTATION: key on the observing device's clock and this fails on the
    // second device (see the sync scenario) and here.
    const [again] = findJoboEdges(prev, snap(tasks), { tasks }).completions;
    expect(again.id).toBe(c.id);
  });

  it('an inbox task, or one without a timed plan, captures planSnapshot null rather than inventing one', () => {
    const prev = snap([], [{ id: 'i1', title: 'Call mum', completed: false }]);
    const unscheduledTasks = [{ id: 'i1', title: 'Call mum', completed: true, completedAt: DONE_AT }];
    const [c] = findJoboEdges(prev, snap([], unscheduledTasks), { unscheduledTasks }).completions;
    expect(c.planSnapshot).toBe(null);
    expect(planSnapshotOf(task({ duration: 0 }))).toBe(null);
    expect(planSnapshotOf(task({ startTime: undefined }))).toBe(null);
  });

  it('a completion with no stamp makes no record: there is no source event to key on', () => {
    const prev = snap([task()]);
    const tasks = [done(task(), null)];
    expect(findJoboEdges(prev, snap(tasks), { tasks }).completions).toEqual([]);
  });

  it('an uncheck targets the record by the PREVIOUS key, which the live task no longer carries', () => {
    const prev = snap([done(task())]);
    const tasks = [{ ...task(), completed: false, completedAt: null }];
    const { uncompletions } = findJoboEdges(prev, snap(tasks), { tasks });
    expect(uncompletions).toEqual([{ id: completionKey('t1', DONE_AT), uncheckedAt: null }]);
  });

  it('a recurring occurrence keys on template, instance date and the per-date stamp; the record date is the instance date', () => {
    const prev = snap([], [], [template()]);
    const recurringTasks = [template({ completedDates: ['2026-09-18'], completedDatesTimestamps: { '2026-09-18': DONE_Z } })];
    const [c] = findJoboEdges(prev, snap([], [], recurringTasks), { recurringTasks }).completions;
    expect(c).toEqual({
      id: 'do:r1:2026-09-18:2026-09-19T20:10:02.000Z', taskId: 'r1', title: 'Gym',
      date: '2026-09-18', planSnapshot: { date: '2026-09-18', startTime: '07:00', duration: 45 }, completedAt: DONE_Z,
    });
  });

  it('legacy recurring rule: no stamp keys on template and date alone, and a stamp appearing later is not a transition', () => {
    const prev = snap([], [], [template()]);
    const without = [template({ completedDates: ['2026-09-18'] })];
    const [c] = findJoboEdges(prev, snap([], [], without), { recurringTasks: without }).completions;
    expect(c.id).toBe(recurringKey('r1', '2026-09-18', null));
    expect(c.completedAt).toBe(null);
    const withStamp = [template({ completedDates: ['2026-09-18'], completedDatesTimestamps: { '2026-09-18': DONE_Z } })];
    const later = findJoboEdges(snap([], [], without), snap([], [], withStamp), { recurringTasks: withStamp });
    expect(later.completions).toEqual([]);
    expect(later.uncompletions).toEqual([]);
  });

  it('a recurring uncheck carries the source stamp of the uncheck, which overwrote the completion stamp', () => {
    const UNCHECK = '2026-09-19T21:00:00.000Z';
    const prev = snap([], [], [template({ completedDates: ['2026-09-18'], completedDatesTimestamps: { '2026-09-18': DONE_Z } })]);
    const recurringTasks = [template({ completedDates: [], completedDatesTimestamps: { '2026-09-18': UNCHECK } })];
    const { uncompletions } = findJoboEdges(prev, snap([], [], recurringTasks), { recurringTasks });
    expect(uncompletions).toEqual([{ id: recurringKey('r1', '2026-09-18', DONE_Z), uncheckedAt: UNCHECK }]);
  });
});

describe('civilDateOf', () => {
  it('reads the completing device\'s date from an offset stamp, whatever this device\'s zone', () => {
    expect(civilDateOf('2026-09-19T23:50:00-05:00')).toBe('2026-09-19'); // 04:50Z next day
    expect(civilDateOf('2026-09-20T00:10:00+09:00')).toBe('2026-09-20'); // 15:10Z previous day
  });
  it('falls back to the local date of a zoneless or Z stamp', () => {
    const d = new Date('2026-09-19T20:10:02.000Z');
    const pad = (n) => String(n).padStart(2, '0');
    expect(civilDateOf('2026-09-19T20:10:02.000Z')).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  });
});

describe('the gate', () => {
  const prev = snap([task()]);
  const tasks = [done(task())];
  const next = snap(tasks);

  it('first sight advances without edges', () => {
    expect(planJoboTransitions(null, next, { tasks })).toEqual({ edges: null, advanceTo: next });
  });
  it('a remote apply HOLDS: the edge is still there on the next quiet render', () => {
    expect(planJoboTransitions(prev, next, { tasks, isRemoteApply: true })).toEqual({ edges: null, advanceTo: null });
    expect(planJoboTransitions(prev, next, { tasks }).edges.completions).toHaveLength(1);
  });
  it('the flag off CONSUMES: no record, and no retro-creation on enable', () => {
    expect(planJoboTransitions(prev, next, { tasks, enabled: false })).toEqual({ edges: null, advanceTo: next });
  });
  it('not loaded HOLDS, read-only CONSUMES, in flight HOLDS', () => {
    expect(planJoboTransitions(prev, next, { tasks, loaded: false })).toEqual({ edges: null, advanceTo: null });
    expect(planJoboTransitions(prev, next, { tasks, writable: false })).toEqual({ edges: null, advanceTo: next });
    expect(planJoboTransitions(prev, next, { tasks, inFlight: true })).toEqual({ edges: null, advanceTo: null });
  });
  it('edges come with a held snapshot; no edges advance it', () => {
    expect(planJoboTransitions(prev, next, { tasks }).advanceTo).toBe(null);
    expect(planJoboTransitions(next, next, { tasks })).toEqual({ edges: null, advanceTo: next });
  });
});

describe('building records', () => {
  const edgesFor = (prevTasks, tasks) => findJoboEdges(snap(prevTasks), snap(tasks), { tasks });

  it('a completion becomes an untimed Completed attempt anchored to the completion stamp, observed now', () => {
    const [r] = buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED });
    expect(r).toEqual({
      id: 'do:t1:2026-09-19T15:10:02-05:00', taskId: 't1', timing: 'untimed',
      date: '2026-09-19', startTime: null, endDate: null, endTime: null,
      title: 'Draft the report', planSnapshot: { date: '2026-09-19', startTime: '14:30', duration: 60 },
      source: 'completion', progress: 'completed',
      createdAt: DONE_AT, updatedAt: DONE_AT, observedAt: OBSERVED, deleted: false,
    });
  });

  // MUTATION: replace completeDoAttempt with createDoRecord and the late
  // observer overwrites the user's reassessment.
  it('ensure-present: re-observing a completion whose record exists writes nothing, even when the copy differs', () => {
    const existing = reassessDoProgress(
      buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED })[0],
      DO_PROGRESS.MOSTLY, '2026-09-19T21:00:00.000Z',
    );
    const renamed = done(task({ title: 'Draft the report, second pass' }));
    expect(buildJoboRecords(edgesFor([task()], [renamed]), [existing], { observedAt: '2026-09-20T09:00:00.000Z' })).toEqual([]);
  });

  it('an uncheck drops the attempt to Partially completed under the same id, with a later version', () => {
    const [completed] = buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED });
    const unchecked = [{ ...task(), completed: false, completedAt: null }];
    const [r] = buildJoboRecords(edgesFor([done(task())], unchecked), [completed], { observedAt: '2026-09-19T21:00:00.000Z' });
    expect(r.id).toBe(completed.id);
    expect(r.progress).toBe('partial');
    expect(r.updatedAt).toBe('2026-09-19T21:00:00.000Z');
    expect(r.planSnapshot).toEqual(completed.planSnapshot); // interval and snapshot kept
    expect(r.deleted).toBe(false);
  });

  it('a recurring uncheck versions on the uncheck stamp, the source event, not this device\'s clock', () => {
    const UNCHECK = '2026-09-19T21:00:00.000Z';
    const before = [template({ completedDates: ['2026-09-18'], completedDatesTimestamps: { '2026-09-18': DONE_Z } })];
    const [completed] = buildJoboRecords(findJoboEdges(snap([], [], [template()]), snap([], [], before), { recurringTasks: before }), [], { observedAt: OBSERVED });
    const after = [template({ completedDates: [], completedDatesTimestamps: { '2026-09-18': UNCHECK } })];
    const [r] = buildJoboRecords(findJoboEdges(snap([], [], before), snap([], [], after), { recurringTasks: after }), [completed], { observedAt: '2026-09-19T23:00:00.000Z' });
    expect(r.updatedAt).toBe(UNCHECK);
    expect(r.progress).toBe('partial');
  });

  it('an uncheck against an absent, tombstoned, or already-reassessed record writes nothing', () => {
    const [completed] = buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED });
    const edges = edgesFor([done(task())], [{ ...task(), completed: false, completedAt: null }]);
    const at = '2026-09-19T21:00:00.000Z';
    expect(buildJoboRecords(edges, [], { observedAt: at })).toEqual([]);
    expect(buildJoboRecords(edges, [tombstoneDoRecord(completed, at)], { observedAt: at })).toEqual([]);
    expect(buildJoboRecords(edges, [reassessDoProgress(completed, DO_PROGRESS.MOSTLY, at)], { observedAt: at })).toEqual([]);
  });

  it('an uncheck whose stamps are not later than the record still gets a later version', () => {
    const [completed] = buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED });
    const edges = edgesFor([done(task())], [{ ...task(), completed: false, completedAt: null }]);
    const [r] = buildJoboRecords(edges, [completed], { observedAt: '2026-09-19T10:00:00.000Z' }); // a clock behind the event
    expect(Date.parse(r.updatedAt)).toBeGreaterThan(Date.parse(completed.updatedAt));
  });

  it('completing again after an uncheck is a NEW attempt under a new key; the first is untouched', () => {
    const [first] = buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED });
    const unchecked = [{ ...task(), completed: false, completedAt: null }];
    const [partial] = buildJoboRecords(edgesFor([done(task())], unchecked), [first], { observedAt: '2026-09-19T21:00:00.000Z' });
    const AGAIN = '2026-09-19T17:30:00-05:00';
    const [second] = buildJoboRecords(edgesFor(unchecked, [done(task(), AGAIN)]), [partial], { observedAt: '2026-09-19T22:30:00.000Z' });
    expect(second.id).toBe(completionKey('t1', AGAIN));
    expect(second.id).not.toBe(first.id);
    expect(second.progress).toBe('completed');
  });

  it('a record core refuses is skipped with a warning and does not block the others', () => {
    const warn = vi.fn();
    const bad = done(task({ id: 'bad', title: 'x' }), 'not a stamp at all');
    // snapshotJoboState keeps only parseable stamps, so an unparseable one is
    // "completed, stamp unknown" and never reaches core; force one through.
    const edges = { completions: [
      { id: 'do:bad:x', taskId: 'bad', title: 'x', date: 'nope', planSnapshot: null, completedAt: bad.completedAt },
      ...edgesFor([task()], [done(task())]).completions,
    ] };
    const out = buildJoboRecords(edges, [], { observedAt: OBSERVED, warn });
    expect(out.map((r) => r.id)).toEqual([completionKey('t1', DONE_AT)]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('every record it returns is a valid core record', () => {
    const [r] = buildJoboRecords(edgesFor([task()], [done(task())]), [], { observedAt: OBSERVED });
    expect(() => createDoRecord(r)).not.toThrow();
  });
});
