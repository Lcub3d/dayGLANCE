import { describe, it, expect } from 'vitest';
import { recurrenceToWire } from './mcpRepeat.js';
import { parseRepeat } from '../../electron/mcpRepeatArgs.ts';

describe('recurrenceToWire', () => {
  it('spells out the engine defaults taken from the start date', () => {
    // 2026-10-12 is a Monday.
    expect(recurrenceToWire({ type: 'weekly', startDate: '2026-10-12' }))
      .toEqual({ frequency: 'weekly', days_of_week: ['mon']});
    expect(recurrenceToWire({ type: 'monthly', monthDay: null, monthWeekday: null, startDate: '2026-10-12' }))
      .toEqual({ frequency: 'monthly', day_of_month: 12});
  });

  it('reports the nth weekday, the end and the count', () => {
    expect(recurrenceToWire({
      type: 'monthly', monthDay: null, monthWeekday: { week: 2, day: 1 },
      endDate: '2027-06-30', maxOccurrences: 8, startDate: '2026-10-12',
    })).toEqual({
      frequency: 'monthly', nth_weekday: { week: 2, day: 'mon' }, until: '2027-06-30', count: 8
    });
  });

  it('is null without a pattern', () => {
    expect(recurrenceToWire(undefined)).toBeNull();
    expect(recurrenceToWire({})).toBeNull();
  });

  // What the read surface reports must be accepted back unchanged by the write
  // surface, and mean the same pattern.
  it.each([
    [{ frequency: 'daily' }],
    [{ frequency: 'weekly', days_of_week: ['mon', 'wed', 'fri'] }],
    [{ frequency: 'biweekly', days_of_week: ['tue'], until: '2027-01-01' }],
    [{ frequency: 'monthly', day_of_month: 31, count: 12 }],
    [{ frequency: 'monthly', nth_weekday: { week: 5, day: 'fri' } }],
    [{ frequency: 'yearly' }],
  ])('round-trips %j through parseRepeat', (repeat) => {
    const anchor = '2026-10-12';
    const parsed = parseRepeat(repeat, anchor);
    expect(parsed.ok).toBe(true);
    const wire = recurrenceToWire({ ...parsed.recurrence, startDate: anchor });
    const again = parseRepeat(wire, anchor);
    expect(again).toEqual(parsed);
  });
});
