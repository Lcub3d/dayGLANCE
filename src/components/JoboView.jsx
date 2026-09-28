import { materializeJobu } from '../jobu/data.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ClipboardCheck, Clock, FileText, GripVertical, History, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { priorityLevel } from '../utils/taskPriority.js';
import { writePomodoroTaskDrag } from '../jobo/pomodoro.js';
import { formatDuration } from '../utils/formatDuration.js';
import { DO_TIMING, validateDoRecord } from '../jobo/core.js';
import { assignOverlapColumns, buildJoboDayModel } from '../jobo/viewModel.js';
import { layoutDoTimeline } from '../jobo/doTimelineLayout.js';
import { getProblemNoteKeys } from '../jobo/checkReview.js';
import { resolveDropTarget, resizeDoInterval, prepareDoDelete, commitDoEdit } from '../jobo/viewActions.js';
import { createManualDo, copyDoRecord, prepareDoEdit, moveDoInterval } from '../jobo/viewActions.js';
import useJoboViewWriter from '../hooks/useJoboViewWriter.js';
import JoboDayStats from './jobo/JoboDayStats.jsx';
import { openNewPlan, createQuickPlan, copyPlan, startPlanDrag, dropPlan, canGroupPlan, movePlanGroup, deletePlanGroup, resizePlan } from '../jobo/nativePlanAdapter.js';
import { CREATION_HOLD_MS, creationGestureMode, creationInterval } from '../jobo/creationGesture.js';
import { clampGroupDelta, marqueeRect, rectanglesIntersect } from '../jobo/selectionGeometry.js';
import { planEdgeSnap } from '../jobo/planEdgeSnap.js';
import PlanCard from './jobo/PlanCard.jsx';
import NotesColumn from './jobo/NotesColumn.jsx';
import ExecutionDetails from './jobo/ExecutionDetails.jsx';
import DoEditor from './jobo/DoEditor.jsx';
import DraftDoCard from './jobo/DraftDoCard.jsx';
import DoTimeMeta from './jobo/DoTimeMeta.jsx';
import DoProgressControl from './jobo/DoProgressControl.jsx';
import DoFocusHistory from './jobo/DoFocusHistory.jsx';
import PriorityTimeline from './jobo/PriorityTimeline.jsx';
import JoboTimeFrames from './jobo/JoboTimeFrames.jsx';
import CarryForward from './jobo/CarryForward.jsx';
import JoboTools from './jobo/JoboTools.jsx';
import './jobo/JoboView.css';
import './TaskPriority.css';

const DEFAULT_SCALE = 84;
const MIN_SCALE = 52;
const MAX_SCALE = 132;
const two = (n) => String(n).padStart(2, '0');
const clockFromMinute = (n) => `${two(Math.floor(((Math.round(n) % 1440) + 1440) % 1440 / 60))}:${two(((Math.round(n) % 60) + 60) % 60)}`;
const snap = (n) => Math.round(n / 5) * 5;
const focusFor = (item) => ({ group: item.groupKey, task: item.noteKey || '' });
const selectionKey = (item, lane) => String(lane === 'plan' ? item.currentTask?.id ?? item.id : item.id);
const withDoNote = (item) => item?.record?.taskId === null ? { ...item, noteKey: `do:${item.record.id}` } : item;

