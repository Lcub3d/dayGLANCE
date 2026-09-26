import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Clock, FileText, GripVertical, History, Minus, MoreHorizontal, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { formatDuration } from '../utils/formatDuration.js';
import { DO_TIMING, doDurationMinutes } from '../jobo/core.js';
import { assignOverlapColumns, buildJoboDayModel } from '../jobo/viewModel.js';
import { resolveDropTarget, resizeDoInterval, createManualDo, prepareDoEdit, commitDoEdit } from '../jobo/viewActions.js';
import { openNewPlan, startPlanDrag, dropPlan } from '../jobo/nativePlanAdapter.js';
import PlanCard from './jobo/PlanCard.jsx';
import NotesColumn from './jobo/NotesColumn.jsx';
import ExecutionDetails from './jobo/ExecutionDetails.jsx';
import DoEditor from './jobo/DoEditor.jsx';
import './jobo/JoboView.css';

const DEFAULT_SCALE = 84;
const MIN_SCALE = 52;
const MAX_SCALE = 132;
const two = (n) => String(n).padStart(2, '0');
const clockFromMinute = (n) => `${two(Math.floor(((Math.round(n) % 1440) + 1440) % 1440 / 60))}:${two(((Math.round(n) % 60) + 60) % 60)}`;
const snap = (n) => Math.round(n / 5) * 5;
const focusFor = (item) => ({ group: item.groupKey, task: item.noteKey || '' });

function cardStyle(item, scale, startHour) {
  return { top: `${(item.startMinute - startHour * 60) / 60 * scale}px`,
    height: `${Math.max(40, (item.endMinute - item.startMinute) / 60 * scale - 2)}px`,
    left: `calc(${item.leftPct}% + 3px)`, width: `calc(${item.widthPct}% - 6px)` };
}
function DoCard({ item, scale, startHour, ctx, t, writable, onFocus, onSelect, selected, onDetails, onNotes, onEdit, onDragStart, onDragEnd, onResize }) {
  const { record, task } = item;
  return <article tabIndex={0} aria-label={`${t('jobo.view.do')}: ${record.title}`} className={`jobo-s5-card jobo-s5-do-card text-white rounded-lg ${task?.color || 'bg-purple-500'} ${selected ? 'jobo-s5-selected' : ''}`}
    style={cardStyle(item, scale, startHour)} data-jobo-do-link={item.groupKey} data-jobo-task={item.noteKey || ''} data-jobo-card={record.id}
    draggable={writable} onDragStart={(event) => onDragStart(event, item, 'do')} onDragEnd={onDragEnd}
    onMouseEnter={() => onFocus(focusFor(item))} onMouseLeave={() => onFocus(null)} onFocus={() => onFocus(focusFor(item))}
    onClick={() => onSelect(focusFor(item))}
    onKeyDown={(event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onDetails(item, event.currentTarget); } }}
    onDoubleClick={(event) => { if (!event.target.closest('button,select,input')) { if (writable) onEdit({ record }); else onDetails(item, event.currentTarget); } }}>
    <button type="button" className="jobo-s5-resize jobo-s5-resize-start" disabled={!writable || item.clippedStart}
      aria-label={`${t('jobo.view.resizeStart')}: ${record.title}`} onPointerDown={(event) => onResize(event, item, 'start')}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onResize(event, item, 'start', event.key === 'ArrowUp' ? -5 : 5); } }} />
    <div className="jobo-s5-title-row"><span className="jobo-s5-title" title={record.title}>{renderTitleWithoutTags(record.title)}</span>
      {item.noteKey && <button type="button" className="jobo-s5-card-action" onClick={() => onNotes(item)} aria-label={`${t('jobo.view.locateNotes')}: ${record.title}`}><FileText size={13} /></button>}
      <button type="button" className="jobo-s5-card-action" onClick={(event) => onDetails(item, event.currentTarget)} aria-label={`${t('jobo.view.details')}: ${record.title}`}><MoreHorizontal size={15} /></button>
    </div>
    <div className="jobo-s5-meta-row"><span>{item.clippedStart ? '← ' : ''}{ctx.formatTime(record.startTime)}–{ctx.formatTime(record.endTime)}{item.clippedEnd ? ' →' : ''}</span>
      <span>{formatDuration(doDurationMinutes(record), t)}</span>
    </div>
    <button type="button" className="jobo-s5-resize jobo-s5-resize-end" disabled={!writable || item.clippedEnd}
      aria-label={`${t('jobo.view.resizeEnd')}: ${record.title}`} onPointerDown={(event) => onResize(event, item, 'end')}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onResize(event, item, 'end', event.key === 'ArrowUp' ? -5 : 5); } }} />
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
      const note = [...root.querySelectorAll('[data-jobo-note-link]')].find((el) => el.dataset.joboNoteLink === focus.task);
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

