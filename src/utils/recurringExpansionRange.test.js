import { describe, it, expect } from 'vitest';
import { computeRecurringExpansionRange } from './recurringExpansionRange.js';
import { WIDGET_PROJECTION_DAYS } from './widgetDayProjection.js';

// Local noon, so day arithmetic never crosses a DST boundary by accident.
const d = (y, m, day) => new Date(y, m - 1, day, 12);
const TODAY = d(2026, 9, 18);
const plus = (date, n) => d(date.getFullYear(), date.getMonth() + 1, date.getDate() + n);

describe('computeRecurringExpansionRange', () => {
  it('always covers today', () => {
    const r = computeRecurringExpansionRange({
      visibleDates: [d(2026, 10, 5)], selectedDate: d(2026, 10, 5), schedDaysShown: 1, today: TODAY,
    });
    expect(r.rangeStart <= '2026-09-18' && '2026-09-18' <= r.rangeEnd).toBe(true);
  });

  // (a) the projection horizon exists when the user is looking at today.
  it('covers today + N when the visible range is today', () => {
    const r = computeRecurringExpansionRange({
      visibleDates: [TODAY], selectedDate: TODAY, schedDaysShown: 1, today: TODAY,
    });
    for (let i = 1; i <= WIDGET_PROJECTION_DAYS; i++) {
      const s = plus(TODAY, i).toISOString().slice(0, 10);
      expect(s <= r.rangeEnd, `today+${i} (${s}) must be inside … ${r.rangeEnd}`).toBe(true);
    }
  });

  // (b) THE trigger condition: the user is parked on last week, the SCHED
  // window is short, nothing they are looking at reaches tomorrow. Without
  // the second anchor this returned rangeEnd = today, and the projected
  // days had no recurring instances.
  it('covers today + N when the visible range is entirely BEHIND today', () => {
    const lastWeek = plus(TODAY, -9);
    const r = computeRecurringExpansionRange({
      visibleDates: [lastWeek, plus(lastWeek, 1), plus(lastWeek, 2)],
      weekViewDates: [],
      selectedDate: lastWeek,
      schedDaysShown: 3,
      today: TODAY,
    });
    expect(r.rangeStart).toBe('2026-09-09');
    expect(r.rangeEnd).toBe('2026-09-21');
  });

  // (c) symmetric: parked far ahead, the range still reaches back to today
  // and the horizon is inside it regardless.
  it('covers today and today + N when the visible range is entirely AHEAD of today', () => {
    const nextMonth = plus(TODAY, 30);
    const r = computeRecurringExpansionRange({
      visibleDates: [nextMonth], selectedDate: nextMonth, schedDaysShown: 1, today: TODAY,
    });
    expect(r.rangeStart).toBe('2026-09-18');
    expect(r.rangeEnd).toBe('2026-10-18');
  });

  it('keeps the SCHED rolling window and month range as before', () => {
    const r = computeRecurringExpansionRange({
      visibleDates: [TODAY],
      monthViewRange: { from: '2026-08-31', to: '2026-10-04' },
      selectedDate: TODAY,
      schedDaysShown: 14,
      today: TODAY,
    });
    expect(r.rangeStart).toBe('2026-08-31');
    expect(r.rangeEnd).toBe('2026-10-04');
  });

  it('honours a different projection horizon', () => {
    const r = computeRecurringExpansionRange({ selectedDate: TODAY, schedDaysShown: 1, today: TODAY, projectionDays: 7 });
    expect(r.rangeEnd).toBe('2026-09-25');
  });
});
