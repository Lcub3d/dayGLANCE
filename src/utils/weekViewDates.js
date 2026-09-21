// The seven dates the week strip covers.
//
// Extracted from App.jsx because two things need it and they sit ~2400 lines
// apart: the WEEK columns / SCHED date navigation, and the device-calendar
// fetch window (utils/nativeFetchWindow.js), which has to cover every day a
// mounted view renders or events on those days never load.
//
// 'rolling' means today + 6 days, and only while the user is actually looking
// at today — paging to another date falls back to that date's calendar week,
// because a rolling strip anchored anywhere but today is just a confusing
// week. 'strict' is the calendar week containing the selected date, starting
// on weekStartDay.

import { dateToString } from './taskUtils.js';

export const WEEK_VIEW_DAYS = 7;

/** The view modes whose strip is the week; every other mode has none. */
const WEEK_STRIP_MODES = new Set(['week', 'sched']);

const runOfDays = (start, length) => Array.from({ length }, (_, i) => {
  const d = new Date(start);
  d.setDate(d.getDate() + i);
  return d;
});

/**
 * @param opts.viewMode      the effective view mode ('week' and 'sched' have a strip).
 * @param opts.selectedDate  Date the user has navigated to.
 * @param opts.weekViewMode  'rolling' | 'strict'.
 * @param opts.weekStartDay  0 (Sunday) … 6, for the strict week.
 * @param opts.today         Date (local); defaults to now.
 * @returns {Date[]} seven local midnights, or [] when the mode has no strip.
 */
export function weekViewDatesFor({ viewMode, selectedDate, weekViewMode, weekStartDay = 0, today = new Date() }) {
  if (!WEEK_STRIP_MODES.has(viewMode)) return [];
  const base = new Date(selectedDate);
  base.setHours(0, 0, 0, 0);

  if (weekViewMode === 'rolling' && dateToString(base) === dateToString(today)) {
    return runOfDays(base, WEEK_VIEW_DAYS);
  }

  const diff = (base.getDay() - weekStartDay + 7) % 7;
  const weekStart = new Date(base);
  weekStart.setDate(weekStart.getDate() - diff);
  return runOfDays(weekStart, WEEK_VIEW_DAYS);
}
