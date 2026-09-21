import { describe, it, expect } from 'vitest';
import { nativeFetchWindowFor, windowDates, NATIVE_FETCH_RADIUS_DAYS, NATIVE_FETCH_MAX_DAYS } from './nativeFetchWindow.js';
import { weekViewDatesFor } from './weekViewDates.js';
import { schedRollingWindow } from './schedAgenda.js';
import { dateToString } from './taskUtils.js';

const sel = new Date(2026, 8, 13, 12); // Sunday 2026-09-13
const days = (...dates) => dates.map(d => new Date(`${d}T12:00:00`));

describe('nativeFetchWindowFor', () => {
  it('is the ±2-day window around the selected day when nothing wider is mounted', () => {
    expect(NATIVE_FETCH_RADIUS_DAYS).toBe(2);
    expect(nativeFetchWindowFor(sel)).toEqual({ from: '2026-09-11', to: '2026-09-15' });
    expect(nativeFetchWindowFor(sel, {})).toEqual({ from: '2026-09-11', to: '2026-09-15' });
    expect(windowDates(nativeFetchWindowFor(sel))).toEqual(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']);
  });

  it("covers MONTH's whole grid while it is up, so cells outside ±2 days keep their events", () => {
    const monthViewRange = { from: '2026-08-30', to: '2026-10-03' };
    expect(nativeFetchWindowFor(sel, { monthViewRange })).toEqual(monthViewRange);
    expect(windowDates(monthViewRange)).toHaveLength(35);
  });

  it("covers WEEK's whole strip, whose far end is days past the ±2 radius", () => {
    // The bug: only Thu–Mon were fetched for a Sun–Sat week, so events on the
    // last three days of the week never loaded and the week looked emptier.
    const weekViewDates = days('2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19');
    expect(nativeFetchWindowFor(sel, { weekViewDates })).toEqual({ from: '2026-09-11', to: '2026-09-19' });
    expect(windowDates(nativeFetchWindowFor(sel, { weekViewDates }))).toContain('2026-09-19');
  });

  it('covers the timeline columns, so widening them past the radius cannot strand a day again', () => {
    const visibleDates = days('2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17');
    expect(nativeFetchWindowFor(sel, { visibleDates })).toEqual({ from: '2026-09-11', to: '2026-09-17' });
  });

  it("covers SCHED's rolling agenda, which runs a fortnight out and grows from there", () => {
    // 14 days from the selection is the default; "show more days" adds 14 more.
    expect(nativeFetchWindowFor(sel, { schedWindow: schedRollingWindow(sel, 14) }))
      .toEqual({ from: '2026-09-11', to: '2026-09-26' });
    expect(nativeFetchWindowFor(sel, { schedWindow: schedRollingWindow(sel, 28) }))
      .toEqual({ from: '2026-09-11', to: '2026-10-10' });
  });

  it('unions every mounted span rather than letting the last one win', () => {
    const weekViewDates = days('2026-09-13', '2026-09-19');
    const monthViewRange = { from: '2026-08-30', to: '2026-09-16' };
    expect(nativeFetchWindowFor(sel, { weekViewDates, monthViewRange }))
      .toEqual({ from: '2026-08-30', to: '2026-09-19' });
  });

  it('keeps the same span as the selection moves inside the month, so nothing refetches or flickers', () => {
    const monthViewRange = { from: '2026-08-30', to: '2026-10-03' };
    const a = nativeFetchWindowFor(new Date(2026, 8, 13, 12), { monthViewRange });
    const b = nativeFetchWindowFor(new Date(2026, 8, 14, 12), { monthViewRange });
    const c = nativeFetchWindowFor(new Date(2026, 8, 17, 12), { monthViewRange });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('still reaches ±2 days past the grid when the selection sits on its edge', () => {
    const monthViewRange = { from: '2026-08-30', to: '2026-10-03' };
    expect(nativeFetchWindowFor(new Date(2026, 7, 30, 12), { monthViewRange })).toEqual({ from: '2026-08-28', to: '2026-10-03' });
    expect(nativeFetchWindowFor(new Date(2026, 9, 3, 12), { monthViewRange })).toEqual({ from: '2026-08-30', to: '2026-10-05' });
  });

  it('stops at the day ceiling, which only a much-extended SCHED agenda can reach', () => {
    // The mobile bridge queries a day at a time; past the cap a day renders
    // without its device events rather than the app making an unbounded run
    // of synchronous calls. A deliberate limit, not an accident of a literal.
    expect(NATIVE_FETCH_MAX_DAYS).toBe(100);
    const huge = windowDates({ from: '2026-01-01', to: '2027-12-31' });
    expect(huge).toHaveLength(NATIVE_FETCH_MAX_DAYS);
    expect(huge[0]).toBe('2026-01-01');
    expect(windowDates(nativeFetchWindowFor(sel, { schedWindow: schedRollingWindow(sel, 14 * 7) })))
      .toHaveLength(NATIVE_FETCH_MAX_DAYS);
  });

  it('crosses the year', () => {
    expect(nativeFetchWindowFor(new Date(2026, 11, 31, 12))).toEqual({ from: '2026-12-29', to: '2027-01-02' });
    expect(windowDates({ from: '2026-12-30', to: '2027-01-02' })).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

// The unit tests above pin each piece; these walk the path App.jsx actually
// takes — the week strip's own rule feeding the fetch window — because the
// bug lived between the two modules, not inside either of them.
describe('the week strip reaches the fetch window', () => {
  const fetchedFor = ({ selectedDate, weekViewMode, weekStartDay, today }) => windowDates(
    nativeFetchWindowFor(selectedDate, {
      weekViewDates: weekViewDatesFor({ viewMode: 'week', selectedDate, weekViewMode, weekStartDay, today }),
    }),
  );

  it('fetches every day of a strict week, from whichever day of it is selected', () => {
    const today = new Date(2026, 8, 16, 9); // Wednesday
    for (const day of [13, 14, 15, 16, 17, 18, 19]) {
      const fetched = fetchedFor({ selectedDate: new Date(2026, 8, day, 12), weekViewMode: 'strict', weekStartDay: 0, today });
      const strip = weekViewDatesFor({ viewMode: 'week', selectedDate: new Date(2026, 8, day, 12), weekViewMode: 'strict', weekStartDay: 0, today });
      for (const d of strip) expect(fetched).toContain(dateToString(d));
    }
  });

  it('fetches every day of a rolling week, which runs a full six days past today', () => {
    const today = new Date(2026, 8, 16, 9);
    const fetched = fetchedFor({ selectedDate: new Date(2026, 8, 16, 12), weekViewMode: 'rolling', weekStartDay: 1, today });
    expect(fetched).toContain('2026-09-22'); // today + 6, four days past the radius
    expect(fetched).toContain('2026-09-14'); // and still the radius behind
  });

  it('asks for no more than the strip plus the radius — the fetch is per-day on the mobile bridge', () => {
    const today = new Date(2026, 8, 16, 9);
    expect(fetchedFor({ selectedDate: new Date(2026, 8, 16, 12), weekViewMode: 'strict', weekStartDay: 0, today }).length)
      .toBeLessThanOrEqual(7 + 2 * NATIVE_FETCH_RADIUS_DAYS);
  });

  it('leaves the plain ±2 window alone in the modes with no week strip', () => {
    const selectedDate = new Date(2026, 8, 16, 12);
    const weekViewDates = weekViewDatesFor({ viewMode: 'multi', selectedDate, weekViewMode: 'strict', weekStartDay: 0 });
    expect(weekViewDates).toEqual([]);
    expect(nativeFetchWindowFor(selectedDate, { weekViewDates })).toEqual({ from: '2026-09-14', to: '2026-09-18' });
  });

  it('does not pay for a span whose view is not on screen — App passes null then', () => {
    // SCHED's window is the unbounded one, and the mobile bridge fetches it a
    // day at a time; App.jsx gates it on schedViewActive for exactly this.
    expect(nativeFetchWindowFor(sel, { schedWindow: null })).toEqual(nativeFetchWindowFor(sel));
    expect(nativeFetchWindowFor(sel, { monthViewRange: null })).toEqual(nativeFetchWindowFor(sel));
  });
});