function DropFeedback({ hint, rootRef, scale, startHour, ctx, t }) {
  const [path, setPath] = useState('');
  const top = (hint.minute - startHour * 60) / 60 * scale;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const source = [...root.querySelectorAll('[data-jobo-card]')].find(el => el.dataset.joboCard === hint.sourceId);
    const target = root.querySelector(`[data-jobo-lane="${hint.lane}"]`);
    if (!source || !target) { setPath(''); return; }
    const box = root.getBoundingClientRect(); const a = source.getBoundingClientRect(); const b = target.getBoundingClientRect();
    const x1 = a.right - box.left; const y1 = a.top + Math.min(a.height / 2, 20) - box.top;
    const x2 = b.left + b.width / 2 - box.left;
    setPath(`M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${top} ${x2},${top}`);
  }, [hint, rootRef, top]);
  const interval = hint.interval;
  return <>
    <svg className="jobo-s5-drag-connection" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" /></svg>
    <div className={`jobo-s5-drop-hint jobo-s5-drop-${hint.lane}`} style={{ top, height: Math.max(12, Math.min(hint.visibleDuration ?? hint.duration, 1440 - hint.minute) / 60 * scale) }}>
      <span>{t(hint.lane === 'do' && hint.type === 'plan' ? 'jobo.view.dropCreate' : hint.type === 'untimed' ? 'jobo.view.dropCorrect' : 'jobo.view.dropMove')} · {ctx.formatTime(interval.startTime)}–{interval.endDate !== interval.date ? `${interval.endDate} ` : ''}{ctx.formatTime(interval.endTime)}</span>
    </div>
  </>;
}

