import { describe, it, expect } from 'vitest';
import { monthStats } from './monthStats.js';

const t = (id, date, extra = {}) => ({ id, title: id, date, startTime: '09:00', duration: 30, completed: false, ...extra });

describe('monthStats', () => {
  const tasks = [
    t('a', '2026-09-02', { completed: true }),
    t('b', '2026-09-10'),
    t('c', '2026-09-13', { completed: true }),
    t('future', '2026-09-20'),            // after today: not counted
    t('aug', '2026-08-31', { completed: true }), // previous month
    t('ev', '2026-09-05', { imported: true }),   // an event, never a task
    t('ex', '2026-09-06', { isExample: true }),  // the onboarding sample
  ];
  const unscheduled = [
    { id: 'dl1', title: 'due', deadline: '2026-09-08', completed: false },
    { id: 'dl2', title: 'due done', deadline: '2026-09-09', completed: true },
    { id: 'dl3', title: 'later', deadline: '2026-09-25', completed: false },
    { id: 'bucket', title: 'someday', deadline: '2026-09-03', bucketId: 'b1', completed: false },
  ];
  const recurring = [
    { id: 'r1', title: 'weekly', recurrence: { type: 'weekly', daysOfWeek: [1], startDate: '2026-08-03' }, completedDates: ['2026-09-07'], exceptions: {} },
  ];

  it('counts the current month through today with the summary definitions', () => {
    // Mondays in September 2026 through the 13th: the 7th only (completed).
    const s = monthStats({ tasks, unscheduledTasks: unscheduled, recurringTasks: recurring, year: 2026, month: 9, today: '2026-09-13' });
    expect(s).toEqual({ counted: true, from: '2026-09-01', to: '2026-09-13', scheduled: 3 + 2 + 1, completed: 2 + 1 + 1, incomplete: 2 });
  });

  it('counts a past month in full and a future month not at all', () => {
    const past = monthStats({ tasks, unscheduledTasks: unscheduled, recurringTasks: recurring, year: 2026, month: 8, today: '2026-09-13' });
    // Mondays in August 2026 from the template's start on the 3rd: 3, 10, 17, 24, 31.
    expect(past).toEqual({ counted: true, from: '2026-08-01', to: '2026-08-31', scheduled: 1 + 5, completed: 1, incomplete: 5 });
    const future = monthStats({ tasks, year: 2026, month: 10, today: '2026-09-13' });
    expect(future.counted).toBe(false);
    expect(future.scheduled).toBe(0);
  });

  it('respects the per-user visibility filter and the bucket list', () => {
    const s = monthStats({ tasks, unscheduledTasks: unscheduled, year: 2026, month: 9, today: '2026-09-30', isVisibleForUser: (x) => x.id !== 'b' && x.id !== 'dl3' });
    expect(s.scheduled).toBe(3 + 2); // a, c, future; dl1, dl2 (bucket excluded, dl3 hidden)
    expect(s.incomplete).toBe(1 + 1);
  });

  it('handles an empty month and a month of 31 days at the year end', () => {
    expect(monthStats({ tasks: [], year: 2026, month: 12, today: '2027-01-15' })).toEqual({ counted: true, from: '2026-12-01', to: '2026-12-31', scheduled: 0, completed: 0, incomplete: 0 });
  });
});
