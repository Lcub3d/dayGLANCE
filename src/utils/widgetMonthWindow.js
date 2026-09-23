// Month-grid data for the widget snapshot: a rolling six-week window of day
// summaries, just enough to draw bars in a calendar grid. Rides the snapshot
// as `monthWindow`, ALONGSIDE `days` (widgetDayProjection.js) — the existing
// widgets keep reading what they read; nothing here replaces anything.
//
// ── The window ─────────────────────────────────────────────────────────────
// The week containing today (by the user's weekStartDay) plus five more: 42
// days, the six rows of a month grid. Past days of the current week are in it,
// so they draw with what the app itself shows for them.
//
// ── Why the payload carries 49 days, not 42 ───────────────────────────────
// The window is BAKED AT WRITE TIME. Neither platform runs JS at midnight:
// Android's MidnightRolloverReceiver and iOS's midnight timeline entry only
// re-render from the stored snapshot (WidgetFreshness.kt / .swift). With the
// app open, the memo in App.jsx is keyed on the day and midnightRefresh.js
// reloads at 00:00:30, so a foregrounded app republishes a rolled window on
// its own; a backgrounded one does not. Within the same week that costs
// nothing — the grid is unchanged and only the "today" cell moves, which the
// widget knows from its own clock. Crossing a week boundary moves the whole
// grid down a row, and the new bottom row is seven days past a 42-day window.
// So the payload carries a ROLLOVER TAIL of one week: for any local day up to
// WIDGET_PROJECTION_DAYS after the push (the same horizon the day-keyed
// `days` covers before the widgets go stale), the six-week grid of that day is
// inside `days`. resolveMonthWindow() is the reference for how a widget picks
// its 42.
//
// ── A bar ──────────────────────────────────────────────────────────────────
// {s, d, c}: start minutes from local midnight, duration in minutes, resolved
// hex. Timed tasks and timed recurring instances, completed ones included (a
// bar is the day's shape, as on the dial), in start order. A block that runs
// past midnight is clipped at 1440 and its remainder drawn at 0 on the next
// day, so a late show still occupies the small hours it really occupies.
// TODAY's placed routines are bars too: routines are a today-only construct
// (useRoutines rolls them at midnight; see mcpRoutines.js), so no other day
// can have one. Zero-length and example tasks are not bars.
//
// ── What is not a bar ──────────────────────────────────────────────────────
// All-day items and deadlines have no time, so they cannot be placed on a
// time axis; they get two per-day arrays of hex colors, `allDay` and
// `deadlines`, one entry per item — enough to draw a strip or dots and to
// count. A flag on a bar would have needed a fake s/d, and a count alone
// would lose the color.
//
// No titles, notes, ids, tags or projects: this is for drawing bars, not an
// agenda. Anything that needs words reads `days`.

import { dateToString } from './taskUtils.js';
import { taskColorToHex } from './colorUtils.js';

/** Six grid rows of seven days. */
export const WIDGET_MONTH_WINDOW_DAYS = 42;
/** One extra week so a week-boundary rollover without the app still fits. */
export const WIDGET_MONTH_ROLLOVER_TAIL_DAYS = 7;
/** Days actually carried in `monthWindow.days`. */
export const WIDGET_MONTH_PAYLOAD_DAYS = WIDGET_MONTH_WINDOW_DAYS + WIDGET_MONTH_ROLLOVER_TAIL_DAYS;
/** The dial's routine colour (DayDial.jsx ROUTINE_COLOR, teal-300). */
export const WIDGET_ROUTINE_HEX = '#5eead4';

const DAY_MINUTES = 1440;

const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const noonOf = (date, plusDays = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + plusDays, 12, 0, 0, 0);

/** First day of the week containing `today`, as a local Date at noon. */
export function monthWindowStart(today, weekStartDay = 0) {
  const back = (today.getDay() - weekStartDay + 7) % 7;
  return noonOf(today, -back);
}

/**
 * Every date the payload carries: window start … start + 48, as local Dates
 * at noon (DST-safe). Exported for the recurring-expansion anchor.
 */
export function monthWindowDates(today, weekStartDay = 0, days = WIDGET_MONTH_PAYLOAD_DAYS) {
  const start = monthWindowStart(today, weekStartDay);
  const out = [];
  for (let i = 0; i < days; i++) out.push(noonOf(start, i));
  return out;
}

/** Raw [startMin, endMin, hex] spans for one day's items, unclipped. */
function spansFor(dayTasks, routines) {
  const spans = [];
  for (const t of dayTasks || []) {
    if (!t || t.isExample || t.isAllDay || !t.startTime) continue;
    const dur = Number(t.duration) || 0;
    if (dur <= 0) continue;
    const s = timeToMinutes(t.startTime);
    spans.push([s, s + dur, taskColorToHex(t.color, t.nativeCalendarColor)]);
  }
  for (const r of routines || []) {
    if (!r || r.isAllDay || !r.startTime) continue;
    const dur = Number(r.duration) || 0;
    if (dur <= 0) continue;
    const s = timeToMinutes(r.startTime);
    spans.push([s, s + dur, WIDGET_ROUTINE_HEX]);
  }
  return spans;
}

