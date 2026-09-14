import { describe, it, expect } from 'vitest';
import { monthStats } from './monthStats.js';

const t = (id, date, extra = {}) => ({ id, title: id, date, startTime: '09:00', duration: 30, completed: false, ...extra });

describe('monthStats', () => {
  const tasks = [
    t('a', '2026-09-02', { completed: true, focusMinutes: 12 }),
    t('b', '2026-09-10'),
    t('c', '2026-09-13', { completed: true, duration: 45 }),
    t('future', '2026-09-20'),            // after today: not counted
    t('aug', '2026-08-31', { completed: true }), // previous month
    t('ev', '2026-09-05', { imported: true }),   // an event, never a task
    t('ex', '2026-09-06', { isExample: true }),  // the onboarding sample
  ];
  const unscheduled = [
    { id: 'dl1', title: 'due', deadline: '2026-09-08', duration: 20, completed: false },
    { id: 'dl2', title: 'due done', deadline: '2026-09-09', duration: 20, completed: true, focusMinutes: 8 },
    { id: 'dl3', title: 'later', deadline: '2026-09-25', completed: false },
    { id: 'bucket', title: 'someday', deadline: '2026-09-03', bucketId: 'b1', completed: false },
    { id: 'in1', title: 'inbox done', completed: true, completedAt: '2026-09-04T10:00:00.000Z' },
    { id: 'in2', title: 'inbox done later', completed: true, completedAt: '2026-09-19T10:00:00.000Z' }, // after today
    { id: 'in3', title: 'inbox done in aug', completed: true, completedAt: '2026-08-20T10:00:00.000Z' },
    { id: 'in4', title: 'inbox open', completed: false },
    { id: 'pq', title: 'project queue done', projectId: 'p1', completed: true, completedAt: '2026-09-04T10:00:00.000Z' },
    { id: 'inb', title: 'inbox done in a bucket', bucketId: 'b1', completed: true, completedAt: '2026-09-04T10:00:00.000Z' },
  ];
  const recurring = [
    { id: 'r1', title: 'weekly', duration: 15, recurrence: { type: 'weekly', daysOfWeek: [1], startDate: '2026-08-03' }, completedDates: ['2026-09-07'], exceptions: {} },
  ];

  it('counts the current month through today with the summary definitions', () => {
    // Mondays in September 2026 through the 13th: the 7th only (completed).
    const s = monthStats({ tasks, unscheduledTasks: unscheduled, recurringTasks: recurring, year: 2026, month: 9, today: '2026-09-13' });
    expect(s).toEqual({
      counted: true,
      from: '2026-09-01',
      to: '2026-09-13',
      scheduled: 3 + 2 + 1,
      completed: 2 + 1 + 1,
      incomplete: 2,
      percent: 67,
      plannedMinutes: (30 + 30 + 45) + (20 + 20) + 15,
      spentMinutes: (30 + 45) + 20 + 15,
      inboxDone: 1,
      focusMinutes: 12 + 8,
    });
  });

  it('counts a past month in full and a future month not at all', () => {
    const past = monthStats({ tasks, unscheduledTasks: unscheduled, recurringTasks: recurring, year: 2026, month: 8, today: '2026-09-13' });
    // Mondays in August 2026 from the template's start on the 3rd: 3, 10, 17, 24, 31.
    expect(past).toEqual({
      counted: true, from: '2026-08-01', to: '2026-08-31', scheduled: 1 + 5, completed: 1, incomplete: 5,
      percent: 17, plannedMinutes: 30 + 5 * 15, spentMinutes: 30, inboxDone: 1, focusMinutes: 0,
    });
    const future = monthStats({ tasks, year: 2026, month: 10, today: '2026-09-13' });
    expect(future.counted).toBe(false);
    expect(future.scheduled).toBe(0);
    expect(future.percent).toBeNull();
  });

  it('respects the per-user visibility filter and the bucket list', () => {
    const s = monthStats({ tasks, unscheduledTasks: unscheduled, year: 2026, month: 9, today: '2026-09-30', isVisibleForUser: (x) => x.id !== 'b' && x.id !== 'dl3' && x.id !== 'in2' });
    expect(s.scheduled).toBe(3 + 2); // a, c, future; dl1, dl2 (bucket excluded, dl3 hidden)
    expect(s.incomplete).toBe(1 + 1);
    expect(s.inboxDone).toBe(1); // in1; in2 hidden, in3 in August, pq is a project task, inb sits in a bucket
  });

  it('handles an empty month and a month of 31 days at the year end', () => {
    expect(monthStats({ tasks: [], year: 2026, month: 12, today: '2027-01-15' })).toEqual({
      counted: true, from: '2026-12-01', to: '2026-12-31', scheduled: 0, completed: 0, incomplete: 0,
      percent: null, plannedMinutes: 0, spentMinutes: 0, inboxDone: 0, focusMinutes: 0,
    });
  });

  it('treats a missing duration as zero minutes', () => {
    const s = monthStats({ tasks: [t('x', '2026-09-01', { duration: undefined, completed: true })], year: 2026, month: 9, today: '2026-09-13' });
    expect(s.plannedMinutes).toBe(0);
    expect(s.spentMinutes).toBe(0);
    expect(s.percent).toBe(100);
  });
});
