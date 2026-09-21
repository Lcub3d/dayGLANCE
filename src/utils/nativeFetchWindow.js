// The span of days the device-calendar fetch covers.
//
// It is the union of a ±2-day window around the selected day and every span a
// mounted view is actually RENDERING. The radius alone was once assumed to
// cover "every view except MONTH", and that assumption has been wrong twice:
// MONTH's six-week grid (fixed by passing its range), and then WEEK's seven
// columns and SCHED's rolling fortnight, whose far ends sit days or weeks
// past the radius — events there never loaded, so a week looked emptier than
// it was. A view that draws a day it did not hand to this function gets no
// device events on that day, so pass what a view renders rather than trusting
// the radius to contain it.
//
// The corollary: a span belongs here only while its view is actually on
// screen. SCHED's window grows by a fortnight on every "show more days", and
// the mobile bridge fetches a day at a time, so a span left in after its view
// unmounts is paid for on every refetch.
//
// The result is one contiguous span so the Electron helper still resolves it
// in a single call, and its from/to strings make a stable key: moving the
// selection inside a span does not change the span, so it does not refetch.

import { dateToString } from './taskUtils.js';

export const NATIVE_FETCH_RADIUS_DAYS = 2;

const shift = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return dateToString(d); };

/**
 * @param {Date} selectedDate
 * @param {object} [rendered]                 the spans mounted views are drawing
 * @param {Date[]} [rendered.visibleDates]    the timeline's day columns
 * @param {Date[]} [rendered.weekViewDates]   the week strip (empty outside WEEK/SCHED)
 * @param {{from: string, to: string}|null} [rendered.monthViewRange]  MONTH's grid
 * @param {{from: string, to: string}|null} [rendered.schedWindow]  SCHED's rolling agenda
 * @returns {{ from: string, to: string }}  YYYY-MM-DD, inclusive
 */
export function nativeFetchWindowFor(selectedDate, rendered = {}) {
  const { visibleDates = [], weekViewDates = [], monthViewRange = null, schedWindow = null } = rendered;
  let from = shift(selectedDate, -NATIVE_FETCH_RADIUS_DAYS);
  let to = shift(selectedDate, NATIVE_FETCH_RADIUS_DAYS);

  const cover = (start, end) => {
    if (start && start < from) from = start;
    if (end && end > to) to = end;
  };
  for (const dates of [visibleDates, weekViewDates]) {
    if (!dates.length) continue;
    const strs = dates.map(dateToString).sort();
    cover(strs[0], strs[strs.length - 1]);
  }
  cover(monthViewRange?.from, monthViewRange?.to);
  cover(schedWindow?.from, schedWindow?.to);

  return { from, to };
}

/**
 * The ceiling on days fetched in one pass. The mobile bridge queries a day at
 * a time, so an unbounded span would be an unbounded run of synchronous
 * calls; SCHED's agenda is the only span that can reach it, after seven
 * rounds of "show more days". Past it a day renders without its device
 * events — the lesser of the two failures, and a deliberate one.
 */
export const NATIVE_FETCH_MAX_DAYS = 100;

/** Every day of a window, in order, up to NATIVE_FETCH_MAX_DAYS. */
export function windowDates({ from, to }) {
  const dates = [];
  const end = new Date(`${to}T12:00:00`);
  for (const d = new Date(`${from}T12:00:00`); d <= end && dates.length < NATIVE_FETCH_MAX_DAYS; d.setDate(d.getDate() + 1)) dates.push(dateToString(d));
  return dates;
}
