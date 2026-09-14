import { describe, it, expect } from 'vitest';
import { nativeFetchWindowFor, windowDates, NATIVE_FETCH_RADIUS_DAYS } from './nativeFetchWindow.js';

const sel = new Date(2026, 8, 13, 12);

describe('nativeFetchWindowFor', () => {
  it('is the ±2-day window around the selected day when MONTH is not up', () => {
    expect(NATIVE_FETCH_RADIUS_DAYS).toBe(2);
    expect(nativeFetchWindowFor(sel)).toEqual({ from: '2026-09-11', to: '2026-09-15' });
    expect(nativeFetchWindowFor(sel, null)).toEqual({ from: '2026-09-11', to: '2026-09-15' });
    expect(windowDates(nativeFetchWindowFor(sel))).toEqual(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']);
  });

  it("covers MONTH's whole grid while it is up, so cells outside ±2 days keep their events", () => {
    const range = { from: '2026-08-30', to: '2026-10-03' };
    expect(nativeFetchWindowFor(sel, range)).toEqual(range);
    expect(windowDates(range)).toHaveLength(35);
  });

  it('keeps the same span as the selection moves inside the month, so nothing refetches or flickers', () => {
    const range = { from: '2026-08-30', to: '2026-10-03' };
    const a = nativeFetchWindowFor(new Date(2026, 8, 13, 12), range);
    const b = nativeFetchWindowFor(new Date(2026, 8, 14, 12), range);
    const c = nativeFetchWindowFor(new Date(2026, 8, 17, 12), range);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('still reaches ±2 days past the grid when the selection sits on its edge', () => {
    const range = { from: '2026-08-30', to: '2026-10-03' };
    expect(nativeFetchWindowFor(new Date(2026, 7, 30, 12), range)).toEqual({ from: '2026-08-28', to: '2026-10-03' });
    expect(nativeFetchWindowFor(new Date(2026, 9, 3, 12), range)).toEqual({ from: '2026-08-30', to: '2026-10-05' });
  });

  it('crosses the year', () => {
    expect(nativeFetchWindowFor(new Date(2026, 11, 31, 12))).toEqual({ from: '2026-12-29', to: '2027-01-02' });
    expect(windowDates({ from: '2026-12-30', to: '2027-01-02' })).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
