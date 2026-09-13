import React, { useEffect, useMemo, useState } from 'react';
import { routinesForDate } from '@glance-apps/agenda-core';
import MonthGrid from './MonthGrid.jsx';
import MonthDaySheet from './MonthDaySheet.jsx';
import { tagKind } from '../../utils/monthCellLayout.js';
import { monthGridDates, monthOf } from '../../utils/monthGrid.js';
import { dateToString } from '../../utils/taskUtils.js';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';

/**
 * MONTH view. A view over `selectedDate` like DAY and WEEK: the grid shows
 * selectedDate's month, the app chrome's arrows page it (useNavigation
 * strides a month here) and Today brings it back, and the highlighted cell
 * is selectedDate itself. Tapping a cell selects that day and opens its
 * sheet; paging inside the sheet moves the selection with it, so closing
 * the sheet leaves the grid, and every other view, on the day the visit
 * ended on. A new scheduled task from the FAB therefore lands on the
 * selected day for free.
 *
 * Recurring occurrences: App.jsx expands them over the union of every
 * view's window. This view publishes its grid's range (monthViewRange) for
 * as long as it is mounted, replaces it whenever the shown month or the
 * week start changes, and clears it on unmount, so a far-off month never
 * silently loses its recurring instances and nothing accumulates.
 */

/**
 * The same sources the other views read: getTasksForDate (scheduled tasks,
 * recurring instances, imported and device calendar events, tag filter
 * applied), the routine strip for the one day routines exist on, and the
 * planner's own deadline accessor (inbox tasks due that day).
 */
export function useMonthItemsForDate() {
  const { getTasksForDate, getDeadlineTasksForDate } = useDayPlannerCtx();
  const { routinesEnabled, todayRoutines, routinesDate, routineCompletions } = useFeaturesCtx();
  return useMemo(() => (dateStr) => {
    const date = new Date(`${dateStr}T12:00:00`);
    const tasks = (getTasksForDate(date) || []).filter((t) => !t.isExample);
    const routines = routinesEnabled
      ? tagKind(routinesForDate({ todayRoutines, routinesDate, routineCompletions }, dateStr), 'routine')
        .map((r) => ({ ...r, id: `routine-${r.id}` }))
      : [];
    const deadlines = (getDeadlineTasksForDate?.(dateStr) || []).map((t) => ({
      id: `deadline-${t.id}`, kind: 'deadline', isAllDay: true, completed: !!t.completed, date: dateStr,
    }));
    return [...tasks, ...routines, ...deadlines];
  }, [getTasksForDate, getDeadlineTasksForDate, routinesEnabled, todayRoutines, routinesDate, routineCompletions]);
}

/** The grid range for a month: first to last drawn cell, YYYY-MM-DD. */
export function monthViewRangeFor(year, month, weekStartDay) {
  const { cells } = monthGridDates(year, month, weekStartDay);
  return { from: cells[0].dateStr, to: cells[cells.length - 1].dateStr };
}

/**
 * @param {object} [props]
 * @param {number} [props.width]   fixed grid-area size, for static rendering
 * @param {number} [props.height]  and tests; the app measures instead
 */
export default function MonthView({ width, height } = {}) {
  const { selectedDate, goToDate, weekStartDay, setMonthViewRange } = useDayPlannerCtx();
  const itemsForDate = useMonthItemsForDate();
  const selectedStr = dateToString(selectedDate);
  const { year, month } = monthOf(selectedStr);
  const [sheetDate, setSheetDate] = useState(null);

  useEffect(() => {
    if (!setMonthViewRange) return undefined;
    setMonthViewRange(monthViewRangeFor(year, month, weekStartDay));
    return () => setMonthViewRange(null);
  }, [year, month, weekStartDay, setMonthViewRange]);

  const showDay = (dateStr) => {
    setSheetDate(dateStr);
    goToDate(dateStr);
  };

  return (
    <div data-month-view className="flex-1 min-h-0 flex flex-col">
      <MonthGrid
        year={year}
        month={month}
        itemsForDate={itemsForDate}
        weekStartDay={weekStartDay}
        selectedDate={selectedStr}
        onSelectDate={showDay}
        width={width}
        height={height}
      />
      {sheetDate && (
        <MonthDaySheet
          date={sheetDate}
          onNavigate={showDay}
          onClose={() => {
            setSheetDate(null);
            // Focus follows the selection out of the sheet, so the keyboard
            // focus ring and the selection ring land on the same cell.
            document.querySelector(`[data-month-cell="${selectedStr}"]`)?.focus();
          }}
        />
      )}
    </div>
  );
}
