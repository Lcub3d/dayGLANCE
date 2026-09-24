import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { routinesForDate } from '@glance-apps/agenda-core';
import MonthGrid from './MonthGrid.jsx';
import MonthDaySheet, { MONTH_DAY_SHEET_HISTORY_KEY } from './MonthDaySheet.jsx';
import SchedView from '../sched/SchedView.jsx';
import DayHeaderCell from '../DayHeader.jsx';
import { tagKind } from '../../utils/monthCellLayout.js';
import { monthGridDates, monthOf, monthPanelWidth } from '../../utils/monthGrid.js';
import { consumeMonthSheetRequest } from '../../utils/dayLink.js';
import { MONTH_CELL_LAYOUT } from '../../constants/monthView.js';
import { dateToString } from '../../utils/taskUtils.js';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';

/**
 * MONTH view. A view over `selectedDate` like DAY and WEEK: the grid shows
 * selectedDate's month, the app chrome's arrows page it (useNavigation
 * strides a month here) and Today brings it back, and the highlighted cell
 * is selectedDate itself.
 *
 * The selected day's agenda is the same scoped SCHED in one of two homes,
 * never both:
 *  • Wide desktop (the 3-column breakpoint DAY needs, canShowViewCycler): a
 *    panel docked to the right of the grid. The grid answers "what does the
 *    month look like", the panel "what is on this day", and nothing covers
 *    the selected cell. Tapping a cell just selects it and the panel
 *    follows; Enter moves focus into the panel.
 *  • Everywhere else: the bottom sheet. Tapping a cell selects the day and
 *    opens its sheet; paging inside the sheet moves the selection with it.
 * Either way closing or switching leaves the grid, and every other view, on
 * the day the visit ended on, and a new task from the FAB lands on it.
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
 * The docked panel's width bounds (utils/monthGrid.js monthPanelWidth): a
 * third of the row, or more when the grid's capped cells leave width unused,
 * never under the minimum SCHED's cards need nor over a width where one
 * day's agenda only gets wider lines.
 */
export const MONTH_PANEL_WIDTH = Object.freeze({ min: 380, max: 640, share: 1 / 3 });

/**
 * @param {object} [props]
 * @param {number} [props.width]   fixed grid-area size, for static rendering
 * @param {number} [props.height]  and tests; the app measures instead
 */
export default function MonthView({ width, height } = {}) {
  const { selectedDate, goToDate, weekStartDay, setMonthViewRange, openMonthDaySheetRef, monthSheetRequest, setMonthSheetRequest, canShowViewCycler, borderClass, cardBg } = useDayPlannerCtx();
  const itemsForDate = useMonthItemsForDate();
  const selectedStr = dateToString(selectedDate);
  const { year, month } = monthOf(selectedStr);
  const [sheetDate, setSheetDate] = useState(null);
  // The docked panel takes the sheet's place at the width DAY needs; the two
  // are never on screen together.
  const docked = !!canShowViewCycler;
  const panelRef = useRef(null);
  const rootRef = useRef(null);

  // The panel's width follows the row's width and the grid's height (its
  // natural width depends on the height alone, so the panel changing the
  // grid's width feeds nothing back). Fixed sizes stand in for both when
  // rendered statically.
  const [rowWidth, setRowWidth] = useState(width || 0);
  const [gridAreaHeight, setGridAreaHeight] = useState(height || 0);
  const onGridMeasure = useCallback((area) => setGridAreaHeight(area.height), []);
  useLayoutEffect(() => {
    if (!docked || width) return undefined;
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => setRowWidth(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docked, width]);
  const rows = useMemo(() => monthGridDates(year, month, weekStartDay).rows, [year, month, weekStartDay]);
  const panelWidth = monthPanelWidth(rowWidth, gridAreaHeight, rows, MONTH_CELL_LAYOUT, MONTH_PANEL_WIDTH);

  useEffect(() => {
    if (!setMonthViewRange) return undefined;
    setMonthViewRange(monthViewRangeFor(year, month, weekStartDay));
    return () => setMonthViewRange(null);
  }, [year, month, weekStartDay, setMonthViewRange]);

  // Crossing the breakpoint with the sheet open: the panel takes over, and
  // the sheet's history entry goes with it so a later Back does not swallow
  // a press on a sheet that is no longer there.
  useEffect(() => {
    if (!docked || !sheetDate) return;
    setSheetDate(null);
    if (typeof window !== 'undefined' && window.history?.state?.[MONTH_DAY_SHEET_HISTORY_KEY]) window.history.back();
  }, [docked, sheetDate]);

  const showDay = (dateStr) => {
    if (!docked) setSheetDate(dateStr);
    goToDate(dateStr);
  };

  // A month grid widget tap (utils/dayLink.js): App selects the day and asks
  // for its sheet; the first render that sees the request uses it up. Docked,
  // the panel already shows the selected day, so there is nothing to open.
  useEffect(() => {
    const { open, clear } = consumeMonthSheetRequest(monthSheetRequest, { selectedStr, docked });
    if (open) setSheetDate(open);
    if (clear) setMonthSheetRequest?.(null);
  }, [monthSheetRequest, selectedStr, docked, setMonthSheetRequest]);

  // Enter (useKeyboardShortcuts): the sheet for the selected day, or, when
  // the panel is docked, focus into it (its first control, else the panel).
  useEffect(() => {
    if (!openMonthDaySheetRef) return undefined;
    openMonthDaySheetRef.current = () => {
      if (!docked) { setSheetDate(selectedStr); return; }
      const panel = panelRef.current;
      const first = panel?.querySelector('[data-month-panel-content] button, [data-month-panel-content] [tabindex]');
      (first || panel)?.focus?.();
    };
    return () => { openMonthDaySheetRef.current = null; };
  }, [openMonthDaySheetRef, selectedStr, docked]);

  return (
    <div ref={rootRef} data-month-view data-month-view-layout={docked ? 'docked' : 'sheet'} className="flex-1 min-h-0 flex flex-row">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <MonthGrid
          year={year}
          month={month}
          itemsForDate={itemsForDate}
          weekStartDay={weekStartDay}
          selectedDate={selectedStr}
          onSelectDate={showDay}
          width={width}
          height={height}
          onMeasure={onGridMeasure}
        />
      </div>
      {docked && (
        <aside
          ref={panelRef}
          data-month-panel={selectedStr}
          tabIndex={-1}
          aria-label={`${selectedStr}`}
          className={`shrink-0 min-h-0 flex flex-col border-l ${borderClass} ${cardBg} outline-none`}
          style={{ width: panelWidth }}
        >
          {/* The selected day's header lives here when docked: the header
              row above the grid keeps the switcher and the month's numbers. */}
          <DayHeaderCell date={selectedDate} className={`shrink-0 border-b ${borderClass}`} />
          <div data-month-panel-content className="flex-1 min-h-0 overflow-y-auto">
            <SchedView dateRange={{ from: selectedStr, to: selectedStr }} embedded />
          </div>
        </aside>
      )}
      {!docked && sheetDate && (
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
