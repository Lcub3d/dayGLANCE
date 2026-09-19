import { describe, it, expect } from 'vitest';
import { hasComeDue, isDeferral, stampDeferrals, mergeDeferrals } from './deferrals.js';

const TODAY = '2026-09-19';
const at = (h, m = 0) => new Date(2026, 8, 19, h, m);
const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: TODAY, startTime: '09:00', ...over });

describe('hasComeDue', () => {
  it('is true once the start time has passed today', () => {
    expect(hasComeDue(task(), at(9, 30), TODAY)).toBe(true);
  });

  it('is true at exactly the start time', () => {
    expect(hasComeDue(task(), at(9, 0), TODAY)).toBe(true);
  });

  it('is false before the start time', () => {
    expect(hasComeDue(task(), at(8, 59), TODAY)).toBe(false);
  });

  it('is true for any earlier day, whatever the clock says', () => {
    expect(hasComeDue(task({ date: '2026-09-18' }), at(0, 1), TODAY)).toBe(true);
  });

  it('is false for a later day, however late in the day it is', () => {
    expect(hasComeDue(task({ date: '2026-09-20' }), at(23, 59), TODAY)).toBe(false);
  });

  it('is false without a schedule: nothing was supposed to begin', () => {
    expect(hasComeDue(task({ date: null }), at(23, 0), TODAY)).toBe(false);
    expect(hasComeDue(task({ startTime: null }), at(23, 0), TODAY)).toBe(false);
    expect(hasComeDue(undefined, at(9, 30), TODAY)).toBe(false);
  });
});

describe('isDeferral distinguishes a slip from planning', () => {
  it('counts a same-day push made after the task came due', () => {
    // The case that cross-day-only would miss: 09:00 moved to 16:00 at 09:30.
    expect(isDeferral(task(), task({ startTime: '16:00' }), at(9, 30), TODAY)).toBe(true);
  });

  it('does NOT count same-day shuffling before anything came due', () => {
    // Laying out the morning at 08:00 is planning, not slipping.
    expect(isDeferral(task(), task({ startTime: '11:00' }), at(8, 0), TODAY)).toBe(false);
  });

  it('counts pushing a task that is already overdue to another day', () => {
    expect(isDeferral(task(), task({ date: '2026-09-20' }), at(14, 0), TODAY)).toBe(true);
  });

  it('does NOT count rescheduling a future task to a different future day', () => {
    // Moving tomorrow's task to Friday is planning, even though the day changed.
    const future = task({ date: '2026-09-20' });
    expect(isDeferral(future, task({ date: '2026-09-25' }), at(14, 0), TODAY)).toBe(false);
  });

  it('needs the schedule to have actually moved', () => {
    expect(isDeferral(task(), task({ title: 'Renamed' }), at(14, 0), TODAY)).toBe(false);
    expect(isDeferral(task(), task({ completed: true }), at(14, 0), TODAY)).toBe(false);
  });

  it('is false for a task with no previous copy to compare against', () => {
    expect(isDeferral(undefined, task(), at(14, 0), TODAY)).toBe(false);
  });
});

describe('stampDeferrals', () => {
  it('starts a count at one', () => {
    const [out] = stampDeferrals([task({ startTime: '16:00' })], [task()], at(9, 30), TODAY);
    expect(out.deferrals).toBe(1);
  });

  it('adds to an existing count', () => {
    const prev = task({ deferrals: 4 });
    const [out] = stampDeferrals([task({ startTime: '16:00', deferrals: 4 })], [prev], at(9, 30), TODAY);
    expect(out.deferrals).toBe(5);
  });

  it('returns the same array when nothing slipped, so the persist pass can tell', () => {
    const tasks = [task()];
    expect(stampDeferrals(tasks, tasks, at(9, 30), TODAY)).toBe(tasks);
  });

  it('leaves planning alone', () => {
    const tasks = [task({ startTime: '11:00' })];
    expect(stampDeferrals(tasks, [task()], at(8, 0), TODAY)).toBe(tasks);
  });

  it('only ever rises, which is what lets two devices merge by max', () => {
    let stored = [task()];
    for (const t of ['10:00', '12:00', '16:00']) {
      const next = [{ ...stored[0], startTime: t }];
      stored = stampDeferrals(next, stored, at(23, 0), TODAY);
    }
    expect(stored[0].deferrals).toBe(3);
  });

  it('derives today from the clock when not given one', () => {
    const now = at(9, 30);
    const [out] = stampDeferrals([task({ startTime: '16:00' })], [task()], now);
    expect(out.deferrals).toBe(1);
  });
});

describe('mergeDeferrals', () => {
  it('takes the higher count rather than summing the same slip twice', () => {
    expect(mergeDeferrals(3, 5)).toBe(5);
    expect(mergeDeferrals(5, 3)).toBe(5);
  });

  it('treats a device that never carried the field as zero, not as an erasure', () => {
    expect(mergeDeferrals(undefined, 4)).toBe(4);
    expect(mergeDeferrals(4, undefined)).toBe(4);
  });

  it('stays absent when neither side has one, rather than writing a zero', () => {
    expect(mergeDeferrals(undefined, undefined)).toBeUndefined();
    expect(mergeDeferrals(0, 0)).toBeUndefined();
  });

  it('ignores junk rather than producing NaN', () => {
    expect(mergeDeferrals('four', 2)).toBe(2);
    expect(mergeDeferrals(null, null)).toBeUndefined();
  });
});
