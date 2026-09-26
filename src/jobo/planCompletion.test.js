import { describe, expect, it } from 'vitest';
import { createDoRecord, doDurationMinutes } from './core.js';
import { preparePlanCompletion } from './planCompletion.js';

const DATE = '2026-09-27';
const STAMP = '2026-09-27T00:00:00.000Z';
const clock = (day = 27, hour = 10, minute = 45, second = 31) => new Date(2026, 8, day, hour, minute, second, 456).getTime();
const task = (patch = {}) => ({ id: 't1', title: 'Current Plan', date: DATE, startTime: '09:00', duration: 30, completed: false, ...patch });
const record = (patch = {}) => createDoRecord({
  id: 'manual:last', taskId: 't1', title: 'Captured title', source: 'manual', progress: 'mostly',
  timing: 'timed', date: DATE, startTime: '10:00', endDate: DATE, endTime: '11:00',
  planSnapshot: { date: DATE, startTime: '09:00', duration: 45 },
  createdAt: STAMP, updatedAt: STAMP, observedAt: STAMP, opaque: { keep: true }, ...patch,
});
const prepare = (records = [record()], options = {}) => {
  const plan = options.task || task();
  return preparePlanCompletion({ records, tasks: [plan], task: plan, now: clock(), id: 'manual:new', ...options });
};

describe('Plan checkbox completion at the current local time', () => {
  it('retains the actual start and captured identity while ending at now and completing the Do', () => {
    const before = record();
    const completed = prepare([before]);
    expect(completed).toMatchObject({ id: before.id, date: DATE, startTime: '10:00', endDate: DATE, endTime: '10:45', progress: 'completed', completedAt: new Date(clock()).toISOString() });
    expect(doDurationMinutes(completed)).toBe(45);
    expect(completed).not.toHaveProperty('timingBasis');
    for (const key of ['title', 'taskId', 'source', 'planSnapshot', 'createdAt', 'observedAt', 'opaque']) expect(completed[key]).toEqual(before[key]);
    expect(before.endTime).toBe('11:00');
  });

  it('only changes the last active timed Do and preserves a real start across midnight', () => {
    const earlier = record({ id: 'earlier', startTime: '09:00' });
    const last = record({ startTime: '23:40', endDate: '2026-09-28', endTime: '01:00' });
    const deleted = record({ id: 'deleted', date: '2026-09-29', endDate: '2026-09-29', deleted: true });
    const completed = prepare([deleted, last, earlier], { now: clock(28, 0, 10) });
    expect(completed).toMatchObject({ id: last.id, date: DATE, startTime: '23:40', endDate: '2026-09-28', endTime: '00:10' });
    expect(doDurationMinutes(completed)).toBe(30);
    expect(earlier.progress).toBe('mostly');
  });

  it('infers a new Do start from Plan duration, crossing to the previous local day', () => {
    const completed = prepare([], { now: clock(28, 0, 10), task: task({ duration: 45 }) });
    expect(completed).toMatchObject({ id: 'manual:new', taskId: 't1', source: 'manual', title: 'Current Plan', date: DATE, startTime: '23:25', endDate: '2026-09-28', endTime: '00:10', timingBasis: 'planDuration', progress: 'completed' });
    expect(doDurationMinutes(completed)).toBe(45);
    expect(completed.createdAt).toBe(new Date(clock(28, 0, 10)).toISOString());
  });

  it('converts an existing Untimed record under its original id and retains its capture fields', () => {
    const untimed = record({ id: 'do:t1:old-event', source: 'completion', timing: 'untimed', startTime: null, endDate: null, endTime: null });
    const completed = prepare([untimed]);
    expect(completed).toMatchObject({ id: untimed.id, source: 'completion', timing: 'timed', date: DATE, startTime: '10:15', endTime: '10:45', timingBasis: 'planDuration', progress: 'completed' });
    expect(completed.planSnapshot).toEqual(untimed.planSnapshot);
    expect(completed.createdAt).toBe(untimed.createdAt);
    expect(completed.observedAt).toBe(untimed.observedAt);
  });

  it.each(['10:45', '12:00'])('replaces unusable start %s with an inferred positive interval instead of a zero/negative duration', startTime => {
    const completed = prepare([record({ startTime, endTime: '13:00' })]);
    expect(completed).toMatchObject({ startTime: '10:15', endTime: '10:45', timingBasis: 'planDuration' });
    expect(doDurationMinutes(completed)).toBe(30);
  });

  it('retains exact completion seconds separately from minute interval precision', () => {
    const now = clock(28, 0, 0, 59);
    const completed = prepare([], { now, task: task({ duration: 15 }) });
    expect(completed).toMatchObject({ date: DATE, startTime: '23:45', endDate: '2026-09-28', endTime: '00:00' });
    expect(completed.completedAt).toBe(new Date(now).toISOString());
  });

  it.each([undefined, 0, -1, 1.5, '30'])('rejects unusable Plan duration %s when inference is required without guessing a default', duration => {
    expect(() => prepare([], { task: task({ duration }) })).toThrow(RangeError);
    // A usable real start needs no duration estimate.
    expect(prepare([record()], { task: task({ duration }) }).startTime).toBe('10:00');
  });

  it('rejects reused ids, invalid clocks and pending changes; skips checked or read-only tasks', () => {
    expect(() => prepare([record({ id: 'manual:new', taskId: 'other' })])).toThrow(/fresh Do identity/);
    expect(() => prepare([], { now: NaN })).toThrow(TypeError);
    expect(prepare([record()], { pendingIds: ['manual:last'] })).toBeNull();
    expect(prepare([record()], { task: task({ completed: true }) })).toBeNull();
    expect(prepare([record()], { task: task({ imported: true }) })).toBeNull();
    expect(prepare([record()], { task: task({ isJoboSyntheticOccurrence: true }) })).toBeNull();
  });

  it('keeps the recurring capture instance separate from another day even when actual Do time moves', () => {
    const template = { id: 'repeat', completedDates: [] };
    const plan = task({ id: 'recurring-repeat-2026-09-27', recurringTemplateId: 'repeat' });
    const wanted = record({ taskId: 'repeat' });
    const other = record({ id: 'other-day', taskId: 'repeat', date: '2026-09-28', endDate: '2026-09-28', planSnapshot: { date: '2026-09-28', startTime: '09:00', duration: 30 } });
    const completed = prepare([wanted, other], { task: plan, tasks: [], recurringTasks: [template] });
    expect(completed.id).toBe(wanted.id);
    expect(completed.planSnapshot.date).toBe(DATE);
    expect(prepare([], { task: plan, tasks: [], recurringTasks: [template] })).toMatchObject({ taskId: 'repeat', planSnapshot: { date: DATE }, timingBasis: 'planDuration' });
  });

  it('always versions a new explicit completion and preserves an earlier inferred-start label', () => {
    const before = record({ progress: 'completed', endTime: '10:45', timingBasis: 'planDuration', updatedAt: '2099-01-01T00:00:00.000Z' });
    const completed = prepare([before]);
    expect(completed.updatedAt).toBe('2099-01-01T00:00:00.001Z');
    expect(completed.completedAt).toBe(new Date(clock()).toISOString());
    expect(completed.timingBasis).toBe('planDuration');
  });
});
