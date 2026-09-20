// The date range over which recurring templates are expanded into instances
// (the `expandedRecurringTasks` memo in App.jsx). Pulled out so the anchors
// can be tested: the memo used to anchor TODAY into the range and nothing
// else, which was enough for every in-app consumer but not for the widget
// snapshot's projected days — a user parked on last week had no recurring
// instances for today+1…today+N, and a dial with missing blocks looks
// complete, just emptier. Silent. Hence the second anchor.

import { dateToString } from './taskUtils.js';
import { schedRollingWindow } from './schedAgenda.js';
import { WIDGET_PROJECTION_DAYS } from './widgetDayProjection.js';

/**
 * @param opts.visibleDates    Date[] the timeline is showing.
 * @param opts.weekViewDates   Date[] the week view is showing (may be empty).
 * @param opts.monthViewRange  {from, to} 'YYYY-MM-DD' or null.
 * @param opts.selectedDate    Date the user has navigated to.
 * @param opts.schedDaysShown  Rolling SCHED window length in days.
 * @param opts.today           Date (local) — anchored unconditionally.
 * @param opts.projectionDays  How far past today the widget projects; that
 *                             day is anchored unconditionally too.
 * @returns {{rangeStart: string, rangeEnd: string}} inclusive 'YYYY-MM-DD'.
 */
export function computeRecurringExpansionRange({
  visibleDates = [],
  weekViewDates = [],
  monthViewRange = null,
  selectedDate,
  schedDaysShown = 1,
  today,
  projectionDays = WIDGET_PROJECTION_DAYS,
}) {
  // The SCHED agenda window (mobile SchedView / desktop SchedDashboard)
  // reads days well beyond visibleDates/weekViewDates — on phones weekViewDates
  // is even empty (effectiveViewMode is 'multi'). Always include the agenda's
  // full rolling window so recurring occurrences exist for every rendered day.
  const schedWindow = schedRollingWindow(selectedDate, schedDaysShown);

  // TODAY is anchored into the range unconditionally: plenty of consumers ask
  // about today regardless of where the user has navigated — todayAgenda (and
  // through it GLANCE and the widget snapshot / Live Activity), the macOS NOW
  // bar and title-bar strip. Without the anchor, navigating wholly past (or
  // before) today silently dropped today's recurring instances from all of
  // them — visible as tag pills vanishing from the title bar when paging
  // forward off a weekend-only recurring task's day.
  //
  // TODAY + projectionDays is anchored for the same reason on behalf of the
  // widget snapshot's projected days (widgetDayProjection.js), which are
  // built from tasksByDate whatever the user is looking at.
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + projectionDays);

  const allDateStrs = [
    ...visibleDates.map(d => dateToString(d)),
    ...weekViewDates.map(d => dateToString(d)),
    ...(monthViewRange ? [monthViewRange.from, monthViewRange.to] : []),
    dateToString(selectedDate),
    schedWindow.to,
    dateToString(today),
    dateToString(horizon),
  ].sort();
  return { rangeStart: allDateStrs[0], rangeEnd: allDateStrs[allDateStrs.length - 1] };
}
