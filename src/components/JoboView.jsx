import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, ClipboardCheck, FoldVertical, PanelRightClose, PanelRightOpen, Plus, UnfoldVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import useDayViewHourHeight from '../hooks/useDayViewHourHeight.js';
import { DayViewColumn } from './DayView.jsx';
import DoColumn, { snapMinute, estimateCompletion, windowRange } from './jobo/DoColumn.jsx';
import useJoboPreference from '../hooks/useJoboPreference.js';
import useJoboRefocus from '../hooks/useJoboRefocus.js';
import RefocusTimelineToast from './RefocusTimelineToast.jsx';
import useMinWidth from '../hooks/useMinWidth.js';
import useTimelineZoom from '../hooks/useTimelineZoom.js';
import JoboNotesSidebar from './jobo/JoboNotesSidebar.jsx';
import DoEditor from './jobo/DoEditor.jsx';
import ExecutionDetails from './jobo/ExecutionDetails.jsx';
import CheckPanel from './jobo/CheckPanel.jsx';
import StatisticsPanel from './jobo/StatisticsPanel.jsx';
import { assignOverlapColumns, buildJoboDayModel } from '../jobo/viewModel.js';
import { intervalFromMarker } from '../jobo/completionMarker.js';
import { doLinkCandidates } from '../jobo/linkCandidates.js';
import { prepareDoEdit, commitDoEdit, offersCompleteTask } from '../jobo/viewActions.js';
import useJoboViewWriter from '../hooks/useJoboViewWriter.js';
import { createCarryForwardActions } from '../jobo/carryForwardActions.js';
import { buildCheckSummary } from '../jobo/checkSummary.js';
import { statisticsEvidenceDates } from '../jobo/checkStatistics.js';
import { weekViewDatesFor } from '../utils/weekViewDates.js';

// JOBO: Plan and Do for one day, side by side on one hour axis.
//
// The Plan side IS the app's timeline: DAY's own column over 24 hours, so it
// has the real task cards, drag and drop (Inbox included), the blue hover
// line, click-to-add, the timeline context menu, Frames and the now line,
// and the native checkbox completes the task through the usual handler (the
// slice 4 detector then records the Do). Nothing here re-implements them.
//
// The Do side is drawn to the same grid (DoColumn) from the day model
// (src/jobo/viewModel.js). It reads committed `joboRecords` only and writes
// through `recordJobo`, via the receipt hook that never calls a pending
// write saved. Gestures snap to 15 minutes like every other view.