export default function JoboView({ headerControlsTarget }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboRecords, joboLoaded, joboWritable, joboError, joboPendingIds = [], joboPendingCount = 0, reloadJobo, recordJobo } = useFeaturesCtx();
  const { selectedDate, tasks, unscheduledTasks, recurringTasks, expandedRecurringTasks, getTasksForDate, currentTime, darkMode, cardBg, borderClass, textPrimary, textSecondary } = ctx;
  const [editor, setEditor] = useState(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [fullDay, setFullDay] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [planRatio, setPlanRatio] = useState(.5);
  const [resizingColumns, setResizingColumns] = useState(false);
  const [focus, setFocus] = useState(null);
  const [selection, setSelection] = useState(null);
  const [details, setDetails] = useState(null);
  const [notesRequest, setNotesRequest] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [preview, setPreview] = useState(null);
  const [gestureStartHour, setGestureStartHour] = useState(null);
  const [dropHint, setDropHint] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const rootRef = useRef(null);
  const boardRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const gestureCleanup = useRef(null);
  const columnResizeRef = useRef(null);
  const busyRef = useRef(false);
  const recordsRef = useRef(joboRecords);
  recordsRef.current = joboRecords;
  const writable = joboLoaded && joboWritable && !pending;
  const date = dateToString(selectedDate);
  const clock = currentTime instanceof Date ? currentTime : new Date();
  const today = dateToString(clock);
  const nowTime = `${two(clock.getHours())}:${two(clock.getMinutes())}`;
  const dayTasks = useMemo(() => getTasksForDate(selectedDate).filter((task) => !task.isAllDay && task.startTime), [getTasksForDate, selectedDate]);
  const lookupTasks = useMemo(() => [...tasks, ...unscheduledTasks, ...(expandedRecurringTasks || []), ...dayTasks], [tasks, unscheduledTasks, expandedRecurringTasks, dayTasks]);
  const displayRecords = useMemo(() => preview ? (joboRecords || []).map((r) => r.id === preview.id ? preview : r) : joboRecords, [joboRecords, preview]);
  const model = useMemo(() => buildJoboDayModel({ date, tasks: dayTasks, taskLookup: lookupTasks, recurringTasks, records: displayRecords || [], scale, now: { date: today, time: nowTime } }), [date, dayTasks, lookupTasks, recurringTasks, displayRecords, today, nowTime, scale]);
  const collapsibleHistory = model.plans.filter(item => item.historical && model.plans.some(current => !current.historical && current.noteKey && current.noteKey === item.noteKey));
  const visiblePlans = assignOverlapColumns(model.plans.filter(item => showHistory || !collapsibleHistory.includes(item)), { scale });
  const noteTasks = [...dayTasks, ...model.plans.map(item => item.sourceTask || item.currentTask || (item.noteKey ? item.task : null)), ...model.timedRecords.map(item => item.task), ...model.untimedRecords.map(item => item.task)].filter(Boolean);
  const activeFocus = focus || selection;
  const firstMinute = Math.min(480, ...visiblePlans.map((x) => x.startMinute), ...model.timedRecords.map((x) => x.startMinute));
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
    setShowNotes(true); setSelection(focusFor(item)); setNotesRequest({ key: item.noteKey, token: Date.now() });
  };
  const liveDetails = details && (model.plans.find(item => item.id === details.item.id)
    || [...model.timedRecords, ...model.untimedRecords].find(item => item.id === details.item.id));

  const runWrite = async (build) => {
    if (!joboWritable || !joboLoaded || busyRef.current) return;
    busyRef.current = true; setPending(true); setError('');
    try { const next = build(); if (!next) { setError(t('jobo.view.recordChanged')); return; } if (joboPendingIds.includes(next.id)) return; await commitDoEdit(recordJobo, next); }
    catch (err) { setError(t(err.code === 'readOnly' ? 'jobo.view.readOnly' : err.code === 'notLoaded' ? 'jobo.view.loadError' : 'jobo.view.updateFailed')); }
    finally { busyRef.current = false; setPending(false); }
  };
  const endDrag = () => { dragRef.current = null; setDropHint(null); ctx.handleDragEnd?.(); };
  const beginDrag = (event, item, type) => {
    if (event.target.closest('button,select,input,textarea,.notes-panel-container input') || (type !== 'plan' && (!writable || joboPendingIds.includes(item.id)))) { event.preventDefault(); return; }
    if (type === 'plan' && !startPlanDrag(ctx, item, event)) { event.preventDefault(); return; }
    const offset = item.startMinute == null ? 0 : Math.max(0, (event.clientY - event.currentTarget.getBoundingClientRect().top) / scale * 60);
    dragRef.current = { item, type, offset };
    event.dataTransfer.setData('application/x-jobo-view', type);
    event.dataTransfer.effectAllowed = 'copyMove';
  };
  const minuteAt = (event) => Math.max(0, Math.min(1435, snap(startHour * 60 + (event.clientY - event.currentTarget.getBoundingClientRect().top) / scale * 60 - (dragRef.current?.offset || 0))));
  const dragOver = (event, lane) => {
    const payload = dragRef.current;
    if (!payload || (lane === 'plan' && payload.type !== 'plan') || (lane === 'do' && !writable)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = lane === 'do' && payload.type === 'plan' ? 'copy' : 'move';
    const target = resolveDropTarget({ ...payload, lane, date, minute: minuteAt(event) });
    if (!target) return;
    setDropHint({ ...target, lane, type: payload.type, sourceId: payload.item.id });
    const box = scrollRef.current.getBoundingClientRect();
    if (event.clientY > box.bottom - 45) scrollRef.current.scrollTop += 12;
    if (event.clientY < box.top + 70) scrollRef.current.scrollTop -= 12;
  };
  const drop = (event, lane) => {
    const payload = dragRef.current;
    if (!payload || (lane === 'plan' && payload.type !== 'plan') || (lane === 'do' && !writable)) return;
    event.preventDefault();
    const target = resolveDropTarget({ ...payload, lane, date, minute: minuteAt(event) });
    if (!target) { endDrag(); return; }
    const { minute, interval } = target;
    if (lane === 'plan') dropPlan(ctx, event, selectedDate, clockFromMinute(minute));
    else if (payload.type === 'plan') {
      const { plan } = payload.item;
      const task = payload.item.currentTask || payload.item.task;
      runWrite(() => createManualDo({ id: `manual:${crypto.randomUUID()}`, title: task.title, task, planSnapshot: plan, date, startMinute: minute, duration: target.duration, now: Date.now() }));
    } else if (payload.item.record.timing === DO_TIMING.UNTIMED) {
      setEditor({ record: payload.item.record, initial: { patch: interval } });
    } else {
      const record = payload.item.record;
      runWrite(() => prepareDoEdit({ records: recordsRef.current, record, patch: interval, now: Date.now() }));
    }
    endDrag();
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
      patch = resizeDoInterval(record, edge, delta); setPreview({ ...record, ...patch });
    };
    const up = () => { cleanup(); if (patch) runWrite(() => prepareDoEdit({ records: recordsRef.current, record, patch, now: Date.now() })); };
    const cancel = () => cleanup();
    const key = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    gestureCleanup.current = cleanup;
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
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const wheel = (event) => { if (!event.ctrlKey) return; event.preventDefault(); setScale((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value + (event.deltaY < 0 ? 4 : -4)))); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [joboLoaded]);
  useEffect(() => { gestureCleanup.current?.(); setEditor(null); setDetails(null); setFocus(null); setSelection(null); setNotesRequest(null); setShowHistory(false); setDropHint(null); dragRef.current = null; }, [date]);

  if (!joboLoaded) return <div data-jobo-view className={`h-full flex flex-col gap-3 items-center justify-center p-8 ${textSecondary}`} role="status">{joboError ? t('jobo.view.loadError') : t('common.loading')}{joboError && <button type="button" onClick={() => reloadJobo?.()}>{t('jobo.view.retryLoad')}</button>}</div>;
  const rows = () => hours.map((hour, index) => <div key={hour} className={`jobo-s5-hour border-b ${borderClass} ${index % 2 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`} style={{ height: `${scale}px` }}><div className={`jobo-s5-half border-b border-dashed ${borderClass}`} /></div>);
  const emptyClick = (event, lane) => {
    if (event.target.closest('[data-jobo-card],button,select') || gestureCleanup.current || busyRef.current) return;
    const minute = minuteAt(event);
    if (lane === 'plan') openNewPlan(ctx, date, clockFromMinute(minute));
    else if (writable) openDo(minute);
  };
  const controls = <div className={`jobo-s5-tools ${textPrimary}`}>
    <button type="button" onClick={() => setFullDay((value) => !value)} aria-pressed={fullDay}><Clock size={14} />{t(fullDay ? 'jobo.view.compactDay' : 'jobo.view.fullDay')}</button>
    <button type="button" onClick={() => setShowNotes((value) => !value)} aria-pressed={showNotes}><FileText size={14} />{t('task.notes')}</button>
    <button type="button" onClick={() => setScale((value) => Math.max(MIN_SCALE, value - 8))} aria-label={t('jobo.view.zoomOut')} disabled={scale <= MIN_SCALE}><Minus size={14} /></button>
    <button type="button" onClick={() => setScale(DEFAULT_SCALE)} aria-label={t('jobo.view.resetZoom')}>{Math.round(scale / DEFAULT_SCALE * 100)}%</button>
    <button type="button" onClick={() => setScale((value) => Math.min(MAX_SCALE, value + 8))} aria-label={t('jobo.view.zoomIn')} disabled={scale >= MAX_SCALE}><Plus size={14} /></button>
  </div>;
  return <div data-jobo-view onKeyDown={(event) => {
    if (event.key === 'Escape' && gestureCleanup.current) {
      event.preventDefault(); gestureCleanup.current();
    }
    if (event.key === 'Escape') { setSelection(null); endDrag(); }
    // Native global shortcuts must not turn Enter/Space/arrow-key edits into
    // a second task dialog, date navigation, or a completion elsewhere.
    if (event.target.closest('button,input,textarea,select,[data-jobo-card],[role="dialog"],[role="separator"]')) event.stopPropagation();
  }} style={{ '--jobo-plan-fr': `${2 * planRatio}fr`, '--jobo-do-fr': `${2 * (1 - planRatio)}fr` }}
    className={`jobo-s5-root ${darkMode ? 'jobo-s5-dark' : ''} ${!showNotes ? 'jobo-s5-hide-notes' : ''} ${resizingColumns ? 'jobo-s5-resizing-columns' : ''} ${textPrimary}`}>
    {headerControlsTarget ? createPortal(controls, headerControlsTarget) : controls}
    {(error || joboError || joboPendingCount > 0 || !joboWritable || model.invalidRecordCount > 0) && <div className={`jobo-s5-notice border-b ${borderClass}`} role="status"><AlertTriangle size={14} />
      <span>{error || (joboPendingCount > 0 ? t('jobo.view.pendingCount', { count: joboPendingCount }) : joboError ? t('jobo.view.storageError') : !joboWritable ? t('jobo.view.readOnly') : t('jobo.view.invalidRecords', { count: model.invalidRecordCount }))}</span>
      {error && <button type="button" onClick={() => setError('')} aria-label={t('common.close')}><X size={14} /></button>}
    </div>}
    <div ref={scrollRef} className={`jobo-s5-scroll ${darkMode ? 'dark-scrollbar' : ''}`}>
      <div ref={boardRef} className="jobo-s5-board">
        <div className={`jobo-s5-column-head border-b ${borderClass} ${cardBg}`}>
          <div className="jobo-s5-head-cell"><b>{t('jobo.view.plan')}</b><div className="jobo-s5-head-actions">{collapsibleHistory.length > 0 && <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}><History size={13} />{t('jobo.view.historyCount', { count: collapsibleHistory.length })}</button>}<button type="button" onClick={() => openNewPlan(ctx, date, clockFromMinute(defaultMinute))} aria-label={t('jobo.view.addPlan')}><Plus size={17} /></button></div></div>
          <div className="jobo-s5-axis-handle" tabIndex={-1} {...columnResizeProps} title={t('jobo.view.resizeColumns')}><GripVertical size={14} aria-hidden="true" /></div>
          <div className="jobo-s5-head-cell"><b>{t('jobo.view.do')}</b><button type="button" onClick={() => openDo()} disabled={!writable} aria-label={t('jobo.view.addDo')}><Plus size={17} /></button></div>
          <div className="jobo-s5-head-cell jobo-s5-head-notes"><b>{t('task.notes')}</b></div>
        </div>
        {model.untimedRecords.length > 0 && <div className={`jobo-s5-untimed-row ${cardBg} border-b ${borderClass}`}><div /><div className="jobo-s5-untimed-ruler"><Clock size={13} /></div><div className="jobo-s5-untimed-cell">
          <span className="jobo-s5-untimed-label">{t('jobo.view.untimed')}</span><div className="jobo-s5-untimed-list">
            {model.untimedRecords.map((item) => <div key={item.id} tabIndex={0} className={`jobo-s5-untimed-card ${item.task?.color || 'bg-purple-500'} text-white ${activeFocus?.group === item.groupKey ? 'jobo-s5-selected' : ''}`}
              data-jobo-do-link={item.groupKey} data-jobo-task={item.noteKey || ''} data-jobo-card={item.id}
              draggable={writable && !joboPendingIds.includes(item.id)} onDragStart={(event) => beginDrag(event, item, 'untimed')} onDragEnd={endDrag}
              onMouseEnter={() => setFocus(focusFor(item))} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(focusFor(item))} onClick={() => setSelection(focusFor(item))}
              onKeyDown={(event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openDetails(item, event.currentTarget); } }}
              onDoubleClick={(event) => { if (!event.target.closest('button,select,input')) openDetails(item, event.currentTarget); }}>
              <span className="jobo-s5-untimed-title" title={t('jobo.view.untimedHint')}>{renderTitleWithoutTags(item.record.title)}</span>
              {item.noteKey && <button type="button" className="jobo-s5-card-action" onClick={() => openNotes(item)} aria-label={`${t('jobo.view.locateNotes')}: ${item.record.title}`}><FileText size={12} /></button>}
              <button type="button" className="jobo-s5-card-action" onClick={(event) => openDetails(item, event.currentTarget)} aria-label={`${t('jobo.view.details')}: ${item.record.title}`}><MoreHorizontal size={14} /></button>
            </div>)}
          </div></div><div className="jobo-s5-untimed-notes-spacer" /></div>}
        <div ref={rootRef} className="jobo-s5-day-grid" style={{ minHeight: `${height}px` }}>
          <div className="jobo-s5-time-lane" data-jobo-lane="plan" onClick={(e) => emptyClick(e, 'plan')} onDragOver={(e) => dragOver(e, 'plan')} onDrop={(e) => drop(e, 'plan')}>
            {rows()}{visiblePlans.map((item) => <PlanCard key={item.id} {...{ item, scale, startHour, ctx, t }} selected={activeFocus?.group === item.groupKey} onSelect={setSelection} onDetails={openDetails} onNotes={openNotes} onFocus={setFocus} onDragStart={beginDrag} onDragEnd={endDrag} />)}
            {!model.plans.length && <div className={`jobo-s5-empty-lane ${textSecondary}`}>{t('jobo.view.emptyPlan')}</div>}
          </div>
          <div className={`jobo-s5-time-ruler border-l border-r ${borderClass} ${cardBg}`} {...columnResizeProps}
            role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('jobo.view.resizeColumns')}
            aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(planRatio * 100)} title={t('jobo.view.resizeColumns')}>
            {hours.map((hour) => <div key={hour} className={`jobo-s5-ruler-hour border-b ${borderClass} ${textSecondary}`} style={{ height: `${scale}px` }}>{ctx.formatTime(`${two(hour)}:00`)}</div>)}
          </div>
          <div className={`jobo-s5-time-lane jobo-s5-do-lane border-r ${borderClass}`} data-jobo-lane="do" onClick={(e) => emptyClick(e, 'do')} onDragOver={(e) => dragOver(e, 'do')} onDrop={(e) => drop(e, 'do')}>
            {rows()}{model.timedRecords.map((item) => <DoCard key={item.id} {...{ item, scale, startHour, ctx, t }} writable={writable && !joboPendingIds.includes(item.id)} selected={activeFocus?.group === item.groupKey} onSelect={setSelection} onDetails={openDetails} onNotes={openNotes} onFocus={setFocus} onEdit={setEditor} onDragStart={beginDrag} onDragEnd={endDrag} onResize={beginResize} />)}
            {!model.timedRecords.length && !model.untimedRecords.length && <div className={`jobo-s5-empty-lane ${textSecondary}`}>{t('jobo.view.emptyDo')}</div>}
          </div>
          {showNotes && <NotesColumn tasks={noteTasks} date={date} ctx={ctx} t={t} onFocus={setFocus} request={notesRequest} focus={activeFocus} />}
          {nowMinute != null && nowMinute >= startHour * 60 && <div className="jobo-s5-now-line" style={{ top: `${(nowMinute - startHour * 60) / 60 * scale}px` }} aria-hidden="true" />}
          {dropHint && <DropFeedback hint={dropHint} rootRef={rootRef} scale={scale} startHour={startHour} ctx={ctx} t={t} />}
        </div>
        <Connections rootRef={boardRef} focus={activeFocus} dep={`${scale}:${showNotes}:${planRatio}:${showHistory}:${JSON.stringify(displayRecords)}`} />
      </div>
    </div>
    {liveDetails && !editor && <ExecutionDetails item={liveDetails} anchor={details.anchor} onClose={closeDetails} onEdit={setEditor} onNotes={openNotes} ctx={ctx} t={t} writable={writable} pendingIds={joboPendingIds} />}
    {editor && <DoEditor key={editor.record?.id || `new:${date}`} {...editor} records={joboRecords || []} writable={writable} recordJobo={recordJobo} pendingIds={joboPendingIds}
      onClose={() => setEditor(null)} {...{ t, cardBg, textPrimary, borderClass }} />}
  </div>;
}