function cardStyle(item, scale, startHour) {
  return { top: `${(item.startMinute - startHour * 60) / 60 * scale}px`,
    height: `${Math.max(40, (item.endMinute - item.startMinute) / 60 * scale - 2)}px`,
    left: `calc(${item.leftPct}% + 3px)`, width: `calc(${item.widthPct}% - 6px)` };
}
function DoActions({ item, t, writable, onNotes, onEdit, onDelete }) {
  const title = item.record.title;
  return <div className="jobo-s5-do-actions jobo-s5-hover-actions">
    <button type="button" className="jobo-s5-card-action jobo-s5-do-notes" disabled={!item.noteKey}
      title={t('task.notes')} aria-label={`${t('task.notes')}: ${title}`} onClick={(event) => { event.stopPropagation(); onNotes(item); }}>
      <FileText size={13} /><svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M0 5H7M4 2L7 5L4 8" /></svg>
    </button>
    <button type="button" className="jobo-s5-card-action" disabled={!writable} title={t('common.edit')} aria-label={`${t('common.edit')}: ${title}`}
      onClick={(event) => { event.stopPropagation(); onEdit({ record: item.record }); }}><Pencil size={13} /></button>
    <button type="button" className="jobo-s5-card-action" disabled={!writable} title={t('common.delete')} aria-label={`${t('common.delete')}: ${title}`}
      onClick={(event) => { event.stopPropagation(); onDelete(item); }}><Trash2 size={13} /></button>
  </div>;
}
function DoCard({ item, scale, startHour, ctx, t, focusLog, writable, onFocus, onSelect, selected, groupSelected, onDetails, onNotes, onEdit, onDelete, onProgress, onDragStart, onDragEnd, onResize }) {
  const { record, task } = item;
  return <article tabIndex={0} aria-label={`${t('jobo.view.do')}: ${record.title}`} className={`jobo-s5-card jobo-s5-do-card task-priority-surface text-white rounded-lg ${selected ? 'jobo-s5-selected' : ''}`}
    data-priority={priorityLevel(task?.priority)} data-pomodoro-task={task?.id} data-pomodoro-do={record.id}
    style={cardStyle(item, scale, startHour)} data-jobo-do-link={item.groupKey} data-jobo-task={item.noteKey || ''} data-jobo-card={record.id} data-jobo-selected={groupSelected || undefined}
    draggable={writable} onDragStart={(event) => onDragStart(event, item, 'do')} onDragEnd={onDragEnd}
    onMouseEnter={() => onFocus(focusFor(item))} onMouseLeave={() => onFocus(null)} onFocus={() => onFocus(focusFor(item))}
    onClick={(event) => onSelect(focusFor(item), event)}
    onKeyDown={(event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onDetails(item, event.currentTarget); } }}
    onDoubleClick={(event) => { if (!event.target.closest('button,select,input')) { if (writable) onEdit({ record }); else onDetails(item, event.currentTarget); } }}>
    <span className="jobo-s5-exact-interval" aria-hidden="true" style={{ height: `${(item.endMinute - item.startMinute) / 60 * scale}px` }} />
    <button type="button" className="jobo-s5-resize jobo-s5-resize-start" disabled={!writable || item.clippedStart}
      aria-label={`${t('jobo.view.resizeStart')}: ${record.title}`} onPointerDown={(event) => onResize(event, item, 'start')}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onResize(event, item, 'start', event.key === 'ArrowUp' ? -5 : 5); } }} />
    <div className="jobo-s5-title-row"><DoProgressControl record={record} t={t} writable={writable} onChange={progress => onProgress(item, progress)} /><span className="jobo-s5-title" title={record.title}>{renderTitleWithoutTags(record.title)}</span>
      <DoFocusHistory record={record} task={task} focusLog={focusLog} formatTime={ctx.formatTime} darkMode={ctx.darkMode} t={t} />
      <DoActions {...{ item, t, writable, onNotes, onEdit, onDelete }} />
    </div>
    <button type="button" className="jobo-s5-do-timing-button" aria-label={`${t('jobo.view.details')}: ${record.title}`}
      onClick={(event) => { event.stopPropagation(); onDetails(item, event.currentTarget); }}><DoTimeMeta item={item} ctx={ctx} t={t} /></button>
    <button type="button" className="jobo-s5-resize jobo-s5-resize-end" disabled={!writable || item.clippedEnd}
      aria-label={`${t('jobo.view.resizeEnd')}: ${record.title}`} onPointerDown={(event) => onResize(event, item, 'end')}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onResize(event, item, 'end', event.key === 'ArrowUp' ? -5 : 5); } }} />
  </article>;
}
function CompletionPointCard({ item, scale, startHour, ctx, t, writable, selected, onFocus, onDetails, onEdit, onProgress }) {
  const { record, marker } = item;
  const description = t('jobu.completionPoint', { time: ctx.formatTime(marker.time) });
  return <article tabIndex={0} aria-label={`${t('jobo.view.do')}: ${record.title}`}
    className={`jobo-s5-card jobo-s5-do-card jobu-completion-point task-priority-surface text-white rounded-lg ${selected ? 'jobo-s5-selected' : ''}`}
    data-priority={priorityLevel(item.task?.priority)} data-pomodoro-task={item.task?.id} data-pomodoro-do={record.id}
    data-jobo-point={item.id} data-jobo-do-link={item.groupKey} data-jobo-task={item.noteKey || ''}
    style={{ top: `${(item.displayStartMinute - startHour * 60) / 60 * scale}px`, height: `${item.displayHeightPx}px`,
      left: `calc(${item.leftPct}% + 3px)`, width: `calc(${item.widthPct}% - 6px)`,
      '--jobo-point-offset': `${(marker.startMinute - item.displayStartMinute) / 60 * scale}px` }}
    onMouseEnter={() => onFocus(focusFor(item))} onMouseLeave={() => onFocus(null)} onFocus={() => onFocus(focusFor(item))}
    onKeyDown={event => {
      if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); onDetails(item, event.currentTarget);
      }
    }}
    onDoubleClick={event => {
      if (!event.target.closest('button,select,input')) {
        event.stopPropagation();
        if (writable) onEdit({ record }); else onDetails(item, event.currentTarget);
      }
    }}>
    <span className="jobu-point-dot" aria-hidden="true" />
    <div className="jobo-s5-title-row">
      <DoProgressControl record={record} t={t} writable={writable} onChange={progress => onProgress(item, progress)} />
      <button type="button" className="jobo-s5-title jobu-point-title" title={record.title}
        aria-label={`${t('jobo.view.details')}: ${record.title}`} onClick={event => onDetails(item, event.currentTarget)}>{renderTitleWithoutTags(record.title)}</button>
      <button type="button" className="jobo-s5-card-action" disabled={!writable}
        title={t('common.edit')} aria-label={`${t('common.edit')}: ${record.title}`}
        onClick={event => { event.stopPropagation(); onEdit({ record }); }}><Pencil size={13} /></button>
    </div>
    <button type="button" className="jobo-s5-do-timing-button jobu-point-time" title={description} aria-label={description}
      onClick={event => onDetails(item, event.currentTarget)}>
      <time>{ctx.formatTime(marker.time)}</time><span> · {t('jobo.view.untimed')}</span>
    </button>
  </article>;
}
function Connections({ rootRef, focus, dep }) {
  const [paths, setPaths] = useState([]);
  useLayoutEffect(() => {
    let raf;
    const update = () => {
      const root = rootRef.current;
      if (!root || !focus) { setPaths([]); return; }
      const box = root.getBoundingClientRect();
      const plans = [...root.querySelectorAll('[data-jobo-plan-link]')];
      const dos = [...root.querySelectorAll('[data-jobo-do-link]')];
      const note = [...root.querySelectorAll('[data-jobo-note-link]')].find((el) => el.dataset.joboNoteLink === focus.task && el.getClientRects().length > 0);
      const out = [];
      const connect = (from, to) => {
        if (!from || !to) return;
        const a = from.getBoundingClientRect(); const b = to.getBoundingClientRect();
        const x1 = a.right - box.left; const y1 = a.top + Math.min(a.height / 2, 22) - box.top;
        const x2 = b.left - box.left; const y2 = b.top + Math.min(b.height / 2, 22) - box.top;
        out.push({ d: `M${x1},${y1} C${x1 + 25},${y1} ${x2 - 25},${y2} ${x2},${y2}`, color: getComputedStyle(from).backgroundColor });
      };
      if (focus.group) {
        const plan = plans.find((el) => el.dataset.joboPlanLink === focus.group);
        const linked = dos.filter((el) => el.dataset.joboDoLink === focus.group);
        for (const item of linked) { connect(plan, item); connect(item, note); }
        if (!linked.length) connect(plan, note);
        if (!plan) {
          const ordered = linked.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          for (let i = 1; i < ordered.length; i++) connect(ordered[i - 1], ordered[i]);
        }
      } else if (focus.task) {
        const linkedPlans = plans.filter((el) => el.dataset.joboTask === focus.task);
        const linkedDos = dos.filter((el) => el.dataset.joboTask === focus.task);
        for (const item of linkedDos) {
          connect(linkedPlans.find((el) => el.dataset.joboPlanLink === item.dataset.joboDoLink), item);
          connect(item, note);
        }
        for (const plan of linkedPlans) {
          if (!linkedDos.some((el) => el.dataset.joboDoLink === plan.dataset.joboPlanLink)) connect(plan, note);
        }
      }
      setPaths(out);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (rootRef.current) {
      observer.observe(rootRef.current);
      rootRef.current.querySelectorAll('[data-jobo-note-link]').forEach(el => observer.observe(el));
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [rootRef, focus, dep]);
  return <svg className="jobo-s5-connections" aria-hidden="true">{paths.map((path, index) => <path key={index} d={path.d} fill="none" stroke={path.color} strokeWidth="1.4" opacity=".65" />)}</svg>;
}

export default function JoboView({ headerControlsTarget }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { jobuData, jobuRecords, jobuLoaded, jobuWritable, joboRecords, joboLoaded, joboWritable, joboError, reloadJobo, recordJobo: ledgerWriter, getFrameInstancesForDate, focusLog } = useFeaturesCtx();
  const { write: recordJobo, pendingIds: joboPendingIds, conflict } = useJoboViewWriter({ records: joboRecords, recordJobo: ledgerWriter });
  const { selectedDate, tasks, unscheduledTasks, recurringTasks, expandedRecurringTasks, getTasksForDate, currentTime, darkMode, cardBg, borderClass, textPrimary, textSecondary } = ctx;
  const [editor, setEditor] = useState(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [fullDay, setFullDay] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [planRatio, setPlanRatio] = useState(.5);
  const [resizingColumns, setResizingColumns] = useState(false);
  const [focus, setFocus] = useState(null);
  const [selection, setSelection] = useState(null);
  const [selectedCards, setSelectedCards] = useState({ lane: null, ids: [] });
  const [marquee, setMarquee] = useState(null);
  const [groupPreview, setGroupPreview] = useState(null);
  const [trashOver, setTrashOver] = useState(false);
  const [details, setDetails] = useState(null);
  const [notesRequest, setNotesRequest] = useState(null);
  const [noteVisibility, setNoteVisibility] = useState({});
  const [checkEnabled, setCheckEnabled] = useState(false);
  const [checkDismissed, setCheckDismissed] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [preview, setPreview] = useState(null);
  const [gestureStartHour, setGestureStartHour] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [creation, setCreation] = useState(null);
  const [draftDos, setDraftDos] = useState([]);
  const [pendingPlanEdit, setPendingPlanEdit] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const rootRef = useRef(null);
  const boardRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const gestureCleanup = useRef(null);
  const columnResizeRef = useRef(null);
  const suppressClickUntil = useRef(0);
  const busyRef = useRef(false);
  const recordsRef = useRef(joboRecords);
  recordsRef.current = joboRecords;
  const writable = joboLoaded && joboWritable && !pending;
  const date = dateToString(selectedDate);
  const clock = currentTime instanceof Date ? currentTime : new Date();
  const today = dateToString(clock);
  const nowTime = `${two(clock.getHours())}:${two(clock.getMinutes())}`;
  const dayTasks = useMemo(() => getTasksForDate(selectedDate, false).filter((task) => !task.isAllDay && task.startTime), [getTasksForDate, selectedDate]);
  const lookupTasks = useMemo(() => [...tasks, ...unscheduledTasks, ...(expandedRecurringTasks || []), ...dayTasks], [tasks, unscheduledTasks, expandedRecurringTasks, dayTasks]);
  const displayRecords = useMemo(() => preview ? (joboRecords || []).map((r) => r.id === preview.id ? preview : r) : joboRecords, [joboRecords, preview]);
  const model = useMemo(() => buildJoboDayModel({ date, tasks: dayTasks, taskLookup: lookupTasks, recurringTasks, records: displayRecords || [], scale, isVisibleForUser: ctx.isVisibleForUser, now: { date: today, time: nowTime } }), [date, dayTasks, lookupTasks, recurringTasks, displayRecords, today, nowTime, scale, ctx.isVisibleForUser]);
  const collapsibleHistory = model.plans.filter(item => item.historical);
  const visiblePlans = assignOverlapColumns(model.plans.filter(item => showHistory || !item.historical), { scale });
  const timedDos = model.timedRecords.map(withDoNote);
  const untimedDos = model.untimedRecords.map(withDoNote);
  const doLayout = layoutDoTimeline([...timedDos, ...draftDos.filter(draft => draft.date === date && !(joboRecords || []).some(record => record.id === draft.id)).map(draft => ({ ...draft, draft }))], untimedDos, { date, scale });
  const doItems = doLayout.filter(item => !item.point);
  const completionPoints = doLayout.filter(item => item.point);
  const selectedItems = (selectedCards.lane === 'plan' ? visiblePlans : doItems).filter(item => selectedCards.ids.includes(selectionKey(item, selectedCards.lane)));
  const canSelectCard = (item, lane) => lane === 'plan' ? canGroupPlan(item)
    : writable && !joboPendingIds.includes(item.id) && !item.draft?.accepted;
  const isGroupSelected = (item, lane) => selectedCards.lane === lane && selectedCards.ids.includes(selectionKey(item, lane));
  const selectCard = (item, lane, nextFocus, event) => {
    if (performance.now() < suppressClickUntil.current) return;
    setSelection(nextFocus);
    if (!canSelectCard(item, lane)) { setSelectedCards({ lane: null, ids: [] }); return; }
    const additive = event?.shiftKey || event?.ctrlKey || event?.metaKey;
    const key = selectionKey(item, lane);
    setSelectedCards(previous => {
      const ids = previous.lane === lane ? previous.ids : [];
      if (additive) return { lane, ids: ids.includes(key) ? ids.filter(id => id !== key) : [...ids, key] };
      return ids.includes(key) ? previous : { lane, ids: [key] };
    });
  };
  const independentDoMap = new Map([...timedDos, ...untimedDos].filter(item => item.record.taskId === null).map(item => [item.id, item]));
  for (const record of joboRecords || []) {
    if (validateDoRecord(record).ok && record.taskId === null && noteVisibility[`do:${record.id}`] && !independentDoMap.has(record.id)) {
      independentDoMap.set(record.id, withDoNote({ id: record.id, record }));
    }
  }
  // Free-text Do notes have a separate immutable revision history. An older
  // opaque note remains readable until its first explicit save; no migration
  // invents an edit to the original execution record.
  const noteHeads = materializeJobu(jobuRecords || []);
  const independentDos = [...independentDoMap.values()].map(item => {
    const head = noteHeads.get(`doNote:${item.record.id}`);
    return { ...item, record: { ...item.record,
      notes: head ? (head.deleted ? '' : head.value.text) : item.record.notes,
      _noteHead: head?.id ?? null } };
  });
  const isDoNoteVisible = item => noteVisibility[item.noteKey] ?? !!item.record.notes;
  const noteTasks = [...dayTasks, ...model.plans.map(item => item.sourceTask || item.currentTask || (item.noteKey ? item.task : null)), ...model.timedRecords.map(item => item.task), ...model.untimedRecords.map(item => item.task)].filter(Boolean);
  const checkNoteKeys = getProblemNoteKeys(model);
  const isTaskNoteVisible = (task) => {
    if (!task) return false;
    const key = String(task.id);
    // Review contributes a separate set; switching it off never clears a
    // manually opened (or edited) note, even when both sets contain it.
    return (noteVisibility[key] ?? !!task.notes)
      || (checkEnabled && checkNoteKeys.has(key) && !checkDismissed[`${date}:${key}`]);
  };
  const noteTaskFor = (item) => noteTasks.find(task => String(task.id) === item.noteKey);
  const activeFocus = dragging ? null : focus || selection;
  const frameStarts = (getFrameInstancesForDate?.(selectedDate) || []).map(frame => Number(frame.start.slice(0, 2)) * 60 + Number(frame.start.slice(3, 5))).filter(Number.isFinite);
  const firstMinute = Math.min(480, ...frameStarts, ...visiblePlans.map((x) => x.startMinute), ...model.timedRecords.map((x) => x.startMinute), ...completionPoints.map(x => x.displayStartMinute));
  const startHour = gestureStartHour ?? (fullDay ? 0 : Math.max(0, Math.floor(firstMinute / 60)));
  const hours = Array.from({ length: 24 - startHour }, (_, i) => i + startHour);
  const height = hours.length * scale + 40;
  const nowMinute = date === today ? clock.getHours() * 60 + clock.getMinutes() : null;
  const defaultMinute = date === today ? Math.min(1410, snap(clock.getHours() * 60 + clock.getMinutes())) : 540;
  const openDo = (startMinute = defaultMinute) => setEditor({ initial: { date, startMinute, duration: 30 } });
  const closeDetails = useCallback(() => setDetails(null), []);
  const openDetails = (item, anchor) => { setSelection(focusFor(item)); setDetails({ item, anchor }); };
  const openNotes = (item) => {
    if (!item.noteKey) return;
    ctx.setExpandedNotesTaskId(null);
    setNoteVisibility(previous => ({ ...previous, [item.noteKey]: true }));
    setShowNotes(true); setSelection(focusFor(item)); setNotesRequest({ key: item.noteKey, token: Date.now() });
  };
  const showTaskNote = task => setNoteVisibility(previous => previous[String(task.id)] === true ? previous : { ...previous, [String(task.id)]: true });
  const hideTaskNote = task => {
    const key = String(task.id);
    setNoteVisibility(previous => ({ ...previous, [key]: false }));
    setCheckDismissed(previous => ({ ...previous, [`${date}:${key}`]: true }));
    setNotesRequest(null);
  };
  const toggleCheck = () => {
    if (!checkEnabled) { setCheckDismissed({}); setShowNotes(true); }
    setCheckEnabled(value => !value);
  };
  const focusNote = (next) => {
    setFocus(next);
    // Keep a mounted independent-note draft if a remote tombstone arrives.
    // Notes shown from existing content need this too, before the first save.
    if (next?.task?.startsWith('do:')) {
      setNoteVisibility(previous => previous[next.task] === true ? previous : { ...previous, [next.task]: true });
    }
  };
  const togglePlanNotes = (item) => {
    if (!item.noteKey) return;
    ctx.setExpandedTaskMenu(null);
    if (!showNotes && item.currentTask) {
      ctx.setExpandedNotesTaskId(previous => previous === item.currentTask.id ? null : item.currentTask.id);
      return;
    }
    const visible = !isTaskNoteVisible(noteTaskFor(item));
    ctx.setExpandedNotesTaskId(null);
    setNoteVisibility(previous => ({ ...previous, [item.noteKey]: visible }));
    if (!visible) setCheckDismissed(previous => ({ ...previous, [`${date}:${item.noteKey}`]: true }));
    setSelection(focusFor(item));
    setNotesRequest(visible ? { key: item.noteKey, token: Date.now() } : null);
  };
  const toggleNotesColumn = () => {
    ctx.setExpandedNotesTaskId(null);
    setNotesRequest(null);
    setShowNotes(value => !value);
  };
  const liveDetails = details && (model.plans.find(item => item.id === details.item.id)
    || [...timedDos, ...untimedDos].find(item => item.id === details.item.id));

  const runWrite = async (build) => {
    if (!joboWritable || !joboLoaded || busyRef.current) return;
    busyRef.current = true; setPending(true); setError('');
    try { const next = build(); if (!next) { setError(t('jobo.view.recordChanged')); return null; } if (joboPendingIds.includes(next.id)) return null; const result = await commitDoEdit(recordJobo, next); return { record: next, result }; }
    catch (err) { setError(t(err.code === 'readOnly' ? 'jobo.view.readOnly' : err.code === 'notLoaded' ? 'jobo.view.loadError' : 'jobo.view.updateFailed')); }
    finally { busyRef.current = false; setPending(false); }
  };
  const deleteDo = (item) => runWrite(() => prepareDoDelete({ records: recordsRef.current, record: item.record, now: Date.now() }));
  const changeProgress = (item, progress) => {
    if (item.record.progress === progress) return;
    return runWrite(() => prepareDoEdit({ records: recordsRef.current, record: item.record, patch: {}, progress, now: Date.now() }));
  };
  const saveDoNote = async (record, text) => {
    if (!jobuLoaded || !jobuWritable) throw Object.assign(new Error('readOnly'), { code: 'readOnly' });
    const current = recordsRef.current?.find(row => row.id === record.id);
    if (!current || current.deleted) throw Object.assign(new Error('recordChanged'), { code: 'recordChanged' });
    setNoteVisibility(previous => ({ ...previous, [`do:${record.id}`]: true }));
    try {
      await jobuData.save(`doNote:${record.id}`, 'doNote', { recordId: record.id, text }, { expectedHead: record._noteHead ?? null });
      return { ok: true };
    } catch (err) { throw Object.assign(err, { code: err.message === 'conflict' ? 'recordChanged' : 'storageWrite' }); }
  };
  const endDrag = () => { dragRef.current = null; setDragging(false); setGroupPreview(null); setTrashOver(false); setGestureStartHour(null); ctx.handleDragEnd?.(); };
  const snapPlanEdge = (item, { startTime, duration }) => {
    try {
      if (!resizePlan(ctx, item, { startTime, duration })) throw new Error('recordChanged');
      setError('');
    } catch { setError(t('jobo.view.recordChanged')); }
  };
  const applyGroupAction = async (items, lane, { delta = 0, remove = false } = {}) => {
    if (!items.length || busyRef.current) return false;
    setError('');
    if (lane === 'plan') {
      try {
        const result = remove ? deletePlanGroup(ctx, items) : movePlanGroup(ctx, items, delta);
        if (!result || result.ok === false) throw new Error('recordChanged');
        if (remove) setSelectedCards({ lane: null, ids: [] });
        return true;
      } catch { setError(t('jobo.view.recordChanged')); return false; }
    }
    if (!writable || items.some(item => joboPendingIds.includes(item.id))) return false;
    busyRef.current = true; setPending(true);
    try {
      const now = Date.now();
      const next = items.filter(item => !item.draft).map(item => remove
        ? prepareDoDelete({ records: recordsRef.current, record: item.record, now })
        : prepareDoEdit({ records: recordsRef.current, record: item.record, patch: moveDoInterval(item.record, delta), now }));
      if (next.some(record => !record)) throw new Error('recordChanged');
      if (next.length) {
        const result = await recordJobo(next);
        if (!result?.ok && !result?.held) throw new Error(result?.error || 'storageWrite');
      }
      const draftIds = new Set(items.filter(item => item.draft).map(item => item.id));
      setDraftDos(previous => remove ? previous.filter(draft => !draftIds.has(draft.id))
        : previous.map(draft => draftIds.has(draft.id) ? { ...draft, startMinute: draft.startMinute + delta, endMinute: draft.endMinute + delta } : draft));
      if (remove) setSelectedCards({ lane: null, ids: [] });
      return true;
    } catch (err) {
      setError(t(err.message === 'recordChanged' ? 'jobo.view.recordChanged' : 'jobo.view.updateFailed'));
      return false;
    } finally { busyRef.current = false; setPending(false); }
  };
  const beginDrag = (event, item, type) => {
    if (event.target.closest('button,select,input,textarea,.notes-panel-container input') || (type !== 'plan' && (!writable || joboPendingIds.includes(item.id)))) { event.preventDefault(); return; }
    const lane = type === 'plan' ? 'plan' : 'do';
    const group = isGroupSelected(item, lane) && selectedItems.length > 1 ? selectedItems : null;
    if (group?.some(candidate => !canSelectCard(candidate, lane))) { event.preventDefault(); return; }
    if (!group && type === 'plan' && !startPlanDrag(ctx, item, event)) { event.preventDefault(); return; }
    if (!isGroupSelected(item, lane)) setSelectedCards(canSelectCard(item, lane) ? { lane, ids: [selectionKey(item, lane)] } : { lane: null, ids: [] });
    const offset = item.startMinute == null ? 0 : Math.max(0, (event.clientY - event.currentTarget.getBoundingClientRect().top) / scale * 60);
    dragRef.current = { item, type, offset, copy: event.ctrlKey, group, lane };
    setGestureStartHour(startHour);
    setDragging(true);
    suppressClickUntil.current = performance.now() + 300;
    event.dataTransfer.setData('application/x-jobo-view', type);
    if (!group && type !== 'draft') writePomodoroTaskDrag(event, item.currentTask || item.task, item.record);
    event.dataTransfer.effectAllowed = group ? 'move' : 'copyMove';
  };
  const minuteAt = (event) => Math.max(0, Math.min(1435, snap(startHour * 60 + (event.clientY - event.currentTarget.getBoundingClientRect().top) / scale * 60 - (dragRef.current?.offset || 0))));
  const inboxPayload = () => ctx.dragSource === 'inbox' && ctx.draggedTask ? {
    type: 'plan', item: { task: ctx.draggedTask, currentTask: ctx.draggedTask, plan: null },
  } : null;
  const dragOver = (event, lane) => {
    const payload = dragRef.current || inboxPayload();
    if (payload?.group || payload?.type === 'draft') {
      if (lane !== payload.lane) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
      const items = payload.group || [payload.item];
      setGroupPreview({ lane, items, delta: clampGroupDelta(items, minuteAt(event) - payload.item.startMinute) });
      const box = scrollRef.current.getBoundingClientRect();
      if (event.clientY > box.bottom - 45) scrollRef.current.scrollTop += 12;
      if (event.clientY < box.top + 70) scrollRef.current.scrollTop -= 12;
      return;
    }
    if (!payload || (lane === 'plan' && payload.type !== 'plan') || (lane === 'do' && !writable)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = event.ctrlKey || payload.copy || (lane === 'do' && payload.type === 'plan') ? 'copy' : 'move';
    const target = resolveDropTarget({ ...payload, lane, date, minute: minuteAt(event) });
    if (!target) return;
    if (!dragRef.current) setGroupPreview({ lane, delta: 0, items: [{ id: 'inbox-preview', startMinute: target.minute, endMinute: target.minute + target.duration, leftPct: 0, widthPct: 100 }] });
    const box = scrollRef.current.getBoundingClientRect();
    if (event.clientY > box.bottom - 45) scrollRef.current.scrollTop += 12;
    if (event.clientY < box.top + 70) scrollRef.current.scrollTop -= 12;
  };
  const dragEnter = (event, lane) => {
    if ((dragRef.current || inboxPayload()) && (lane === 'plan' || writable)) event.preventDefault();
  };
  const drop = (event, lane) => {
    const payload = dragRef.current || inboxPayload();
    if (payload?.group || payload?.type === 'draft') {
      if (lane !== payload.lane) return;
      event.preventDefault(); event.stopPropagation();
      const items = payload.group || [payload.item];
      const delta = clampGroupDelta(items, minuteAt(event) - payload.item.startMinute);
      if (delta) applyGroupAction(items, lane, { delta });
      endDrag();
      return;
    }
    if (!payload || (lane === 'plan' && payload.type !== 'plan') || (lane === 'do' && !writable)) return;
    event.preventDefault(); event.stopPropagation();
    const target = resolveDropTarget({ ...payload, lane, date, minute: minuteAt(event) });
    if (!target) { endDrag(); return; }
    const { minute, interval } = target;
    const copying = event.ctrlKey || payload.copy;
    if (lane === 'plan') {
      if (copying && dragRef.current) {
        try { copyPlan(ctx, payload.item, { date, startTime: clockFromMinute(minute), duration: target.duration }); }
        catch { setError(t('jobo.view.updateFailed')); }
      } else dropPlan(ctx, event, selectedDate, clockFromMinute(minute));
    }
    else if (payload.type === 'plan') {
      const { plan } = payload.item;
      const task = payload.item.currentTask || payload.item.task;
      runWrite(() => createManualDo({ id: `manual:${crypto.randomUUID()}`, title: task.title, task, planSnapshot: plan, date, startMinute: minute, duration: target.duration, now: Date.now() }));
    } else if (copying) {
      runWrite(() => copyDoRecord({ records: recordsRef.current, record: payload.item.record, id: `manual:${crypto.randomUUID()}`, patch: interval, now: Date.now() }));
    } else if (payload.item.record.timing === DO_TIMING.UNTIMED) {
      setEditor({ record: payload.item.record, initial: { patch: interval } });
    } else {
      const record = payload.item.record;
      runWrite(() => prepareDoEdit({ records: recordsRef.current, record, patch: interval, now: Date.now() }));
    }
    endDrag();
  };
  const dropInTrash = (event) => {
    const payload = dragRef.current;
    if (!payload) return;
    event.preventDefault(); event.stopPropagation();
    const items = payload.group || [payload.item];
    if (payload.type === 'plan' && !payload.group && !canGroupPlan(payload.item)) {
      const task = payload.item.currentTask;
      if (task && !task.imported) ctx.moveToRecycleBin?.(task.id, false);
    } else applyGroupAction(items, payload.lane, { remove: true });
    endDrag();
  };
  const dragOverTrash = (event) => {
    if (!dragRef.current) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move'; setTrashOver(true);
  };
  const beginResize = (event, item, edge, keyboardDelta) => {
    if (!writable || joboPendingIds.includes(item.id)) return;
    event.preventDefault(); event.stopPropagation();
    const record = item.record;
    if (keyboardDelta != null) {
      runWrite(() => prepareDoEdit({ records: recordsRef.current, record, patch: resizeDoInterval(record, edge, keyboardDelta), now: Date.now() })); return;
    }
    gestureCleanup.current?.();
    setGestureStartHour(startHour);
    const y = event.clientY; const scroll = scrollRef.current.scrollTop;
    let patch = null;
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key);
      gestureCleanup.current = null; setPreview(null); setGestureStartHour(null);
    };
    const move = (next) => {
      const delta = snap((next.clientY - y + scrollRef.current.scrollTop - scroll) / scale * 60);
      try { patch = resizeDoInterval(record, edge, delta); setPreview({ ...record, ...patch }); }
      catch { patch = null; setError(t('jobo.view.completeInterval')); cleanup(); }
    };
    const up = () => { cleanup(); if (patch) runWrite(() => prepareDoEdit({ records: recordsRef.current, record, patch, now: Date.now() })); };
    const cancel = () => cleanup();
    const key = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    gestureCleanup.current = cleanup;
  };
  const commitDraftDo = async (draft, title, { task = null, planSnapshot = null } = {}) => {
    const accepted = await runWrite(() => createManualDo({ id: draft.id, title, task, planSnapshot, date: draft.date, startMinute: draft.startMinute, duration: draft.duration, now: Date.now() }));
    if (accepted) setDraftDos(previous => previous.map(item => item.id === draft.id ? { ...item, title, accepted: true } : item));
    return !!accepted;
  };
  const linkDraftPlan = async (draft) => {
    const payload = dragRef.current;
    endDrag();
    if (payload?.type !== 'plan' || !writable || draft.accepted || recordsRef.current?.some(record => record.id === draft.id)) return false;
    const task = payload.item.currentTask;
    if (!task) return false;
    return commitDraftDo(draft, task.title, { task, planSnapshot: payload.item.plan });
  };
  const dragOverNotes = (event) => {
    const item = dragRef.current?.item;
    if (!item?.noteKey) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
  };
  const dropOnNotes = (event) => {
    const item = dragRef.current?.item;
    if (!item?.noteKey) return;
    event.preventDefault(); event.stopPropagation();
    endDrag(); openNotes(item);
  };
  const finishCreation = (lane, interval) => {
    setSelectedCards({ lane: null, ids: [] });
    if (lane === 'do') {
      setDraftDos(previous => [...previous, { id: `manual:${crypto.randomUUID()}`, date, ...interval, title: '' }]);
    } else {
      try {
        const task = createQuickPlan(ctx, { date, startTime: clockFromMinute(interval.startMinute), duration: interval.duration, title: '' });
        if (task?.id) setPendingPlanEdit(task.id);
        else setError(t('jobo.view.updateFailed'));
      } catch { setError(t('jobo.view.updateFailed')); }
    }
  };
  const beginCreation = (event, lane) => {
    if (event.button !== 0 || event.isPrimary === false || event.target.closest('[data-jobo-card],[data-jobo-point],button,input,textarea,select,[role="dialog"]') || busyRef.current || (lane === 'do' && !writable)) return;
    event.preventDefault();
    gestureCleanup.current?.();
    const laneElement = event.currentTarget;
    const initialX = event.clientX, initialY = event.clientY;
    const initialBox = laneElement.getBoundingClientRect();
    const origin = { x: initialX - initialBox.left, y: initialY - initialBox.top };
    const previousSelection = selectedCards;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const initialIds = additive && selectedCards.lane === lane ? selectedCards.ids : [];
    const candidates = (lane === 'plan' ? visiblePlans : doItems).filter(item => canSelectCard(item, lane));
    const startedAt = performance.now();
    const minute = (pointer) => startHour * 60 + (pointer.clientY - laneElement.getBoundingClientRect().top) / scale * 60;
    const anchor = minute(event);
    let interval = creationInterval(anchor, anchor, false);
    let lastPointer = { clientX: initialX, clientY: initialY };
    let maxDistance = 0;
    let mode = 'pending';
    setSelection(null);
    if (!additive) setSelectedCards({ lane: null, ids: [] });
    setGestureStartHour(startHour);
    const cleanup = () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);
      setCreation(null); setMarquee(null); setGestureStartHour(null); gestureCleanup.current = null;
    };
    const update = () => {
      mode = creationGestureMode({ distance: maxDistance, elapsed: additive ? 0 : performance.now() - startedAt, previousMode: mode });
      if (mode === 'select') {
        const box = laneElement.getBoundingClientRect();
        const rect = marqueeRect(origin, {
          x: Math.max(0, Math.min(box.width, lastPointer.clientX - box.left)),
          y: Math.max(0, Math.min(box.height, lastPointer.clientY - box.top)),
        });
        const clientRect = { left: rect.left + box.left, right: rect.right + box.left, top: rect.top + box.top, bottom: rect.bottom + box.top };
        const allowed = new Map(candidates.map(item => [String(item.id), selectionKey(item, lane)]));
        const hits = [...laneElement.querySelectorAll('[data-jobo-card]')]
          .filter(element => allowed.has(element.dataset.joboCard) && rectanglesIntersect(clientRect, element.getBoundingClientRect()))
          .map(element => allowed.get(element.dataset.joboCard));
        setSelectedCards({ lane, ids: [...new Set([...initialIds, ...hits])] });
        setMarquee({ lane, ...rect });
        setCreation(null);
      } else if (mode === 'range' || mode === 'armed') {
        interval = creationInterval(anchor, minute(lastPointer), true);
        setCreation({ lane, ...interval });
      }
    };
    const holdTimer = window.setTimeout(update, CREATION_HOLD_MS);
    const move = (pointer) => {
      if (pointer.pointerId !== event.pointerId) return;
      pointer.preventDefault();
      lastPointer = pointer;
      maxDistance = Math.max(maxDistance, Math.hypot(pointer.clientX - initialX, pointer.clientY - initialY));
      const scrollBox = scrollRef.current.getBoundingClientRect();
      if (pointer.clientY > scrollBox.bottom - 24) scrollRef.current.scrollTop += 12;
      if (pointer.clientY < scrollBox.top + 32) scrollRef.current.scrollTop -= 12;
      update();
    };
    const up = (pointer) => {
      if (pointer.pointerId !== event.pointerId) return;
      lastPointer = pointer;
      maxDistance = Math.max(maxDistance, Math.hypot(pointer.clientX - initialX, pointer.clientY - initialY));
      update();
      cleanup();
      if (mode === 'select' || mode === 'range') suppressClickUntil.current = performance.now() + 300;
      if (mode === 'range') finishCreation(lane, interval);
    };
    const cancel = () => { cleanup(); setSelectedCards(previousSelection); };
    const key = (pressed) => { if (pressed.key === 'Escape') { pressed.preventDefault(); cancel(); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key); window.addEventListener('blur', cancel);
    gestureCleanup.current = cleanup;
  };
  const doubleClickCreate = (event, lane) => {
    if (event.button !== 0 || performance.now() < suppressClickUntil.current
      || event.target.closest('[data-jobo-card],[data-jobo-point],button,input,textarea,select,[role="dialog"]')
      || busyRef.current || (lane === 'do' && !writable)) return;
    event.preventDefault(); event.stopPropagation(); gestureCleanup.current?.();
    const minute = startHour * 60 + (event.clientY - event.currentTarget.getBoundingClientRect().top) / scale * 60;
    finishCreation(lane, creationInterval(minute, minute, false));
  };
  const columnResizeProps = {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const planWidth = rootRef.current.querySelector('[data-jobo-lane="plan"]').getBoundingClientRect().width;
      const doWidth = rootRef.current.querySelector('[data-jobo-lane="do"]').getBoundingClientRect().width;
      columnResizeRef.current = { pointerId: event.pointerId, x: event.clientX, planWidth, width: planWidth + doWidth, ratio: planRatio };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
      setResizingColumns(true);
    },
    onPointerMove: (event) => {
      const resize = columnResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const width = Math.max(160, Math.min(resize.width - 160, resize.planWidth + event.clientX - resize.x));
      setPlanRatio(Math.max(.15, Math.min(.85, width / resize.width)));
    },
    onPointerUp: (event) => {
      if (!columnResizeRef.current) return;
      columnResizeRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setResizingColumns(false);
    },
    onPointerCancel: () => {
      if (columnResizeRef.current) setPlanRatio(columnResizeRef.current.ratio);
      columnResizeRef.current = null;
      setResizingColumns(false);
    },
    onLostPointerCapture: () => { columnResizeRef.current = null; setResizingColumns(false); },
    onDoubleClick: () => setPlanRatio(.5),
    onKeyDown: (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') {
        const resize = columnResizeRef.current;
        if (resize) {
          setPlanRatio(resize.ratio); columnResizeRef.current = null;
          event.currentTarget.releasePointerCapture(resize.pointerId); setResizingColumns(false);
        }
      } else if (event.key === 'Home') setPlanRatio(.5);
      else setPlanRatio((ratio) => Math.max(.15, Math.min(.85, ratio + (event.key === 'ArrowLeft' ? -.025 : .025))));
    },
  };
  useEffect(() => () => gestureCleanup.current?.(), []);
  useEffect(() => { if (!ctx.draggedTask && !dragRef.current) setGroupPreview(null); }, [ctx.draggedTask]);
  useEffect(() => {
    setDraftDos(previous => previous.filter(draft => !(joboRecords || []).some(record => record.id === draft.id)));
  }, [joboRecords]);
  useEffect(() => {
    if (!pendingPlanEdit) return;
    const task = dayTasks.find(item => item.id === pendingPlanEdit);
    if (task) { ctx.startEditingTask?.(task, false); ctx.setEditingTaskText?.(''); setPendingPlanEdit(null); }
  }, [pendingPlanEdit, dayTasks, ctx]);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const wheel = (event) => { if (!event.ctrlKey) return; event.preventDefault(); setScale((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value + (event.deltaY < 0 ? 4 : -4)))); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [joboLoaded]);
  useEffect(() => { gestureCleanup.current?.(); setEditor(null); setDetails(null); setFocus(null); setSelection(null); setSelectedCards({ lane: null, ids: [] }); setGroupPreview(null); setTrashOver(false); setNotesRequest(null); setNoteVisibility({}); setShowHistory(false); setDragging(false); setPendingPlanEdit(null); dragRef.current = null; }, [date]);

  const dailyStats = <JoboDayStats date={date} tasks={dayTasks} records={joboRecords} loaded={joboLoaded}
    taskLookup={lookupTasks} recurringTasks={recurringTasks} isVisibleForUser={ctx.isVisibleForUser} ctx={ctx} />;
  if (!joboLoaded) return <>{headerControlsTarget ? createPortal(dailyStats, headerControlsTarget) : dailyStats}<div data-jobo-view className={`h-full flex flex-col gap-3 items-center justify-center p-8 ${textSecondary}`} role="status">{joboError ? t('jobo.view.loadError') : t('common.loading')}{joboError && <button type="button" onClick={() => reloadJobo?.()}>{t('jobo.view.retryLoad')}</button>}</div></>;

  const rows = () => hours.map((hour, index) => <div key={hour} className={`jobo-s5-hour border-b ${borderClass} ${index % 2 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`} style={{ height: `${scale}px` }}><div className={`jobo-s5-half border-b border-dashed ${borderClass}`} /></div>);
  const creationPreview = (lane) => creation?.lane === lane && <div className="jobo-s5-card jobo-s5-create-preview task-priority-surface text-white rounded-lg shadow-md" data-priority="p4"
    style={cardStyle({ ...creation, leftPct: 0, widthPct: 100 }, scale, startHour)} aria-hidden="true">
    <div className="jobo-s5-title-row">{t(lane === 'plan' ? 'jobo.view.untitledPlan' : 'jobo.view.draftDoTitle')}</div>
    <div className="jobo-s5-meta-row">{ctx.formatTime(clockFromMinute(creation.startMinute))}–{ctx.formatTime(clockFromMinute(creation.endMinute))} · {formatDuration(creation.duration, t)}</div>
  </div>;
  const selectionOverlay = (lane) => <>
    {marquee?.lane === lane && <div className="jobo-s5-marquee" aria-hidden="true"
      style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />}
    {groupPreview?.lane === lane && groupPreview.items.map(item => <div key={item.id} className="jobo-s5-group-preview" aria-hidden="true"
      style={cardStyle({ ...item, startMinute: item.startMinute + groupPreview.delta, endMinute: item.endMinute + groupPreview.delta }, scale, startHour)} />)}
  </>;
  const controls = <div className={`jobo-s5-tools ${textPrimary}`}>
    <CarryForward ctx={ctx} records={joboRecords} tasks={lookupTasks} t={t} />
    <button type="button" onClick={() => setFullDay((value) => !value)} aria-pressed={fullDay}><Clock size={14} />{t(fullDay ? 'jobo.view.compactDay' : 'jobo.view.fullDay')}</button>
    <button type="button" onClick={toggleNotesColumn} aria-pressed={showNotes}><FileText size={14} />{t('task.notes')}</button>
    <span className={`jobo-header-zoom ${showNotes ? 'notes-open' : ''}`}>
    <button type="button" onClick={() => setScale((value) => Math.max(MIN_SCALE, value - 8))} aria-label={t('jobo.view.zoomOut')} disabled={scale <= MIN_SCALE}><Minus size={14} /></button>
    <button type="button" onClick={() => setScale(DEFAULT_SCALE)} aria-label={t('jobo.view.resetZoom')}>{Math.round(scale / DEFAULT_SCALE * 100)}%</button>
    <button type="button" onClick={() => setScale((value) => Math.min(MAX_SCALE, value + 8))} aria-label={t('jobo.view.zoomIn')} disabled={scale >= MAX_SCALE}><Plus size={14} /></button>
    </span>
  </div>;
  return <div data-jobo-view onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
      if (event.target.closest('input,textarea,[contenteditable="true"]')) event.stopPropagation();
      else if (event.target.closest('.jobo-s5-do-card,.jobo-s5-untimed-card,.jobo-s5-draft-card')) {
        event.preventDefault(); event.stopPropagation(); setError(t('jobo.daily.doUndoUnavailable'));
      }
      return;
    }
    if (event.key === 'Escape' && gestureCleanup.current) {
      event.preventDefault(); gestureCleanup.current();
    }
    if (event.key === 'Escape') { setSelection(null); setSelectedCards({ lane: null, ids: [] }); endDrag(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItems.length
      && !event.target.closest('button,input,textarea,select,[data-jobo-point],[contenteditable="true"]')) {
      event.preventDefault(); event.stopPropagation(); applyGroupAction(selectedItems, selectedCards.lane, { remove: true });
    }
    // Native global shortcuts must not turn Enter/Space/arrow-key edits into
    // a second task dialog, date navigation, or a completion elsewhere.
    if (event.target.closest('button,input,textarea,select,[data-jobo-card],[data-jobo-point],[role="dialog"],[role="separator"]')) event.stopPropagation();
  }} style={{ '--jobo-plan-fr': `${2 * planRatio}fr`, '--jobo-do-fr': `${2 * (1 - planRatio)}fr` }}
    className={`jobo-s5-root ${darkMode ? 'jobo-s5-dark' : ''} ${!showNotes ? 'jobo-s5-hide-notes' : ''} ${resizingColumns ? 'jobo-s5-resizing-columns' : ''} ${creation ? 'jobo-s5-creating' : ''} ${marquee ? 'jobo-s5-selecting' : ''} ${dragging ? 'jobo-s5-dragging' : ''} ${textPrimary}`}>
    {headerControlsTarget ? createPortal(<div className="jobo-day-header">{dailyStats}{controls}</div>, headerControlsTarget) : <div className="jobo-day-header">{dailyStats}{controls}</div>}
    {(error || conflict || joboError || !joboWritable || model.invalidRecordCount > 0) && <div className={`jobo-s5-notice border-b ${borderClass}`} role="status"><AlertTriangle size={14} />
      <span>{error || (conflict ? t('jobo.view.recordChanged') : '') || (joboError ? t('jobo.view.storageError') : !joboWritable ? t('jobo.view.readOnly') : t('jobo.view.invalidRecords', { count: model.invalidRecordCount }))}</span>
      {error && <button type="button" onClick={() => setError('')} aria-label={t('common.close')}><X size={14} /></button>}
    </div>}
    <div ref={scrollRef} className={`jobo-s5-scroll ${darkMode ? 'dark-scrollbar' : ''}`}>
      <div ref={boardRef} className="jobo-s5-board">
        <div className={`jobo-s5-column-head border-b ${borderClass} ${cardBg}`}>
          <div className="jobo-s5-head-cell"><b>{t('jobo.view.plan')}</b><div className="jobo-s5-head-actions">{collapsibleHistory.length > 0 && <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}><History size={13} />{t('jobo.view.historyCount', { count: collapsibleHistory.length })}</button>}<button type="button" onClick={() => openNewPlan(ctx, date, clockFromMinute(defaultMinute))} aria-label={t('jobo.view.addPlan')}><Plus size={17} /></button></div></div>
          <div className="jobo-s5-axis-handle" tabIndex={-1} {...columnResizeProps} title={t('jobo.view.resizeColumns')}><GripVertical size={14} aria-hidden="true" /></div>
          <div className="jobo-s5-head-cell"><b>{t('jobo.view.do')}</b><button type="button" onClick={() => openDo()} disabled={!writable} aria-label={t('jobo.view.addDo')}><Plus size={17} /></button></div>
          <div className="jobo-s5-head-cell jobo-s5-head-notes">
            <div className="jobo-s5-head-actions"><b>{t('task.notes')}</b>
              <button type="button" data-jobo-check aria-label={t('jobo.view.check')} aria-pressed={checkEnabled} onClick={toggleCheck} title={t('jobo.view.checkHint')}>
                <ClipboardCheck size={13} /><span>{t('jobo.view.check')}</span>{checkNoteKeys.size > 0 && <span>({checkNoteKeys.size})</span>}
              </button>
            </div>
            <JoboTools ctx={ctx} t={t} scale={scale} setScale={setScale} minScale={MIN_SCALE} maxScale={MAX_SCALE} defaultScale={DEFAULT_SCALE} />
          </div>
        </div>
        <div ref={rootRef} className="jobo-s5-day-grid" style={{ minHeight: `${height}px` }}>
          <div className="jobo-s5-time-lane" data-jobo-lane="plan" onPointerDown={(e) => beginCreation(e, 'plan')} onDoubleClick={(e) => doubleClickCreate(e, 'plan')} onDragEnter={(e) => dragEnter(e, 'plan')} onDragOver={(e) => dragOver(e, 'plan')} onDrop={(e) => drop(e, 'plan')}>
            {rows()}<JoboTimeFrames date={date} startHour={startHour} scale={scale} height={height} lane="plan" />{visiblePlans.map((item) => <PlanCard key={item.id} {...{ item, scale, startHour, ctx, t }} selected={isGroupSelected(item, 'plan') || activeFocus?.group === item.groupKey} groupSelected={isGroupSelected(item, 'plan')} snapTargets={canGroupPlan(item) ? { start: planEdgeSnap(item, visiblePlans, 'start'), end: planEdgeSnap(item, visiblePlans, 'end') } : null} onSnapEdge={snapPlanEdge} onSelect={(next, event) => selectCard(item, 'plan', next, event)} onDetails={openDetails} onNotes={openNotes} onToggleNotes={togglePlanNotes} notesColumnOpen={showNotes} noteVisible={isTaskNoteVisible(noteTaskFor(item))} onFocus={setFocus} onDragStart={beginDrag} onDragEnd={endDrag} />)}
            {!model.plans.length && <div className={`jobo-s5-empty-lane ${textSecondary}`}>{t('jobo.view.emptyPlan')}</div>}
            {creationPreview('plan')}
            {selectionOverlay('plan')}
          </div>
          <div className={`jobo-s5-time-ruler border-l border-r ${borderClass} ${cardBg}`} {...columnResizeProps}
            role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('jobo.view.resizeColumns')}
            aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(planRatio * 100)} title={t('jobo.view.resizeColumns')}>
            <PriorityTimeline plans={model.plans} timedRecords={model.timedRecords} startHour={startHour} scale={scale} height={height} />
            {hours.map((hour) => <div key={hour} className={`jobo-s5-ruler-hour border-b ${borderClass} ${textSecondary}`} style={{ height: `${scale}px` }}>{ctx.formatTime(`${two(hour)}:00`)}</div>)}
          </div>
          <div className={`jobo-s5-time-lane jobo-s5-do-lane border-r ${borderClass}`} data-jobo-lane="do" onPointerDown={(e) => beginCreation(e, 'do')} onDoubleClick={(e) => doubleClickCreate(e, 'do')} onDragEnter={(e) => dragEnter(e, 'do')} onDragOver={(e) => dragOver(e, 'do')} onDrop={(e) => drop(e, 'do')}>
            {rows()}<JoboTimeFrames date={date} startHour={startHour} scale={scale} height={height} lane="do" />{doItems.map((item) => item.draft ? <DraftDoCard key={item.id} draft={item.draft} style={cardStyle(item, scale, startHour)} ctx={ctx} t={t} onCommit={commitDraftDo} onCancel={id => setDraftDos(previous => previous.filter(draft => draft.id !== id))} selected={isGroupSelected(item, 'do')} onSelect={event => selectCard(item, 'do', null, event)} onDragStart={event => beginDrag(event, item, 'draft')} onDragEnd={endDrag} canLinkPlan={dragging && !dragRef.current?.group && dragRef.current?.type === 'plan' && writable} onLinkPlan={linkDraftPlan} /> : <DoCard key={item.id} {...{ item, scale, startHour, ctx, t, focusLog }} writable={writable && !joboPendingIds.includes(item.id)} selected={isGroupSelected(item, 'do') || activeFocus?.group === item.groupKey} groupSelected={isGroupSelected(item, 'do')} onSelect={(next, event) => selectCard(item, 'do', next, event)} onDetails={openDetails} onNotes={openNotes} onFocus={setFocus} onEdit={setEditor} onDelete={deleteDo} onProgress={changeProgress} onDragStart={beginDrag} onDragEnd={endDrag} onResize={beginResize} />)}
            {completionPoints.map(item => <CompletionPointCard key={item.id} {...{ item, scale, startHour, ctx, t }}
              writable={writable && !joboPendingIds.includes(item.id)} selected={activeFocus?.group === item.groupKey}
              onFocus={setFocus} onDetails={openDetails} onEdit={setEditor} onProgress={changeProgress} />)}
            {!doItems.length && !model.untimedRecords.length && <div className={`jobo-s5-empty-lane ${textSecondary}`}>{t('jobo.view.emptyDo')}</div>}
            {creationPreview('do')}
            {selectionOverlay('do')}
          </div>
          <NotesColumn tasks={noteTasks} planItems={model.plans} date={date} ctx={ctx} t={t} onFocus={focusNote} request={notesRequest} focus={activeFocus} visible={showNotes} isTaskNoteVisible={isTaskNoteVisible} onDragOver={dragOverNotes} onDrop={dropOnNotes}
            independentDos={independentDos} isDoNoteVisible={isDoNoteVisible} onSaveDoNote={saveDoNote} pendingIds={joboPendingIds} doWritable={jobuLoaded && jobuWritable}
            onHideDoNote={item => { setNoteVisibility(previous => ({ ...previous, [item.noteKey]: false })); setNotesRequest(null); }}
            onShowTaskNote={showTaskNote} onHideTaskNote={hideTaskNote} />
          {nowMinute != null && nowMinute >= startHour * 60 && <div className="jobo-s5-now-line" style={{ top: `${(nowMinute - startHour * 60) / 60 * scale}px` }} aria-hidden="true" />}
        </div>
        <Connections rootRef={boardRef} focus={activeFocus} dep={`${scale}:${showNotes}:${planRatio}:${showHistory}:${checkEnabled}:${JSON.stringify(checkDismissed)}:${JSON.stringify(noteVisibility)}:${JSON.stringify(displayRecords)}`} />
      </div>
    </div>
    {(dragging || selectedItems.length > 0) && <div className={`jobo-s5-selection-tools ${cardBg} ${borderClass}`}>
      <span role="status">{t('jobo.view.selectedCount', { count: dragRef.current?.group?.length || selectedItems.length || 1 })}</span>
      <button type="button" className={`jobo-s5-trash-target ${trashOver ? 'is-over' : ''}`} disabled={pending}
        aria-label={t('jobo.view.deleteSelected')} title={t('jobo.view.deleteSelected')}
        onClick={() => applyGroupAction(selectedItems, selectedCards.lane, { remove: true })}
        onDragEnter={dragOverTrash} onDragOver={dragOverTrash}
        onDragLeave={() => setTrashOver(false)} onDrop={dropInTrash}><Trash2 size={20} /></button>
      <button type="button" style={{ visibility: dragging ? 'hidden' : 'visible' }} aria-label={t('jobo.view.clearSelection')} onClick={() => { setSelectedCards({ lane: null, ids: [] }); setSelection(null); }}><X size={17} /></button>
    </div>}
    {liveDetails && !editor && <ExecutionDetails item={liveDetails} anchor={details.anchor} onClose={closeDetails} onEdit={setEditor} onNotes={openNotes} ctx={ctx} t={t} writable={writable} pendingIds={joboPendingIds} />}
    {editor && <DoEditor key={editor.record?.id || `new:${date}`} {...editor} records={joboRecords || []} writable={writable} recordJobo={recordJobo} pendingIds={joboPendingIds}
      onClose={() => setEditor(null)} {...{ t, cardBg, textPrimary, borderClass }} />}
  </div>;
}