// Plan's cell holds the 4rem hour gutter plus its half; Do gets the other half.
const GRID = 'grid grid-cols-[calc(50%+2rem)_minmax(0,1fr)]';
const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// A task id inside an attribute selector. CSS.escape where the platform has
// it; otherwise quotes and backslashes, the only characters that can break
// out of the quoted value.
const cssEscape = (value) => (typeof CSS !== 'undefined' && CSS.escape
  ? CSS.escape(String(value))
  : String(value).replace(/["\\]/g, '\\$&'));

/**
 * The editor's opening state for continuing `record`: its title, its task and
 * its captured plan. createManualDo derives the taskId from `task`, so passing
 * the record's own taskId keeps a recurring template id as it is.
 */
export const continueInitial = (record, date, startMinute) => ({
  date, startMinute, duration: 30,
  title: record.title,
  task: { id: record.taskId },
  planSnapshot: record.planSnapshot ?? null,
  continuing: true,
});

// A card's details open on click and close on a second click of the same
// card. ExecutionDetails closes on a click anywhere else, but leaves its own
// card to this toggle, so the two never fight over one click.
export const toggleDetails = (open, item, anchor) => (open?.item?.id === item.id ? null : { item, anchor });

export default function JoboView() {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboRecords, joboLoaded, joboWritable, joboError, reloadJobo, recordJobo, recordJoboUndo, goalsProjectsEnabled, projects, goals, isVisibleForUser } = useFeaturesCtx();
  // Every accepted Do write becomes a step in the app's undo history.
  const writer = useJoboViewWriter({ records: joboRecords, recordJobo, onWritten: recordJoboUndo });
  const baseHourHeight = useDayViewHourHeight(ctx.calendarRef, ctx.stickyHeaderRef);

  const [checkOpen, setCheckOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [preview, setPreview] = useState(null);
  const [gestureError, setGestureError] = useState('');
  // Hover pairing: the task under the pointer on either side. Its Plan card
  // and every Do card that belongs to it are outlined together, which reads
  // where colour alone cannot (two tasks can share a colour).
  const [hoverTaskId, setHoverTaskId] = useState(null);
  // The notes sidebar, on wide screens only: the Daily Note, and the notes
  // of the task last clicked on either side (or picked with a Do card's
  // Notes button, which then opens here instead of below the card).
  const wide = useMinWidth(1600);
  const [notesPreferred, toggleNotesSidebar] = useJoboPreference('notes-sidebar');
  const sidebar = wide && notesPreferred;
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  // The width the Plan/Do scroll area's scrollbar takes (0 where scrollbars
  // overlay). The Do header sits inside that area and the sidebar header
  // does not, so the sidebar header pads its button by this much to land it
  // where it sat in the Do header. ResizeObserver catches both a resize and
  // a scrollbar appearing or going (the content box changes either way).
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setScrollbarWidth(Math.max(0, el.offsetWidth - el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [joboLoaded]);
  // The sidebar's button, styled like Add Do. It stays at the top right of
  // the view: at the end of the Do header while the sidebar is closed, and at
  // the end of the sidebar's own header row, the same height, once it opens.
  const notesToggle = (
    <button
      type="button"
      data-jobo-notes-sidebar-toggle
      onClick={toggleNotesSidebar}
      aria-pressed={notesPreferred}
      className="h-7 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      title={t(notesPreferred ? 'jobo.view.hideNotesSidebar' : 'jobo.view.showNotesSidebar')}
    >
      {notesPreferred ? <PanelRightClose size={14} strokeWidth={2.5} /> : <PanelRightOpen size={14} strokeWidth={2.5} />}
      <span className="text-xs font-medium">{t('task.notes')}</span>
    </button>
  );
  const scrollRef = useRef(null);
  const gridRef = useRef(null);
  // Timeline magnification (utils/timelineZoom.js): one factor on the hour
  // height, which every position here derives from, and on the cards'
  // contents. DAY's column takes the same factor for the Plan side.
  const zoom = useTimelineZoom('jobo', { scrollRef, originRef: gridRef });
  const hourHeight = baseHourHeight * zoom;
  const doLane = useRef(null);
  const gestureCleanup = useRef(null);
  const live = useRef(null);
  live.current = { joboRecords, joboWritable, joboLoaded, pendingIds: writer.pendingIds };

  const { selectedDate, getTasksForDate } = ctx;
  const date = dateToString(selectedDate);
  const dayStart = useMemo(() => { const d = new Date(selectedDate); d.setHours(0, 0, 0, 0); return d; }, [selectedDate]);
  // START to END only, when the day has a window and the toggle is on. Both
  // sides draw the same hours; every minute/pixel conversion below goes
  // through windowStart.
  const { getDayWindow } = useFeaturesCtx();
  const [windowOnly, toggleWindowOnly] = useJoboPreference('window-only');
  const dayWindow = getDayWindow?.(date) ?? null;
  const fullDay = { startHour: 0, endHour: 24 };
  const windowHours = dayWindow ? windowRange(dayWindow) : fullDay;
  const canTrim = windowHours.startHour !== 0 || windowHours.endHour !== 24;
  const { startHour, endHour } = windowOnly && canTrim ? windowHours : fullDay;
  const windowStart = startHour * 60;
  const planColumn = useMemo(() => ({ date: dayStart, dateStr: date, startHour, endHour }), [dayStart, date, startHour, endHour]);
  const currentTime = ctx.currentTime instanceof Date ? ctx.currentTime : new Date();
  const nowDate = dateToString(currentTime);
  const nowTime = clock(currentTime.getHours() * 60 + currentTime.getMinutes());

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate, false).filter((task) => !task.isAllDay && task.startTime),
    [getTasksForDate, selectedDate],
  );
  const lookup = useMemo(
    () => [...(ctx.tasks || []), ...(ctx.unscheduledTasks || []), ...(ctx.expandedRecurringTasks || []), ...dayTasks],
    [ctx.tasks, ctx.unscheduledTasks, ctx.expandedRecurringTasks, dayTasks],
  );
  const model = useMemo(() => buildJoboDayModel({
    date, tasks: dayTasks, taskLookup: lookup, recurringTasks: ctx.recurringTasks,
    records: joboRecords || [], scale: hourHeight, isVisibleForUser,
    now: { date: nowDate, time: nowTime },
  }), [date, dayTasks, lookup, ctx.recurringTasks, joboRecords, hourHeight, isVisibleForUser, nowDate, nowTime]);
  const statisticsWeekDates = useMemo(() => weekViewDatesFor({
    viewMode: 'week', selectedDate, weekViewMode: ctx.weekViewMode,
    weekStartDay: ctx.weekStartDay, today: new Date(`${nowDate}T12:00:00`),
  }), [selectedDate, ctx.weekViewMode, ctx.weekStartDay, nowDate]);
  const statisticsEvidence = useMemo(() => statisticsEvidenceDates({
    records: joboRecords || [],
    tasks: [...(ctx.tasks || []), ...(ctx.unscheduledTasks || [])],
    recurringTasks: ctx.recurringTasks || [],
    anchorDate: date, throughDate: nowDate,
  }), [joboRecords, ctx.tasks, ctx.unscheduledTasks, ctx.recurringTasks, date, nowDate]);
  const buildStatisticsReport = useCallback((reportDate) => {
    if (!joboLoaded || !Array.isArray(joboRecords)) return null;
    const selected = new Date(`${reportDate}T12:00:00`);
    const reportTasks = getTasksForDate(selected, false).filter((task) => !task.isAllDay && task.startTime);
    const reportLookup = [
      ...(ctx.tasks || []), ...(ctx.unscheduledTasks || []),
      ...(ctx.expandedRecurringTasks || []), ...reportTasks,
    ];
    const reportModel = buildJoboDayModel({
      date: reportDate, tasks: reportTasks, taskLookup: reportLookup,
      recurringTasks: ctx.recurringTasks, records: joboRecords, isVisibleForUser,
      now: { date: nowDate, time: nowTime },
    });
    return buildCheckSummary(reportModel, { date: reportDate, inboxTasks: ctx.unscheduledTasks || [] });
  }, [
    joboLoaded, joboRecords, getTasksForDate, ctx.tasks, ctx.unscheduledTasks,
    ctx.expandedRecurringTasks, ctx.recurringTasks, isVisibleForUser, nowDate, nowTime,
  ]);
  const doItems = useMemo(
    () => assignOverlapColumns(
      [...model.timedRecords, ...model.untimedRecords.map(estimateCompletion)],
      { scale: hourHeight, minHeightPx: 27 * zoom, gapPx: 2 },
    ),
    [model.timedRecords, model.untimedRecords, hourHeight, zoom],
  );
  const openCheckNotes = (task) => {
    setCheckOpen(false);
    if (sidebar && lookup.some(candidate => String(candidate.id) === String(task.id))) {
      setSelectedTaskId(task.id);
      return;
    }
    // Leave the read-only journal before opening native task notes. Spotlight's
    // existing navigation handles off-day plans, Inbox and archived projects.
    const isInbox = (ctx.unscheduledTasks || []).some(candidate => String(candidate.id) === String(task.id));
    ctx.handleSpotlightSelect({ task, source: task.archived ? 'archived' : isInbox ? 'inbox' : 'scheduled' });
    ctx.setExpandedNotesTaskId(task.id);
  };
  // Continue, Schedule… and Add follow-up from the Check, through the app's
  // own task actions. Opening a form leaves the Check first, as notes do.
  const carryActions = createCarryForwardActions({ ...ctx, projects: goalsProjectsEnabled ? projects : [] });
  const carry = {
    continueTask: carryActions.continueTask,
    editOn: (task, on) => { setCheckOpen(false); carryActions.editOn(task, on); },
    openFollowUp: (task, on) => { setCheckOpen(false); carryActions.openFollowUp(task, on); },
  };
  const canOpenCheckNotes = typeof ctx.handleSpotlightSelect === 'function'
    && typeof ctx.setExpandedNotesTaskId === 'function';
  const liveDetail = details && doItems.find((item) => item.id === details.item.id);
  // The selected task as it is now, so the sidebar follows edits and sync.
  const selectedTask = selectedTaskId == null ? null : lookup.find((task) => String(task.id) === String(selectedTaskId)) || null;

  // Open on the part of the day that matters: an hour before now on today,
  // otherwise an hour before the first Plan or Do. Today's opening is also
  // where Refocus timeline returns to.
  const scrollTopFor = (anchorMinute) => Math.max(0, (anchorMinute - 60 - windowStart) * hourHeight / 60);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstMinute = Math.min(
      ...model.plans.map((item) => item.startMinute),
      ...doItems.map((item) => item.startMinute),
      8 * 60,
    );
    const anchorMinute = date === nowDate ? currentTime.getHours() * 60 : firstMinute;
    el.scrollTop = scrollTopFor(anchorMinute);
    // Only on a new day, screen height or visible range, never on an
    // ordinary re-render, and never on a zoom: that keeps the time under the
    // pointer where it was (hooks/useTimelineZoom.js), so it keys on the
    // unzoomed hour height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, baseHourHeight, windowStart]);

  // Refocus timeline, as in MULTI: on today, when the now line is out of
  // view, and on its own at every :00 and :30.
  const headerRef = useRef(null);
  const nowMinute = currentTime.getHours() * 60 + currentTime.getMinutes();
  const refocus = useJoboRefocus({
    scrollRef,
    headerRef,
    enabled: joboLoaded && date === nowDate && nowMinute >= windowStart && nowMinute <= endHour * 60,
    nowOffset: (nowMinute - windowStart) * hourHeight / 60,
    homeTop: scrollTopFor(currentTime.getHours() * 60),
  });

  useEffect(() => () => gestureCleanup.current?.(), []);
  useEffect(() => { gestureCleanup.current?.(); }, [date]);

  // What a new Do can link to, built only while an editor is open.
  const linkCandidates = useMemo(
    () => (editor && !editor.record
      ? doLinkCandidates({
        // The day's tasks arrive filtered for this household member; the
        // Inbox is filtered here the same way.
        dayTasks: getTasksForDate(selectedDate, false),
        inboxTasks: (ctx.unscheduledTasks || []).filter((task) => typeof isVisibleForUser !== 'function' || isVisibleForUser(task)),
        ...(goalsProjectsEnabled ? { projects: projects || [], goals: goals || [] } : {}),
      })
      : []),
    [editor, getTasksForDate, selectedDate, ctx.unscheduledTasks, goalsProjectsEnabled, projects, goals, isVisibleForUser],
  );
  const closeEditor = useCallback(() => setEditor(null), []);
  // "Complete task" in the editor is the linked task's checkbox: the same
  // handler, with the Inbox flag the Inbox's own checkbox passes. The Do
  // record is never written by it; the detector records the completion.
  const completeTaskFor = (record) => {
    const task = record ? model.resolveRecordTask(record) : null;
    if (!offersCompleteTask(record, task) || typeof ctx.toggleComplete !== 'function') return undefined;
    const fromInbox = (ctx.unscheduledTasks || []).some((inboxTask) => inboxTask.id === task.id);
    return () => ctx.toggleComplete(task.id, fromInbox);
  };
  const closeDetails = useCallback(() => setDetails(null), []);
  // Editing an estimate opens with the estimated times filled in, so saving
  // it is the explicit "keep as shown"; clearing the start keeps the marker.
  const openEdit = (record) => {
    closeDetails();
    const shown = doItems.find((item) => item.record?.id === record.id && item.estimate);
    setEditor(shown
      ? { record, initial: { patch: { startTime: clock(shown.startMinute), endTime: shown.time, date: shown.date } } }
      : { record });
  };
  const openAdd = (startMinute) => { closeDetails(); setEditor({ initial: { date, startMinute, duration: 30 } }); };
  // Continue an unfinished attempt: a new Do on the same task and captured
  // plan, so it joins the original as another session of one execution. It
  // starts where the attempt ended, or now if that has already passed today.
  const openContinue = (item) => {
    closeDetails();
    const { record } = item;
    const ended = snapMinute(item.markerMinute ?? item.endMinute);
    const nowMinute = snapMinute(currentTime.getHours() * 60 + currentTime.getMinutes());
    const startMinute = Math.min(1410, date === nowDate ? Math.max(ended, nowMinute) : ended);
    setEditor({ initial: continueInitial(record, date, startMinute) });
  };

  const saveEdit = async (record, patch) => {
    const current = live.current;
    if (!current.joboLoaded || !current.joboWritable || current.pendingIds.includes(record.id)) return;
    setGestureError('');
    try {
      const next = prepareDoEdit({ records: current.joboRecords, record, patch, now: Date.now() });
      if (!next) { setGestureError(t('jobo.view.recordChanged')); return; }
      await commitDoEdit(writer.write, next);
    } catch (error) {
      setGestureError(t(error.code === 'recordChanged' ? 'jobo.view.recordChanged' : 'jobo.view.updateFailed'));
    }
  };

  // One pointer gesture on the Do column, with a live preview. `toRange`
  // turns the snapped minute under the pointer (and the one it went down on)
  // into { start, end } or null; `toPatch` turns the final range into the
  // record patch.
  const runGesture = (event, { toRange, toPatch, record }) => {
    if (event.button !== 0 || !joboWritable || writer.pendingIds.includes(record.id)) return;
    event.preventDefault();
    event.stopPropagation();
    gestureCleanup.current?.();
    const startY = event.clientY;
    const laneTop = doLane.current?.getBoundingClientRect().top ?? 0;
    const downMinute = (startY - laneTop) / hourHeight * 60 + windowStart;
    let range = null;
    const move = (e) => {
      if (Math.abs(e.clientY - startY) < 5) { range = null; setPreview(null); return; }
      const bounds = doLane.current?.getBoundingClientRect();
      if (!bounds) return;
      const minute = (e.clientY - bounds.top) / hourHeight * 60 + windowStart;
      range = toRange(snapMinute(minute), minute - downMinute);
      setPreview(range);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('keydown', escape, true);
      setPreview(null);
      gestureCleanup.current = null;
    };
    const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cleanup(); } };
    const finish = (e) => {
      move(e);
      const chosen = range;
      cleanup();
      // The browser follows a drag's pointerup with a click on whatever is
      // under it: the empty column (which would open Add Do) or the card
      // (its details). A drag is not a click, so swallow that one click.
      if (Math.abs(e.clientY - startY) >= 5) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      const patch = chosen && toPatch(chosen);
      if (patch) saveEdit(record, patch);
    };
    gestureCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
    window.addEventListener('keydown', escape, true);
  };

  // The timed patch for an interval of the item's day. Midnight is the next
  // day's 00:00, the shape core expects.
  const timedPatch = (date, start, end) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      timing: 'timed', date, startTime: clock(start),
      endDate: end >= 1440 ? next.toISOString().slice(0, 10) : date, endTime: clock(end % 1440),
    };
  };

  // Keep an estimate as shown: the same timed write a move or an editor save
  // makes, under the same id, with the times the card displays.
  const keepEstimate = (item) => {
    if (!item.estimate) return;
    saveEdit(item.record, timedPatch(item.date, item.startMinute, item.endMinute));
  };

  // Drag an estimate to where the work really was: it moves whole, its start
  // snapped to 15 minutes, and saving it makes it a timed Do under the same id.
  const onEstimateMove = (event, item) => {
    const duration = item.endMinute - item.startMinute;
    runGesture(event, {
      record: item.record,
      toRange: (_minute, delta) => {
        const start = Math.max(0, Math.min(1440 - duration, snapMinute(item.startMinute + delta)));
        return start === item.startMinute ? null : { start, end: start + duration };
      },
      toPatch: (range) => timedPatch(item.date, range.start, range.end),
    });
  };

  // Drag from a completion marker: the marker is one end of the interval,
  // the pointer the other. Same id; the record becomes timed. An estimate
  // moves instead.
  const onPointGesture = (event, item) => (item.estimate ? onEstimateMove(event, item) : runGesture(event, {
    record: item.record,
    toRange: (minute) => (minute === item.startMinute ? null
      : { start: Math.min(item.startMinute, minute), end: Math.max(item.startMinute, minute) }),
    toPatch: (range) => intervalFromMarker(item, range.start === item.startMinute ? range.end : range.start),
  }));

  // Drag the bottom handle of a timed Do to move its end, as with a task. On
  // an estimate it sets the real end, keeping the estimated start.
  const onResizeGesture = (event, item) => (item.estimate ? runGesture(event, {
    record: item.record,
    toRange: (minute) => (minute > item.startMinute && minute !== item.endMinute ? { start: item.startMinute, end: minute } : null),
    toPatch: (range) => timedPatch(item.date, range.start, range.end),
  }) : runGesture(event, {
    record: item.record,
    toRange: (minute) => (minute > item.startMinute ? { start: item.startMinute, end: minute } : null),
    toPatch: (range) => {
      if (range.end === item.endMinute) return null;
      // Midnight is the next day's 00:00, the shape core expects.
      if (range.end >= 1440) {
        const next = new Date(`${item.record.date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        return { endDate: next.toISOString().slice(0, 10), endTime: '00:00' };
      }
      return { endDate: item.record.date, endTime: clock(range.end) };
    },
  }));

  if (!joboLoaded) {
    return (
      <div data-jobo-view className={`h-full flex items-center justify-center gap-2 p-6 ${ctx.textSecondary}`} role={joboError ? 'alert' : 'status'}>
        {joboError ? (
          <>
            <AlertTriangle size={16} />{t('jobo.view.loadError')}
            {reloadJobo && <button type="button" className="underline" onClick={() => reloadJobo()}>{t('jobo.view.retryLoad')}</button>}
          </>
        ) : t('common.loading')}
      </div>
    );
  }

  const status = gestureError
    || (writer.conflict ? t('jobo.view.recordChanged')
      : joboError ? t('jobo.view.storageError')
        : !joboWritable ? t('jobo.view.readOnly')
          : model.invalidRecordCount > 0 ? t('jobo.view.invalidRecords', { count: model.invalidRecordCount }) : '');

  return (
    <div data-jobo-view className={`flex-1 min-h-0 min-w-0 flex flex-col ${ctx.textPrimary}`}>
      {status && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs" role="status"><AlertTriangle size={14} />{status}</div>
      )}
      <div className="flex-1 min-h-0 min-w-0 flex">
      <div ref={scrollRef} className={`flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden ${ctx.darkMode ? 'dark-scrollbar' : ''}`}>
        <div ref={headerRef} className={`${GRID} sticky top-0 z-40 border-b text-sm font-semibold ${ctx.cardBg} ${ctx.borderClass}`}>
          <div className="flex min-w-0">
            <div className={`w-16 flex-shrink-0 border-r ${ctx.borderClass} flex items-center justify-center`}>
              {/* Over the hour gutter: trim to the day's START and END, or
                  show every hour again. Only when the day has a window. */}
              {canTrim && (
                <button
                  type="button"
                  data-jobo-window-toggle
                  onClick={toggleWindowOnly}
                  aria-pressed={windowOnly}
                  className={`p-1 rounded-lg transition-colors ${windowOnly ? 'text-blue-500' : ctx.textSecondary} ${ctx.darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                  title={windowOnly ? t('jobo.view.showAllHours') : t('jobo.view.showWindowOnly', { start: t('strip.markerStart').toLocaleUpperCase(), end: t('strip.markerEnd').toLocaleUpperCase() })}
                  aria-label={windowOnly ? t('jobo.view.showAllHours') : t('jobo.view.showWindowOnly', { start: t('strip.markerStart').toLocaleUpperCase(), end: t('strip.markerEnd').toLocaleUpperCase() })}
                >
                  {windowOnly ? <UnfoldVertical size={16} /> : <FoldVertical size={16} />}
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 px-3 py-1.5 flex items-center">{t('jobo.view.plan')}</div>
          </div>
          <div className={`min-w-0 px-3 py-1 border-l ${ctx.borderClass} flex items-center justify-between gap-2`}>
            <span>{t('jobo.view.do')}</span>
            <div className="flex items-center gap-1.5">
            <button type="button" data-jobo-check-toggle aria-haspopup="dialog" aria-expanded={checkOpen}
              onClick={() => { setStatisticsOpen(false); setCheckOpen(true); }}
              className="h-7 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <ClipboardCheck size={14} /><span className="text-xs font-medium">{t('jobo.check.button')}</span>
            </button>
            <button type="button" data-jobo-statistics-toggle aria-haspopup="dialog" aria-expanded={statisticsOpen}
              onClick={() => { setCheckOpen(false); setStatisticsOpen(true); }}
              className="h-7 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap border border-blue-500 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors">
              <BarChart3 size={14} /><span className="text-xs font-medium">{t('jobo.statistics.button')}</span>
            </button>
            <button
              type="button"
              data-jobo-add
              // The Inbox's New Task button, so adding reads the same everywhere.
              className="h-7 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
              disabled={!joboWritable}
              onClick={() => openAdd(date === nowDate
                ? Math.min(1410, snapMinute(currentTime.getHours() * 60 + currentTime.getMinutes()))
                : 9 * 60)}
            >
              <Plus size={14} strokeWidth={3} /><span className="text-xs font-medium">{t('jobo.view.addDo')}</span>
            </button>
            {wide && !sidebar && notesToggle}
            </div>
          </div>
        </div>
        <div ref={gridRef} className={GRID}>
          {/* `contents` keeps DAY's column the grid cell; the wrapper only
              listens, and scopes the outline rule to the Plan side. */}
          <div
            className="contents"
            data-jobo-pairing
            // Capture: DAY's cards stop their own clicks from bubbling.
            onClickCapture={(event) => {
              const id = event.target.closest?.('[data-task-id]')?.getAttribute('data-task-id');
              if (sidebar && id != null) setSelectedTaskId(id);
            }}
            onMouseOver={(event) => {
              // Always set: a Do card's leave may have just queued null, and a
              // comparison against this render's value would skip the update.
              setHoverTaskId(event.target.closest?.('[data-task-id]')?.getAttribute('data-task-id') ?? null);
            }}
            onMouseLeave={() => setHoverTaskId(null)}
          >
            {hoverTaskId != null && (
              <style>{`[data-jobo-pairing] [data-task-id="${cssEscape(hoverTaskId)}"]{outline:2px solid rgb(59 130 246);outline-offset:1px}`}</style>
            )}
            <DayViewColumn planOnly col={planColumn} colIdx={0} hourHeight={hourHeight} zoom={zoom} />
          </div>
          <DoColumn
            date={date}
            hourHeight={hourHeight}
            zoom={zoom}
            items={doItems}
            ctx={ctx}
            t={t}
            writable={joboWritable}
            pendingIds={writer.pendingIds}
            preview={preview}
            laneRef={doLane}
            onAddAt={openAdd}
            onEdit={openEdit}
            onKeep={keepEstimate}
            onContinue={openContinue}
            hoverTaskId={hoverTaskId}
            onHoverTask={setHoverTaskId}
            startHour={startHour}
            endHour={endHour}
            onDetails={(item, anchor) => {
              setDetails((open) => toggleDetails(open, item, anchor));
              if (sidebar && item.sourceTask) setSelectedTaskId(item.sourceTask.id);
            }}
            onNotesInSidebar={sidebar ? (task) => setSelectedTaskId(task.id) : undefined}
            onPointGesture={onPointGesture}
            onResizeGesture={onResizeGesture}
          />
        </div>
      </div>
      {sidebar && (
        <JoboNotesSidebar date={date} task={selectedTask} onClearTask={() => setSelectedTaskId(null)} t={t} headerAction={notesToggle} headerInset={scrollbarWidth} />
      )}
      </div>
      {refocus.scrolledAway && <RefocusTimelineToast onRefocus={refocus.refocus} isMobile={!!ctx.isMobile} />}
      {liveDetail && (
        <ExecutionDetails
          item={liveDetail}
          anchor={details.anchor}
          onClose={closeDetails}
          onEdit={({ record }) => openEdit(record)}
          ctx={ctx}
          t={t}
          writable={joboWritable}
          pendingIds={writer.pendingIds}
        />
      )}
      {checkOpen && (
        <CheckPanel model={model} date={date} loaded={joboLoaded && Array.isArray(joboRecords)} error={joboError}
          onOpenNotes={canOpenCheckNotes ? openCheckNotes : undefined} formatTime={ctx.formatTime}
          today={nowDate} carry={carry} onUndo={ctx.performUndo}
          onClose={() => setCheckOpen(false)} cardBg={ctx.cardBg} textPrimary={ctx.textPrimary}
          textSecondary={ctx.textSecondary} borderClass={ctx.borderClass} darkMode={ctx.darkMode} />
      )}
      {statisticsOpen && (
        <StatisticsPanel anchorDate={date} weekDates={statisticsWeekDates} evidenceDates={statisticsEvidence}
          buildReport={buildStatisticsReport} loaded={joboLoaded && Array.isArray(joboRecords)} error={joboError}
          onClose={() => setStatisticsOpen(false)} cardBg={ctx.cardBg} textPrimary={ctx.textPrimary}
          textSecondary={ctx.textSecondary} borderClass={ctx.borderClass} darkMode={ctx.darkMode} />
      )}
      {editor && (
        <DoEditor
          {...editor}
          taskCompleted={model.resolveRecordTask(editor.record)?.completed === true}
          onCompleteTask={completeTaskFor(editor.record)}
          linkCandidates={editor.record ? undefined : linkCandidates}
          records={joboRecords || []}
          writable={joboWritable}
          recordJobo={writer.write}
          onClose={closeEditor}
          pendingIds={writer.pendingIds}
          t={t}
          cardBg={ctx.cardBg}
          textPrimary={ctx.textPrimary}
          textSecondary={ctx.textSecondary}
          borderClass={ctx.borderClass}
          darkMode={ctx.darkMode}
        />
      )}
    </div>
  );
}
