import { describe, it, expect } from 'vitest';
import { createDoRecord } from './core.js';
import { buildPastDayIndex, doSessionsByTask } from './pastDay.js';

// SCHED's Do badge reads a task's timed Do on its date from the same index as
// the past-day cards, so the two always agree.
const DAY = '2026-09-24';
const stamp = `${DAY}T18:00:00.000Z`;
const plan = { date: DAY, startTime: '09:00', duration: 60 };
const report = { id: 't1', title: 'Write the report', date: DAY, startTime: '09:00', duration: 60, color: 'bg-blue-500', completed: true };
const theirs = { id: 't3', title: 'Their task', date: DAY, startTime: '11:00', duration: 30, assignedUserSyncIds: ['u2'] };
const timed = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: 't1', title: 'Write the report', source: 'manual', progress: 'partial',
  timing: 'timed', date: DAY, startTime: '09:30', endDate: DAY, endTime: '10:15', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
const sessions = (records, { date = DAY, taskLookup = [report, theirs], isVisibleForUser } = {}) =>
  doSessionsByTask({ dateStr: date, index: buildPastDayIndex({ records, taskLookup }), isVisibleForUser });

describe('doSessionsByTask', () => {
  it('lists a task\'s timed Do on the date, in time order, with progress', () => {
    const byTask = sessions([timed({ id: 'manual:2', startTime: '14:00', endTime: '14:30', progress: 'completed' }), timed()]);
    expect(byTask.get('t1')).toEqual([
      { recordId: 'manual:1', startMinute: 570, endMinute: 615, progress: 'partial', clippedStart: false, clippedEnd: false },
      { recordId: 'manual:2', startMinute: 840, endMinute: 870, progress: 'completed', clippedStart: false, clippedEnd: false },
    ]);
  });

  // Only measured Do leave JOBO: an untimed completion, or an interval
  // inferred from the plan's duration, is not a session.
  it('leaves out untimed Do and intervals inferred from the plan', () => {
    const untimed = timed({ id: 'do:x', timing: 'untimed', startTime: null, endDate: null, endTime: null });
    const inferred = timed({ id: 'manual:i', timingBasis: 'planDuration' });
    expect(sessions([untimed, inferred]).size).toBe(0);
  });

  it('marks the cut end of a session crossing midnight, on each day', () => {
    const late = timed({ date: '2026-09-23', startTime: '23:30', endDate: DAY, endTime: '00:45' });
    expect(sessions([late]).get('t1')[0]).toMatchObject({ startMinute: 0, endMinute: 45, clippedStart: true, clippedEnd: false });
    expect(sessions([late], { date: '2026-09-23' }).get('t1')[0]).toMatchObject({ startMinute: 1410, clippedEnd: true });
  });

  it('has nothing for unlinked Do, a Do whose task is gone, or another member\'s task', () => {
    const unlinked = timed({ id: 'manual:u', taskId: null, planSnapshot: null });
    const orphan = timed({ id: 'manual:o', taskId: 'gone' });
    const other = timed({ id: 'manual:3', taskId: 't3' });
    const byTask = sessions([unlinked, orphan, other], { isVisibleForUser: (task) => !task.assignedUserSyncIds?.includes('u2') });
    expect([...byTask.keys()]).toEqual([]);
  });

  it('is empty without an index or on a date with no Do', () => {
    expect(doSessionsByTask({ dateStr: DAY, index: null }).size).toBe(0);
    expect(sessions([timed()], { date: '2026-09-25' }).size).toBe(0);
  });
});
