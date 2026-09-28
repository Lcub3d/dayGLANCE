import { describe, it, expect } from 'vitest';
import { year2Months, year2Range, year2Items, shiftYear2Date } from './year2.js';
import { dayKey } from './year.js';
import { nativeFetchWindowFor } from '../utils/nativeFetchWindow.js';

describe('Year 2 calendar', () => {
  it.each([[2026,365], [2028,366], [2000,366], [2100,365]])('renders %i with exactly %i unique actionable dates', (year, count) => {
    const months = year2Months(year);
    expect(months).toHaveLength(12);
    expect(months.every(month => month.cells.length === 42)).toBe(true);
    const days = months.flatMap(month => month.cells.filter(cell => cell.inMonth).map(cell => cell.dateStr));
    expect(days).toHaveLength(count);
    expect(new Set(days).size).toBe(count);
    expect(days[0]).toBe(`${year}-01-01`);
    expect(days.at(-1)).toBe(`${year}-12-31`);
  });
  it.each([0,1,2,3,4,5,6])('honours weekday start %i without changing which dates exist', start => {
    for (const month of year2Months(2026,start)) {
      expect(month.weekdays[0]).toBe(start);
      expect(month.cells[0].weekday).toBe(start);
      expect(month.cells.filter(cell => cell.inMonth)[0].day).toBe(1);
    }
  });
  it('validates years and normalizes a corrupt week-start preference', () => {
    expect(()=>year2Months(NaN)).toThrow();
    expect(()=>year2Months(1899)).toThrow();
    expect(()=>year2Months(2201)).toThrow();
    expect(year2Months(2026,99)).toEqual(year2Months(2026,0));
  });
  it('clamps leap-day navigation, stays at noon, and preserves its input', () => {
    const date = new Date(2028,1,29,12);
    expect(dayKey(shiftYear2Date(date,1))).toBe('2029-02-28');
    expect(dayKey(shiftYear2Date(date,-1))).toBe('2027-02-28');
    expect(shiftYear2Date(date,1).getHours()).toBe(12);
    expect(dayKey(date)).toBe('2028-02-29');
    expect(dayKey(shiftYear2Date(new Date(1900,0,1,12),-1))).toBe('1900-01-01');
    expect(dayKey(shiftYear2Date(new Date(2200,11,31,12),1))).toBe('2200-12-31');
  });
  it('publishes the full year to the existing recurring/calendar range seam', () => {
    expect(year2Range(2028)).toEqual({from:'2028-01-01',to:'2028-12-31'});
    expect(nativeFetchWindowFor(new Date(2028,8,20,12), {monthViewRange:year2Range(2028)})).toEqual(year2Range(2028));
  });
  it('only filters presentation rows; it never counts duplicate IDs or modifies records', () => {
    const task=Object.freeze({id:'a', title:'A',startTime:'10:00',completed:true});
    const items=Object.freeze([task,task,{id:'b',isAllDay:true,title:'B'},{id:'gone',deleted:true},{id:'demo',isExample:true}]);
    expect(year2Items(items).map(row=>row.id)).toEqual(['b','a']);
    expect(items.length).toBe(5);
    expect(year2Items(items)[1]).toBe(task);
  });
});
