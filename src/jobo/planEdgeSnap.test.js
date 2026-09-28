import { describe, expect, it } from 'vitest';
import { planEdgeSnap } from './planEdgeSnap.js';

const DATE = '2026-09-27';

function plan(id, startMinute, endMinute, over = {}) {
  return {
    id,
    startMinute,
    endMinute,
    historical: false,
    currentTask: { id: `task-${id}`, date: DATE },
    plan: { date: DATE },
    ...over,
  };
}

describe('planEdgeSnap', () => {
  it('snaps the start to the previous task end without changing the end', () => {
    const previous = plan('previous', 10 * 60 + 30, 11 * 60 + 30);
    const current = plan('current', 11 * 60 + 45, 11 * 60 + 55);

    expect(planEdgeSnap(current, [previous, current], 'start')).toEqual({
      startTime: '11:30',
      duration: 25,
      targetTime: '11:30',
    });
  });

  it('snaps the end to the next task start without changing the start', () => {
    const current = plan('current', 11 * 60 + 45, 11 * 60 + 55);
    const next = plan('next', 12 * 60, 12 * 60 + 20);

    expect(planEdgeSnap(current, [current, next], 'end')).toEqual({
      startTime: '11:45',
      duration: 15,
      targetTime: '12:00',
    });
  });

  it('ignores historical and cross-date neighbours', () => {
    const current = plan('current', 11 * 60 + 45, 11 * 60 + 55);
    const historical = plan('historical', 10 * 60 + 30, 11 * 60 + 30, { historical: true });
    const otherDate = plan('other-date', 12 * 60, 12 * 60 + 20, {
      currentTask: { id: 'task-other-date', date: '2026-09-28' },
      plan: { date: '2026-09-28' },
    });

    expect(planEdgeSnap(current, [historical, current, otherDate], 'start')).toBeNull();
    expect(planEdgeSnap(current, [historical, current, otherDate], 'end')).toBeNull();
  });

  it('rejects unchanged, zero-duration, and negative-duration snaps', () => {
    const current = plan('current', 11 * 60 + 45, 11 * 60 + 55);
    const touchingPrevious = plan('touching-previous', 11 * 60 + 15, 11 * 60 + 45);
    const overlongPrevious = plan('overlong-previous', 11 * 60, 12 * 60);
    const touchingNext = plan('touching-next', 11 * 60 + 55, 12 * 60);

    expect(planEdgeSnap(current, [touchingPrevious, current], 'start')).toBeNull();
    expect(planEdgeSnap(current, [overlongPrevious, current], 'start')).toBeNull();
    expect(planEdgeSnap(current, [current, touchingNext], 'end')).toBeNull();
  });
});
