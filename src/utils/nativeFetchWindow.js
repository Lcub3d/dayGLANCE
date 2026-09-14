// The span of days the device-calendar fetch covers.
//
// The timeline needs the selected day and its neighbours: a ±2-day window,
// which every view except MONTH shows inside. MONTH draws up to 42 days at
// once, so while it is up the fetch has to cover its whole grid, or events
// pop in and out of cells as the selection (and the window) moves. The
// result is one contiguous span so the Electron helper still resolves it in
// a single call, and its from/to strings make a stable key: moving the
// selection inside the month does not change the span, so it does not
// refetch.

import { dateToString } from './taskUtils.js';

export const NATIVE_FETCH_RADIUS_DAYS = 2;

const shift = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return dateToString(d); };

/**
 * @param {Date} selectedDate
 * @param {{ from: string, to: string } | null} [monthViewRange]  the MONTH grid's range while it is mounted
 * @returns {{ from: string, to: string }}  YYYY-MM-DD, inclusive
 */
export function nativeFetchWindowFor(selectedDate, monthViewRange = null) {
  let from = shift(selectedDate, -NATIVE_FETCH_RADIUS_DAYS);
  let to = shift(selectedDate, NATIVE_FETCH_RADIUS_DAYS);
  if (monthViewRange?.from && monthViewRange?.to) {
    if (monthViewRange.from < from) from = monthViewRange.from;
    if (monthViewRange.to > to) to = monthViewRange.to;
  }
  return { from, to };
}

/** Every day of a window, in order. */
export function windowDates({ from, to }) {
  const dates = [];
  const end = new Date(`${to}T12:00:00`);
  for (const d = new Date(`${from}T12:00:00`); d <= end && dates.length < 100; d.setDate(d.getDate() + 1)) dates.push(dateToString(d));
  return dates;
}
