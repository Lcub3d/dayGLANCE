import { describe, it, expect } from 'vitest';
import { weekViewDatesFor, WEEK_VIEW_DAYS } from './weekViewDates.js';
import { dateToString } from './taskUtils.js';

const strs = (dates) => dates.map(dateToString);
const at = (y, m, d, h = 12) => new Date(y, m, d, h);

describe('weekViewDatesFor', () => {
  it('has no strip outside the modes that draw one', () => {
    for (const viewMode of ['multi', 'month', 'day', 'list', undefined]) {
      expect(weekViewDatesFor({ viewMode, selectedDate: at(2026, 8, 16), weekViewMode: 'strict', weekStartDay: 0 })).toEqual([]);
    }
  });

  it('draws the strip for WEEK and for SCHED, whose date navigation shares it', () => {
    for (const viewMode of ['week', 'sched']) {
      expect(weekViewDatesFor({ viewMode, selectedDate: at(2026, 8, 16), weekViewMode: 'strict', weekStartDay: 0 }))
        .toHaveLength(WEEK_VIEW_DAYS);
    }
  });

  it('strict: the calendar week containing the selected day, starting on weekStartDay', () => {
    const wednesday = at(2026, 8, 16);
    expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: wednesday, weekViewMode: 'strict', weekStartDay: 0 })))
      .toEqual(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
    expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: wednesday, weekViewMode: 'strict', weekStartDay: 1 })))
      .toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: wednesday, weekViewMode: 'strict', weekStartDay: 6 })))
      .toEqual(['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
  });

  it('strict: every day of a week yields that same week', () => {
    const week = strs(weekViewDatesFor({ viewMode: 'week', selectedDate: at(2026, 8, 13), weekViewMode: 'strict', weekStartDay: 0 }));
    for (const day of [13, 14, 15, 16, 17, 18, 19]) {
      expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: at(2026, 8, day), weekViewMode: 'strict', weekStartDay: 0 }))).toEqual(week);
    }
  });

  it('rolling: today and the six days after it, whatever the week starts on', () => {
    const today = at(2026, 8, 16, 9);
    expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: at(2026, 8, 16), weekViewMode: 'rolling', weekStartDay: 0, today })))
      .toEqual(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']);
  });

  it('rolling falls back to the calendar week once the user pages off today', () => {
    // A rolling strip anchored anywhere but today is just a confusing week.
    const today = at(2026, 8, 16, 9);
    expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: at(2026, 8, 23), weekViewMode: 'rolling', weekStartDay: 0, today })))
      .toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  });

  it('reads today by the local day, not the clock, so the afternoon is still today', () => {
    const selectedDate = at(2026, 8, 16, 0);
    const morning = weekViewDatesFor({ viewMode: 'week', selectedDate, weekViewMode: 'rolling', weekStartDay: 0, today: at(2026, 8, 16, 1) });
    const evening = weekViewDatesFor({ viewMode: 'week', selectedDate, weekViewMode: 'rolling', weekStartDay: 0, today: at(2026, 8, 16, 23) });
    expect(strs(morning)).toEqual(strs(evening));
    expect(strs(morning)[0]).toBe('2026-09-16');
  });

  it('returns local midnights, and crosses months and years', () => {
    const [first] = weekViewDatesFor({ viewMode: 'week', selectedDate: at(2026, 11, 31), weekViewMode: 'strict', weekStartDay: 1 });
    expect([first.getHours(), first.getMinutes(), first.getSeconds(), first.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect(strs(weekViewDatesFor({ viewMode: 'week', selectedDate: at(2026, 11, 31), weekViewMode: 'strict', weekStartDay: 1 })))
      .toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });

  it('does not hand back the caller\'s own Date', () => {
    const selectedDate = at(2026, 8, 16);
    const strip = weekViewDatesFor({ viewMode: 'week', selectedDate, weekViewMode: 'strict', weekStartDay: 3 });
    for (const d of strip) expect(d).not.toBe(selectedDate);
    expect(selectedDate.getHours()).toBe(12); // and did not normalise it in place
  });
});
