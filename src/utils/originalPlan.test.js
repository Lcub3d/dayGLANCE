import { describe, it, expect } from 'vitest';
import { stampOriginalPlan } from './originalPlan.js';

const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: '2026-09-17', startTime: '09:00', duration: 60, ...over });

describe('recording the original plan', () => {
  it('records the schedule of a task new to storage', () => {
    const [out] = stampOriginalPlan([task()], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('records it when a task is scheduled out of the inbox', () => {
    // The stored copy exists but has no date or time: this IS the scheduling
    // moment, and it is the most common one in practice.
    const prev = [{ id: 't1', title: 'Write the report' }];
    const [out] = stampOriginalPlan([task()], prev);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('records it for a task dated but not yet timed', () => {
    const prev = [{ id: 't1', title: 'Write the report', date: '2026-09-17' }];
    const [out] = stampOriginalPlan([task()], prev);
    expect(out.originalPlan).toBeDefined();
  });

  it('omits duration when the task has none, rather than storing undefined', () => {
    const [out] = stampOriginalPlan([task({ duration: undefined })], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00' });
    expect('duration' in out.originalPlan).toBe(false);
  });

  it('treats an all-day task as scheduled, since its date can still move', () => {
    const [out] = stampOriginalPlan([task({ isAllDay: true, startTime: '00:00' })], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '00:00', duration: 60 });
  });
});

describe('what is deliberately NOT recorded', () => {
  it('leaves an unscheduled task alone', () => {
    const [out] = stampOriginalPlan([{ id: 't1', title: 'Someday' }], []);
    expect(out.originalPlan).toBeUndefined();
  });

  it('leaves a dated task with no start time alone', () => {
    const [out] = stampOriginalPlan([{ id: 't1', date: '2026-09-17' }], []);
    expect(out.originalPlan).toBeUndefined();
  });

  it('does NOT backfill a task that was already scheduled in storage', () => {
    // The whole point. This task may have been rescheduled any number of times
    // before the feature existed, so its current schedule is not evidence of
    // anything. Absent means "not known", which is honest; a fabricated value
    // would be indistinguishable from a real one forever after.
    const prev = [task({ date: '2026-09-10', startTime: '14:00' })];
    const [out] = stampOriginalPlan([task()], prev);
    expect(out.originalPlan).toBeUndefined();
  });

  it('returns unchanged tasks by reference, so nothing downstream sees a false edit', () => {
    const existing = task({ originalPlan: { date: '2026-09-01', startTime: '08:00' } });
    const unscheduled = { id: 't2', title: 'Someday' };
    const out = stampOriginalPlan([existing, unscheduled], []);
    expect(out[0]).toBe(existing);
    expect(out[1]).toBe(unscheduled);
  });
});

describe('write-once', () => {
  it('never overwrites an existing baseline when the task is rescheduled', () => {
    const planned = stampOriginalPlan([task()], [])[0];
    const moved = { ...planned, date: '2026-09-18', startTime: '16:00' };
    const [out] = stampOriginalPlan([moved], [planned]);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('survives a round trip through the inbox and back onto the calendar', () => {
    // Unscheduling drops the task out of the scheduled store, so re-scheduling it
    // looks like a first scheduling. The carried baseline is what stops the
    // original plan being silently replaced by the second one.
    const planned = stampOriginalPlan([task()], [])[0];
    const backOnCalendar = { ...planned, date: '2026-09-20', startTime: '11:00' };
    const [out] = stampOriginalPlan([backOnCalendar], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('carries a stored baseline back onto an in-memory task that lacks it', () => {
    // The persist pass writes to storage, never back into React state, so the
    // in-memory task never grows the field. Without this the next save would
    // write state over the stored baseline and it would survive one save only.
    const stored = task({ originalPlan: { date: '2026-09-17', startTime: '09:00', duration: 60 } });
    const inMemory = task({ date: '2026-09-18', startTime: '16:00' });
    const [out] = stampOriginalPlan([inMemory], [stored]);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('survives repeated saves from a state that never carries the field', () => {
    const state = [task()];
    let stored = stampOriginalPlan(state, []);
    for (let i = 0; i < 5; i++) stored = stampOriginalPlan(state, stored);
    expect(stored[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('keeps a baseline that arrived from another device', () => {
    const fromSync = task({ originalPlan: { date: '2026-08-01', startTime: '07:30' }, date: '2026-09-17' });
    const [out] = stampOriginalPlan([fromSync], []);
    expect(out.originalPlan).toEqual({ date: '2026-08-01', startTime: '07:30' });
  });
});

describe('the reschedule story from #1623, end to end', () => {
  it('keeps 09:00 recoverable after the task moves to 16:00', () => {
    let stored = [];
    const save = (live) => { stored = stampOriginalPlan(live, stored); return stored; };

    save([task({ date: '2026-09-17', startTime: '09:00', duration: 60 })]);
    const afterMove = save([{ ...stored[0], startTime: '16:00', duration: 45 }]);

    expect(afterMove[0].startTime).toBe('16:00');
    expect(afterMove[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('is stable across repeated saves with no changes', () => {
    let stored = stampOriginalPlan([task()], []);
    const first = stored[0].originalPlan;
    for (let i = 0; i < 3; i++) stored = stampOriginalPlan(stored, stored);
    expect(stored[0].originalPlan).toEqual(first);
  });
});

describe('robustness', () => {
  it('tolerates a missing prev array', () => {
    expect(stampOriginalPlan([task()], undefined)[0].originalPlan).toBeDefined();
  });

  it('matches ids across the string/number boundary', () => {
    // Stored ids round-trip through JSON and are not always the same type as the
    // in-memory ones; a mismatch here would read as "new" and re-record.
    const prev = [task({ id: 7 })];
    const [out] = stampOriginalPlan([task({ id: '7', startTime: '16:00' })], prev);
    expect(out.originalPlan).toBeUndefined();
  });

  it('handles an empty task list', () => {
    expect(stampOriginalPlan([], [])).toEqual([]);
  });
});
