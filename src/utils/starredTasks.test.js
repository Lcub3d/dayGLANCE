import { describe, it, expect } from 'vitest';
import { isStarred, starredOn, toggleStar, overGuideline, STAR_GUIDELINE } from './starredTasks.js';

const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: '2026-09-18', startTime: '09:00', ...over });

describe('isStarred', () => {
  it('is true when the star is for the day the task sits on', () => {
    expect(isStarred(task({ starredDate: '2026-09-18' }))).toBe(true);
  });

  it('is false with no star', () => {
    expect(isStarred(task())).toBe(false);
  });

  it('is false once the task moves to another day', () => {
    // @Lcub3d's rule: the star stays with the original date, and whether the
    // task deserves one on its new date is a fresh decision.
    expect(isStarred(task({ date: '2026-09-20', starredDate: '2026-09-18' }))).toBe(false);
  });

  it('is false for an explicit unstar', () => {
    expect(isStarred(task({ starredDate: null }))).toBe(false);
  });

  it('is false for a task with no date at all', () => {
    expect(isStarred({ id: 't1', starredDate: '2026-09-18' })).toBe(false);
  });

  it('tolerates a missing task', () => {
    expect(isStarred(undefined)).toBe(false);
  });
});

describe('toggleStar', () => {
  it('stars a task for the day it sits on', () => {
    expect(toggleStar(task()).starredDate).toBe('2026-09-18');
  });

  it('unstars with an explicit null rather than by dropping the key', () => {
    // Absent means "this device never had the field" and is carried forward
    // across a merge; null is a real unstar and must propagate.
    const out = toggleStar(task({ starredDate: '2026-09-18' }));
    expect(out.starredDate).toBeNull();
    expect('starredDate' in out).toBe(true);
  });

  it('re-stars a task that was moved, using its new date', () => {
    const moved = task({ date: '2026-09-20', starredDate: '2026-09-18' });
    expect(toggleStar(moved).starredDate).toBe('2026-09-20');
  });

  it('refuses to star a task with no date', () => {
    const inbox = { id: 't1', title: 'Someday' };
    expect(toggleStar(inbox)).toBe(inbox);
  });

  it('does not touch anything else on the task', () => {
    const out = toggleStar(task({ priority: 2, color: 'bg-blue-500' }));
    expect(out).toMatchObject({ priority: 2, color: 'bg-blue-500', title: 'Write the report' });
  });
});

describe('starredOn', () => {
  const day = '2026-09-18';
  const tasks = [
    task({ id: 'a', starredDate: day }),
    task({ id: 'b' }),
    task({ id: 'c', starredDate: day }),
    task({ id: 'd', date: '2026-09-20', starredDate: day }), // moved away
    task({ id: 'e', date: '2026-09-20', starredDate: '2026-09-20' }), // another day
  ];

  it('returns only the tasks starred for that day and still on it', () => {
    expect(starredOn(tasks, day).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('keeps the order it was given', () => {
    expect(starredOn([tasks[2], tasks[0]], day).map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('tolerates a missing list and null rows', () => {
    expect(starredOn(undefined, day)).toEqual([]);
    expect(starredOn([null, tasks[0]], day).map((t) => t.id)).toEqual(['a']);
  });
});

describe('the three-task guideline', () => {
  const day = '2026-09-18';
  const starred = (n) => Array.from({ length: n }, (_, i) => task({ id: `s${i}`, starredDate: day }));

  it('is a nudge, not a limit: nothing refuses a fourth star', () => {
    const four = starred(3);
    const extra = toggleStar(task({ id: 'x' }));
    expect(extra.starredDate).toBe(day);
    expect(starredOn([...four, extra], day)).toHaveLength(4);
  });

  it('reports only once the day is over the guideline', () => {
    expect(overGuideline(starred(STAR_GUIDELINE), day)).toBe(false);
    expect(overGuideline(starred(STAR_GUIDELINE + 1), day)).toBe(true);
  });
});
