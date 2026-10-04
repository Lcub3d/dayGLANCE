import { describe, it, expect } from 'vitest';
import { createDoRecord } from './core.js';
import { buildPastDayIndex, pastDayDisplay, pastDayItems, todayEndedTasks } from './pastDay.js';

// The addendum to docs/jobo-past-days.md: a plan block gives way to its Do
// only once the task is completed (Lcub3d on #1726), on every date, and on
// today only once the block has ended, at the NOW line.

const TODAY = '2026-10-03';
const PAST = '2026-10-01';
const stamp = `${TODAY}T18:00:00.000Z`;
const at = (h, m = 0) => h * 60 + m;
const task = (id, over = {}) => ({ id, title: id, date: TODAY, startTime: '09:00', duration: 60, color: 'bg-blue-500', completed: false, ...over });
const doOn = (taskId, date, startTime, endTime, over = {}) => createDoRecord({
  id: `manual:${taskId}:${date}:${startTime}`, taskId, title: taskId, source: 'manual', progress: 'partial',
  timing: 'timed', date, startTime, endDate: date, endTime, planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
const index = (records, taskLookup) => buildPastDayIndex({ records, taskLookup });
const ids = (items) => items.map((item) => (item.joboDo ? `do:${item.joboTaskId}` : item.id));

describe('a plan block gives way to its Do only once the task is done', () => {
  // MUTATION: drop the completed check and a half-done task's plan vanishes,
  // which is what Lcub3d asked us not to do.
  it('on a past day, an unfinished task keeps its block beside its Do', () => {
    const half = task('half', { date: PAST });
    const items = pastDayItems({ dateStr: PAST, dayTasks: [half], index: index([doOn('half', PAST, '09:00', '09:30')], [half]) });
    expect(ids(items)).toEqual(['half', 'do:half']);
  });

  it('on a past day, a completed task shows its Do alone', () => {
    const done = task('done', { date: PAST, completed: true });
    const items = pastDayItems({ dateStr: PAST, dayTasks: [done], index: index([doOn('done', PAST, '09:00', '10:00')], [done]) });
    expect(ids(items)).toEqual(['do:done']);
  });

  it('decides by the task, not the Do: a Completed session on an unchecked task keeps the block, a Partial one on a checked task does not', () => {
    const unchecked = task('a', { date: PAST });
    const checked = task('b', { date: PAST, startTime: '11:00', completed: true });
    const records = [doOn('a', PAST, '09:00', '10:00', { progress: 'completed' }), doOn('b', PAST, '11:00', '11:30', { progress: 'partial' })];
    const items = pastDayItems({ dateStr: PAST, dayTasks: [unchecked, checked], index: index(records, [unchecked, checked]) });
    expect(ids(items)).toEqual(['a', 'do:a', 'do:b']);
  });

  it('on a past day, an all-day task follows the same rule', () => {
    const allDayDone = task('ad', { date: PAST, isAllDay: true, completed: true, startTime: '00:00' });
    const allDayOpen = task('ao', { date: PAST, isAllDay: true, startTime: '00:00' });
    const records = [doOn('ad', PAST, '09:00', '10:00'), doOn('ao', PAST, '11:00', '12:00')];
    expect(ids(pastDayItems({ dateStr: PAST, dayTasks: [allDayDone, allDayOpen], index: index(records, [allDayDone, allDayOpen]) })))
      .toEqual(['ao', 'do:ad', 'do:ao']);
  });
});

describe('today, at the NOW line', () => {
  const done = task('done', { completed: true });                                   // 09:00-10:00, done
  const half = task('half', { startTime: '11:00' });                                // 11:00-12:00, unfinished
  const later = task('later', { startTime: '15:00', completed: true });             // 15:00-16:00, done early
  const allDay = task('allDay', { isAllDay: true, startTime: '00:00', completed: true });
  const dayTasks = [done, half, later, allDay];
  const records = [
    doOn('done', TODAY, '09:10', '09:55'),
    doOn('half', TODAY, '11:00', '11:30'),
    doOn('later', TODAY, '08:00', '08:40'),
    doOn('allDay', TODAY, '07:00', '07:20'),
  ];
  const idx = index(records, dayTasks);
  const show = (nowMinute) => {
    const ended = todayEndedTasks({ dateStr: TODAY, dayTasks, index: idx, nowMinute });
    return pastDayDisplay({ dateStr: TODAY, todayStr: TODAY, dayTasks, index: idx, todayEnded: ended.ids });
  };

  it('draws today\'s Do, and keeps every block that has not ended', () => {
    // 09:30: nothing has ended, so every block stays, and every Do is drawn.
    expect(ids(show(at(9, 30)))).toEqual(['done', 'half', 'later', 'allDay', 'do:allDay', 'do:later', 'do:done', 'do:half']);
  });

  // MUTATION: replace on completion alone and a task finished early loses its
  // block ahead of NOW; drop the end check entirely and the same.
  it('swaps a completed task\'s block for its Do once the block has ended, and not before', () => {
    expect(ids(show(at(9, 59)))).toContain('done');
    expect(ids(show(at(10, 0)))).not.toContain('done');       // the boundary: an end at NOW has ended
    expect(ids(show(at(10, 0)))).toContain('do:done');
    expect(ids(show(at(16, 0)))).not.toContain('later');      // done early, swapped at its end
    expect(ids(show(at(15, 59)))).toContain('later');
  });

  it('keeps an unfinished task\'s block after it ends, beside its Do', () => {
    expect(ids(show(at(13, 0)))).toEqual(expect.arrayContaining(['half', 'do:half']));
  });

  it('keeps an all-day task in its row all day', () => {
    expect(ids(show(at(23, 59)))).toContain('allDay');
    expect(todayEndedTasks({ dateStr: TODAY, dayTasks, index: idx, nowMinute: at(23, 59) }).ids.has('allDay')).toBe(false);
  });

  it('leaves today unchanged without the ended set, and later days always', () => {
    expect(pastDayDisplay({ dateStr: TODAY, todayStr: TODAY, dayTasks, index: idx })).toBe(dayTasks);
    expect(pastDayDisplay({ dateStr: '2026-10-04', todayStr: TODAY, dayTasks, index: idx, todayEnded: new Set(['done']) })).toBe(dayTasks);
  });

  it('a task with no Do shows as planned, ended or not', () => {
    const untouched = task('untouched', { startTime: '06:00', completed: true });
    const both = [untouched];
    const ended = todayEndedTasks({ dateStr: TODAY, dayTasks: both, index: idx, nowMinute: at(20) });
    expect(ended.ids.size).toBe(0);
    expect(pastDayDisplay({ dateStr: TODAY, todayStr: TODAY, dayTasks: both, index: idx, todayEnded: ended.ids })).toContain(untouched);
  });

  // The views memoize on the key, so it must hold still between swaps and
  // move at one.
  it('keys the ended set so it changes only at a block\'s end or a completion', () => {
    const key = (nowMinute, tasks = dayTasks) => todayEndedTasks({ dateStr: TODAY, dayTasks: tasks, index: idx, nowMinute }).key;
    expect(key(at(10, 1))).toBe(key(at(14, 59)));
    expect(key(at(10, 1))).not.toBe(key(at(16, 0)));
    const halfDone = dayTasks.map((t) => (t.id === 'half' ? { ...t, completed: true } : t));
    expect(key(at(13), halfDone)).not.toBe(key(at(13)));
  });

  it('takes the part of a Do that crossed midnight into today', () => {
    const late = task('late', { startTime: '00:00', duration: 30, completed: true });
    const crossing = doOn('late', '2026-10-02', '23:30', '00:20', { endDate: TODAY });
    const lateIdx = index([crossing], [late]);
    const ended = todayEndedTasks({ dateStr: TODAY, dayTasks: [late], index: lateIdx, nowMinute: at(1) });
    const items = pastDayDisplay({ dateStr: TODAY, todayStr: TODAY, dayTasks: [late], index: lateIdx, todayEnded: ended.ids });
    expect(ids(items)).toEqual(['do:late']);
    expect(items[0]).toMatchObject({ startTime: '00:00', duration: 20, joboClippedStart: true });
  });

  it('applies to a recurring occurrence by its own completion', () => {
    const occ = task('recurring-r1-2026-10-03', { completed: true, isRecurring: true });
    const occIdx = index([doOn('recurring-r1-2026-10-03', TODAY, '09:00', '09:45')], [occ]);
    const ended = todayEndedTasks({ dateStr: TODAY, dayTasks: [occ], index: occIdx, nowMinute: at(10, 30) });
    expect(ids(pastDayDisplay({ dateStr: TODAY, todayStr: TODAY, dayTasks: [occ], index: occIdx, todayEnded: ended.ids })))
      .toEqual(['do:recurring-r1-2026-10-03']);
  });

  it('is unchanged with JOBO off (no index)', () => {
    expect(pastDayDisplay({ dateStr: TODAY, todayStr: TODAY, dayTasks, index: null, todayEnded: new Set(['done']) })).toBe(dayTasks);
    expect(todayEndedTasks({ dateStr: TODAY, dayTasks, index: null, nowMinute: at(23) }).ids.size).toBe(0);
  });
});