/**
 * One day's summary. Pure.
 *
 * @param opts.dateStr       'YYYY-MM-DD'.
 * @param opts.dayTasks      getTasksForDate(date, false) for the day.
 * @param opts.prevDayTasks  The day before, for the overnight carry.
 * @param opts.deadlineTasks Inbox tasks due that day (caller-filtered).
 * @param opts.routines      Placed routines for the day — non-empty for
 *                           today only (the caller applies the date guard).
 * @param opts.prevRoutines  Routines of the day before (yesterday's are gone
 *                           by construction, so normally empty).
 * @returns {{date, bars: Array<{s, d, c}>, allDay: string[], deadlines: string[]}}
 */
export function buildMonthDay({
  dateStr, dayTasks = [], prevDayTasks = [], deadlineTasks = [], routines = [], prevRoutines = [],
}) {
  const bars = [];
  // Carry-in first: the part of yesterday's late blocks that falls today.
  for (const [s, e, c] of spansFor(prevDayTasks, prevRoutines)) {
    if (e > DAY_MINUTES) bars.push({ s: 0, d: Math.min(e - DAY_MINUTES, DAY_MINUTES), c });
  }
  for (const [s, e, c] of spansFor(dayTasks, routines)) {
    if (s >= DAY_MINUTES) continue;
    bars.push({ s, d: Math.min(e, DAY_MINUTES) - s, c });
  }
  bars.sort((a, b) => a.s - b.s || b.d - a.d);

  const allDay = (dayTasks || [])
    .filter(t => t && !t.isExample && t.isAllDay && !t.completed)
    .map(t => taskColorToHex(t.color, t.nativeCalendarColor));
  const deadlines = (deadlineTasks || [])
    .filter(t => t && !t.isExample && !t.completed)
    .map(t => taskColorToHex(t.color, t.nativeCalendarColor));

  return { date: dateStr, bars, allDay, deadlines };
}

/**
 * The snapshot's `monthWindow` field. Pure: every per-day lookup arrives as a
 * callback resolved by the caller (the App.jsx helpers are closures).
 *
 * @param opts.today          Local Date inside today.
 * @param opts.weekStartDay   0 = Sunday, 1 = Monday (the app setting).
 * @param opts.tasksForDate   (Date) => the day's tasks + recurring instances,
 *                            visibility-filtered, no tag filter.
 * @param opts.deadlinesForDate (dateStr) => inbox tasks due that day.
 * @param opts.routinesForDate  (dateStr) => placed routines for the day;
 *                            the caller returns [] for any day but today.
 * @returns {{from: string, weekStart: number, days: Array}}
 */
export function buildWidgetMonthWindow({
  today, weekStartDay = 0,
  tasksForDate = () => [], deadlinesForDate = () => [], routinesForDate = () => [],
}) {
  const dates = monthWindowDates(today, weekStartDay);
  const first = dates[0];
  const prevOfFirst = noonOf(first, -1);
  let prevTasks = tasksForDate(prevOfFirst);
  let prevRoutines = routinesForDate(dateToString(prevOfFirst));
  const days = dates.map((date) => {
    const dateStr = dateToString(date);
    const dayTasks = tasksForDate(date);
    const routines = routinesForDate(dateStr);
    const day = buildMonthDay({
      dateStr, dayTasks, prevDayTasks: prevTasks,
      deadlineTasks: deadlinesForDate(dateStr), routines, prevRoutines,
    });
    prevTasks = dayTasks;
    prevRoutines = routines;
    return day;
  });
  return { from: dateToString(first), weekStart: weekStartDay, days };
}

/**
 * The 42 days a widget should draw on local day `todayStr`, or null when the
 * stored window does not cover that day's grid (the push is too old — the
 * widget shows its stale state, as for `days`). The reference for the native
 * side's resolution: grid start is the week containing the WIDGET's today,
 * by the pushed weekStart; the days are looked up by date, never by index
 * from "now".
 *
 * @param monthWindow  The snapshot's `monthWindow`.
 * @param todayStr     'YYYY-MM-DD', the device's local day.
 */
export function resolveMonthWindow(monthWindow, todayStr) {
  if (!monthWindow || !Array.isArray(monthWindow.days) || !todayStr) return null;
  const today = new Date(todayStr + 'T12:00:00');
  const startStr = dateToString(monthWindowStart(today, monthWindow.weekStart || 0));
  const i = monthWindow.days.findIndex(d => d.date === startStr);
  if (i < 0 || i + WIDGET_MONTH_WINDOW_DAYS > monthWindow.days.length) return null;
  return monthWindow.days.slice(i, i + WIDGET_MONTH_WINDOW_DAYS);
}
