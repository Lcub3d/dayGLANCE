import { describe, it, expect } from 'vitest';
import { chineseDateMeta, chineseCalendarYear, civilParts, dateAnnotation, calendarDescription } from './chineseCalendar.js';
import { chinaHoliday, chinaHolidaySchedule } from './chinaHolidays.js';

const all = { lunar: true, terms: true, festivals: true };
describe('Chinese civil-day annotations (HKO reference fixtures)', () => {
  // Hong Kong Observatory, Gregorian–Lunar conversion table, 2026:
  // https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2026e.txt
  it.each([
    ['2026-02-16', 12, 29, '除夕'], ['2026-02-17', 1, 1, '春节'],
    ['2026-03-03', 1, 15, '元宵节'], ['2026-06-19', 5, 5, '端午节'],
    ['2026-09-25', 8, 15, '中秋节'], ['2026-10-01', 8, 21, '国庆节'],
  ])('%s has the correct lunar date and festival', (date, month, day, festival) => {
    const meta = chineseDateMeta(date);
    expect(meta.lunarMonthNumber).toBe(month); expect(meta.lunarDayNumber).toBe(day);
    expect(meta.festivals).toContain(festival);
  });
  it('matches all 24 solar-term calendar dates in the HKO 2026 table', () => {
    const dates = ['01-05','01-20','02-04','02-18','03-05','03-20','04-05','04-20','05-05','05-21','06-05','06-21','07-07','07-23','08-07','08-23','09-07','09-23','10-08','10-23','11-07','11-22','12-07','12-22'];
    const terms = Object.values(chineseCalendarYear(2026)).filter(meta => meta.term);
    expect(terms.map(meta => meta.date.slice(5))).toEqual(dates);
    expect(chineseDateMeta('2026-02-18').term).toBe('雨水');
    expect(chineseDateMeta('2026-06-05').term).toBe('芒种');
  });
  it('handles the leap sixth month of 2025 without repeating festivals', () => {
    const meta = chineseDateMeta('2025-07-25');
    expect(meta.lunarMonthNumber).toBe(-6); expect(meta.lunarDayNumber).toBe(1);
    expect(meta.isLeapMonth).toBe(true); expect(dateAnnotation(meta, all).text).toBe('闰六月');
    expect(meta.festivals).toEqual([]);
  });
  it('keeps both festivals when the small cell can only show one', () => {
    const meta = chineseDateMeta('2020-10-01');
    expect(dateAnnotation(meta, all)).toEqual({ text: '中秋节', kind: 'festival' });
    expect(calendarDescription(meta, all)).toContain('中秋节 · 国庆节');
  });
  it('supports independent lunar, festival and solar-term layers', () => {
    const meta = chineseDateMeta('2026-04-05');
    expect(dateAnnotation(meta, all).kind).toBe('festival');
    expect(dateAnnotation(meta, { ...all, festivals: false })).toEqual({ text: '清明', kind: 'term' });
    expect(dateAnnotation(meta, { ...all, festivals: false, terms: false }).text).toBe('十八');
    expect(dateAnnotation(meta, {})).toBe(null);
  });
  it('uses lunar month names on day one, and otherwise lunar day labels', () => {
    expect(dateAnnotation(chineseDateMeta('2026-09-11'), all).text).toBe('八月');
    expect(dateAnnotation(chineseDateMeta('2026-09-12'), all).text).toBe('初二');
  });
  it.each(['2026-02-30','2026-13-01','2026-1-1','2026-02-17T00:00:00Z','',null])('rejects invalid civil key %s without normalizing into another day', key => {
    expect(civilParts(key)).toBe(null); expect(chineseDateMeta(key)).toBe(null);
  });
  it('does not fabricate lunar information outside the supported range', () => {
    for (const year of [1899, 2101, 2200, NaN]) expect(chineseCalendarYear(year)).toBe(null);
    expect(chineseDateMeta('2200-01-01')).toBe(null);
  });
  it.each([[2025,365],[2026,365],[2028,366],[2100,365]])('caches immutable metadata for %i', (year, count) => {
    const meta = chineseCalendarYear(year);
    expect(Object.keys(meta)).toHaveLength(count); expect(chineseCalendarYear(year)).toBe(meta);
    expect(Object.isFrozen(meta)).toBe(true); expect(Object.isFrozen(meta[`${year}-01-01`])).toBe(true);
  });
});

describe('official Mainland China schedules, distinct from festivals', () => {
  it.each([[2025,28,5],[2026,33,6]])('has the complete published %i day-off/makeup schedule', (year, days, workdays) => {
    const schedule = chinaHolidaySchedule(year);
    expect(schedule.breaks.reduce((sum, h) => sum + h.days, 0)).toBe(days);
    expect(schedule.breaks.flatMap(h => h.workdays)).toHaveLength(workdays);
    expect(schedule.source).toMatch(/^https:\/\/www.gov.cn\//);
    const allDays = Object.keys(chineseCalendarYear(year));
    expect(allDays.filter(date => chinaHoliday(date)?.type === 'rest')).toHaveLength(days);
    expect(allDays.filter(date => chinaHoliday(date)?.type === 'work')).toHaveLength(workdays);
  });
  it.each(['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'])('%s is a makeup workday, not a holiday/weekend rest', date => {
    expect(chinaHoliday(date).type).toBe('work');
  });
  it('distinguishes a holiday span from its festival date', () => {
    expect(chinaHoliday('2026-02-15').type).toBe('rest');
    expect(chineseDateMeta('2026-02-15').festivals).not.toContain('春节');
    expect(chinaHoliday('2026-04-04').type).toBe('rest');
    expect(chineseDateMeta('2026-04-04').term).not.toBe('清明');
    expect(chinaHoliday('2026-03-03')).toBe(null); // Lantern Festival ≠ day off.
  });
  it('does not infer holiday status for ordinary weekends or missing years', () => {
    expect(chinaHoliday('2026-09-19')).toBe(null);
    expect(chineseDateMeta('2027-02-06').festivals).toContain('春节');
    expect(chinaHoliday('2027-02-06')).toBe(null); expect(chinaHolidaySchedule(2027)).toBe(null);
    expect(chinaHolidaySchedule(2024)).toBe(null);
  });
  it('honours cross-month holidays and the combined 2025 national/mid-autumn break', () => {
    expect(chinaHoliday('2025-02-04').name).toBe('春节');
    expect(chinaHoliday('2025-02-05')).toBe(null);
    expect(chinaHoliday('2025-06-02').name).toBe('端午节');
    expect(chinaHoliday('2025-10-08').type).toBe('rest');
    expect(chinaHoliday('2025-10-11').type).toBe('work');
  });
});
