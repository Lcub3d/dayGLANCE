import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, GripVertical, Pencil, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { formatDuration } from '../utils/formatDuration.js';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { assignOverlapColumns, buildJoboDayModel } from '../jobo/viewModel.js';
import { intervalFromMarker } from '../jobo/completionMarker.js';
import { prepareDoEdit, commitDoEdit } from '../jobo/viewActions.js';
import { togglePlanCompletion } from '../jobo/nativePlanAdapter.js';
import useJoboViewWriter from '../hooks/useJoboViewWriter.js';
import DoEditor from './jobo/DoEditor.jsx';
import JoboTaskNotes from './jobo/JoboTaskNotes.jsx';
import ExecutionDetails from './jobo/ExecutionDetails.jsx';
import { timingRows } from './jobo/ExecutionAxes.jsx';

const SCALE = 84;
const two = value => String(value).padStart(2, '0');
const clock = minute => `${two(Math.floor((minute % 1440) / 60))}:${two(minute % 60)}`;
const progressText = (progress, t) => t(progress === 'completed' ? 'common.completed' : `jobo.view.progress.${progress}`);
const columns = 'grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] min-w-0';
const button = 'shrink-0 p-1 rounded hover:bg-white/15 focus-visible:outline focus-visible:outline-2 disabled:opacity-40';
const canNote = task => task && !task.imported && !task.isJoboSyntheticOccurrence;
const style = (item, hour) => ({ top: (item.startMinute - hour * 60) / 60 * SCALE,
  height: Math.max(40, (item.endMinute - item.startMinute) / 60 * SCALE - 2),
  left: `calc(${item.leftPct}% + 3px)`, width: `calc(${item.widthPct}% - 6px)` });

function NotesButton({ task, t, onNotes }) {
  return canNote(task) && <button type="button" className={button} aria-label={`${t('task.notes')}: ${task.title}`}
    onClick={event => onNotes(task, event.currentTarget)}><FileText size={13} /></button>;
}
function Signals({ item, t }) {
  // Full comparisons stay in ExecutionDetails; a narrow card must not become
  // a second horizontal scroller or push its primary controls out of reach.
  return <span className="hidden min-w-0 gap-1 overflow-hidden [@container(min-width:18rem)]:flex">
    {timingRows(item.comparison, t).map(row => <span key={row.key} data-jobo-axis={row.key}
      title={row.text} className="min-w-0 truncate border-l border-white/40 pl-1">{row.text}</span>)}
  </span>;
}
function PlanCard({ item, startHour, ctx, t, onDetails, onNotes }) {
  const native = item.currentTask;
  const completable = native && !item.historical && !native.isJoboSyntheticOccurrence && (!native.imported || native.isTaskCalendar);
  return <article className={`absolute box-border [container-type:inline-size] rounded-lg p-1 pl-2 overflow-hidden text-white ${item.task.color || 'bg-blue-500'}`}
    style={style(item, startHour)} data-jobo-plan={item.id}>
    <span className="absolute top-0 left-0.5 w-0.5 bg-current opacity-80 pointer-events-none" aria-hidden="true" style={{ height: (item.endMinute - item.startMinute) / 60 * SCALE }} />
    <div className="flex items-center gap-1 h-4 text-[10px] whitespace-nowrap">
      {completable && <input type="checkbox" className="shrink-0" checked={!!native.completed}
        aria-label={`${t('common.completed')}: ${native.title}`} onChange={() => togglePlanCompletion(ctx, item)} />}
      <button type="button" className="jobo-s5-title flex-1 min-w-0 truncate text-left text-xs font-semibold" title={item.task.title}
        onClick={event => onDetails(item, event.currentTarget)}>{renderTitleWithoutTags(item.task.title)}</button>
      <NotesButton task={item.sourceTask || native} {...{ t, onNotes }} />
    </div>
    <div data-jobo-metadata className="flex min-w-0 items-center gap-1 h-4 text-[10px] whitespace-nowrap overflow-hidden">
      <span className="max-w-full shrink-0 truncate" title={`${ctx.formatTime(item.plan.startTime)} · ${formatDuration(item.plan.duration, t)}`}>{ctx.formatTime(item.plan.startTime)}<span className="hidden [@container(min-width:12rem)]:inline"> · {formatDuration(item.plan.duration, t)}</span></span><Signals {...{ item, t }} />
    </div>
  </article>;
}
function DoCard({ item, startHour, ctx, t, writable, pending, onEdit, onDetails, onNotes, onMarkerDrag }) {
  const { record } = item;
  const timeLabel = item.point ? ctx.formatTime(item.time)
    : `${ctx.formatTime(record.startTime)}–${record.endDate !== record.date ? `${record.endDate} ` : ''}${ctx.formatTime(record.endTime)}`;
  return <article className={`absolute box-border [container-type:inline-size] rounded-lg p-1 pl-2 overflow-hidden text-white ${item.task?.color || 'bg-purple-500'}`}
    style={style(item, startHour)} data-jobo-record={record.id} data-jobo-point={item.point ? 'true' : undefined}
    onPointerDown={event => { if (item.point && writable && !pending && !event.target.closest('button,input')) onMarkerDrag(event, item); }}>
    {item.point ? <span className="absolute top-0 left-0 right-0 h-0.5 bg-current" aria-hidden="true" />
      : <span className="absolute top-0 left-0.5 w-0.5 bg-current opacity-80 pointer-events-none" aria-hidden="true" style={{ height: (item.endMinute - item.startMinute) / 60 * SCALE }} />}
    <div className="flex items-center gap-1 h-4 text-[10px] whitespace-nowrap">
      {item.point && <button type="button" className={`${button} cursor-ns-resize touch-none`} disabled={!writable || pending}
        data-jobo-marker-handle aria-label={`${t('jobo.view.setInterval')}: ${record.title}`}
        title={t('jobo.view.dragCompletion')} onPointerDown={event => onMarkerDrag(event, item)}
        onClick={event => { if (event.detail === 0) onEdit(record); }}><GripVertical size={12} /></button>}
      <button type="button" className="jobo-s5-title flex-1 min-w-0 truncate text-left text-xs font-semibold" title={record.title}
        onClick={event => onDetails(item, event.currentTarget)}>{renderTitleWithoutTags(record.title)}</button>
      <NotesButton task={item.sourceTask || item.task} {...{ t, onNotes }} />
      <button type="button" className={button} disabled={!writable || pending} onClick={() => onEdit(record)} aria-label={`${t('common.edit')}: ${record.title}`}><Pencil size={13} /></button>
    </div>
    <div data-jobo-metadata className="flex min-w-0 items-center gap-1 h-4 text-[10px] whitespace-nowrap overflow-hidden">
      <span className="min-w-0 truncate [@container(min-width:12rem)]:shrink-0" title={timeLabel}>{timeLabel}</span>
      <span className="hidden min-w-0 truncate [@container(min-width:12rem)]:inline" title={progressText(record.progress, t)}>{progressText(record.progress, t)}</span>
      {pending ? <span role="status">{t('jobo.view.pendingSave')}</span> : !item.point && <Signals {...{ item, t }} />}
    </div>
  </article>;
}

export default function JoboView() {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboRecords, joboLoaded, joboWritable, joboError, reloadJobo, recordJobo } = useFeaturesCtx();
  const writer = useJoboViewWriter({ records: joboRecords, recordJobo });
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [notes, setNotes] = useState(null);
  const [gesture, setGesture] = useState(null);
  const [gestureError, setGestureError] = useState('');
  const gestureCleanup = useRef(null);
  const doLane = useRef(null);
  const live = useRef(null);
  live.current = { joboRecords, joboWritable, joboLoaded, pendingIds: writer.pendingIds };
  useEffect(() => () => gestureCleanup.current?.(), []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeDetails = useCallback(() => setDetails(null), []);
  const { setExpandedNotesTaskId } = ctx;
  const closeNotes = useCallback(() => { setNotes(null); setExpandedNotesTaskId?.(null); }, [setExpandedNotesTaskId]);
  const date = dateToString(ctx.selectedDate);
  useEffect(() => { gestureCleanup.current?.(); }, [date]);
  const currentTime = ctx.currentTime instanceof Date ? ctx.currentTime : new Date();
  const nowDate = dateToString(currentTime);
  const nowTime = `${two(currentTime.getHours())}:${two(currentTime.getMinutes())}`;
  const { getTasksForDate, selectedDate } = ctx;
  const dayTasks = useMemo(() => getTasksForDate(selectedDate, false).filter(task => !task.isAllDay && task.startTime), [getTasksForDate, selectedDate]);
  const lookup = useMemo(() => [...(ctx.tasks || []), ...(ctx.unscheduledTasks || []), ...(ctx.expandedRecurringTasks || []), ...dayTasks],
    [ctx.tasks, ctx.unscheduledTasks, ctx.expandedRecurringTasks, dayTasks]);
  const model = useMemo(() => buildJoboDayModel({ date, tasks: dayTasks, taskLookup: lookup, recurringTasks: ctx.recurringTasks,
    records: joboRecords || [], scale: SCALE, isVisibleForUser: ctx.isVisibleForUser, now: { date: nowDate, time: nowTime } }),
    [date, dayTasks, lookup, ctx.recurringTasks, joboRecords, ctx.isVisibleForUser, nowDate, nowTime]);
  const doItems = assignOverlapColumns([...model.timedRecords, ...model.untimedRecords], { scale: SCALE });
  const startHour = Math.max(0, Math.floor(Math.min(480, ...model.plans.map(item => item.startMinute), ...doItems.map(item => item.startMinute)) / 60));
  const hours = Array.from({ length: 24 - startHour }, (_, i) => startHour + i);
  const liveDetail = details && [...model.plans, ...doItems].find(item => item.id === details.item.id);
  const noteTask = notes && lookup.find(task => String(task.id) === String(notes.taskId));
  const openDetails = (item, anchor) => { closeNotes(); setDetails({ item, anchor }); };
  const openEdit = record => { closeDetails(); closeNotes(); setEditor({ record }); };
  const openNotes = (task, anchor) => { closeDetails(); ctx.setExpandedNotesTaskId?.(task.id); setNotes({ taskId: task.id, anchor }); };
  const dragMarker = (event, item) => {
    if (event.button !== 0 || !joboWritable || writer.pendingIds.includes(item.id)) return;
    event.preventDefault(); event.stopPropagation();
    gestureCleanup.current?.();
    const startY = event.clientY;
    let chosen = null;
    const move = e => {
      if (Math.abs(e.clientY - startY) < 5) { chosen = null; setGesture(null); return; }
      const bounds = doLane.current?.getBoundingClientRect();
      if (!bounds) return;
      const endpoint = startHour * 60 + (e.clientY - bounds.top) / SCALE * 60;
      chosen = intervalFromMarker(item, endpoint);
      if (chosen) setGesture({ date, start: Math.min(item.startMinute, Math.max(0, Math.min(1440, Math.round(endpoint / 5) * 5))),
        end: Math.max(item.startMinute, Math.max(0, Math.min(1440, Math.round(endpoint / 5) * 5))) });
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape, true); setGesture(null); gestureCleanup.current = null; };
    const cancel = () => cleanup();
    const escape = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    const finish = async e => {
      move(e); const patch = chosen; cleanup();
      const current = live.current;
      if (!patch || !current.joboLoaded || !current.joboWritable || current.pendingIds.includes(item.id)) return;
      setGestureError('');
      try {
        const next = prepareDoEdit({ records: current.joboRecords, record: item.record, patch, now: Date.now() });
        if (!next) { setGestureError(t('jobo.view.recordChanged')); return; }
        await commitDoEdit(writer.write, next);
      } catch (error) { setGestureError(t(error.code === 'recordChanged' ? 'jobo.view.recordChanged' : 'jobo.view.updateFailed')); }
    };
    gestureCleanup.current = cleanup;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('keydown', escape, true);
  };

  if (!joboLoaded) return <div data-jobo-view className={`h-full flex items-center justify-center gap-2 p-6 ${ctx.textSecondary}`} role={joboError ? 'alert' : 'status'}>
    {joboError ? <><AlertTriangle size={16} />{t('jobo.view.loadError')}{reloadJobo && <button type="button" onClick={() => reloadJobo()}>{t('jobo.view.retryLoad')}</button>}</> : t('common.loading')}
  </div>;
  return <div data-jobo-view className={`flex-1 min-h-0 min-w-0 flex flex-col ${ctx.textPrimary}`}>
    <div className={`jobo-s5-toolbar flex items-center px-3 py-1.5 border-b ${ctx.cardBg} ${ctx.borderClass}`}>
      <button type="button" className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${ctx.hoverBg || 'hover:bg-black/5'} disabled:opacity-40`} disabled={!joboWritable}
        onClick={() => setEditor({ initial: { date, startMinute: date === nowDate ? Math.min(1410, currentTime.getHours() * 60 + currentTime.getMinutes()) : 540, duration: 30 } })}><Plus size={14} />{t('jobo.view.addDo')}</button>
    </div>
    {(gestureError || joboError || !joboWritable || writer.conflict || model.invalidRecordCount > 0) && <div className="flex gap-2 px-3 py-1 text-xs" role="status"><AlertTriangle size={14} />
      {gestureError || (writer.conflict ? t('jobo.view.recordChanged') : joboError ? t('jobo.view.storageError') : !joboWritable ? t('jobo.view.readOnly') : t('jobo.view.invalidRecords', { count: model.invalidRecordCount }))}</div>}
    {writer.pendingIds.length > 0 && <p className="px-3 py-1 text-xs" role="status">{t('jobo.view.pendingSave')}</p>}
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
      <div className={`${columns} sticky top-0 z-20 py-1.5 text-xs ${ctx.cardBg} border-b ${ctx.borderClass}`}><b className="px-2">{t('jobo.view.plan')}</b><span /><b className="px-2">{t('jobo.view.do')}</b></div>
      <div className={`${columns} relative pb-10`}>
        <div className="relative min-w-0" data-jobo-lane="plan">
          {hours.map(hour => <div key={hour} className={`box-border border-b ${ctx.borderClass}`} style={{ height: SCALE }} />)}
          {model.plans.map(item => <PlanCard key={item.id} {...{ item, startHour, ctx, t, onDetails: openDetails, onNotes: openNotes }} />)}
          {!model.plans.length && <p className="absolute top-3 inset-x-2 text-xs text-center">{t('jobo.view.emptyPlan')}</p>}
        </div>
        <div className={`text-[10px] text-center tabular-nums ${ctx.cardBg}`}>
          {hours.map(hour => <div key={hour} className={`box-border pt-1 border-b ${ctx.borderClass}`} style={{ height: SCALE }}>{ctx.formatTime(clock(hour * 60))}</div>)}
        </div>
        <div ref={doLane} className="relative min-w-0" data-jobo-lane="do">
          {hours.map(hour => <div key={hour} className={`box-border border-b ${ctx.borderClass}`} style={{ height: SCALE }} />)}
          {doItems.map(item => <DoCard key={item.id} {...{ item, startHour, ctx, t }} writable={joboWritable} pending={writer.pendingIds.includes(item.id)}
            onEdit={openEdit} onDetails={openDetails} onNotes={openNotes} onMarkerDrag={dragMarker} />)}
          {gesture && gesture.date === date && <div data-jobo-marker-preview className="absolute inset-x-1 pointer-events-none border-2 border-dashed border-blue-500 bg-blue-500/15"
            style={{ top: (gesture.start - startHour * 60) / 60 * SCALE, height: (gesture.end - gesture.start) / 60 * SCALE }} />}
          {!doItems.length && <p className="absolute top-3 inset-x-2 text-xs text-center">{t('jobo.view.emptyDo')}</p>}
        </div>
      </div>
    </div>
    {noteTask && canNote(noteTask) && <JoboTaskNotes task={noteTask} anchor={notes.anchor} ctx={ctx} t={t} onClose={closeNotes} />}
    {liveDetail && <ExecutionDetails item={liveDetail} anchor={details.anchor} onClose={closeDetails} onEdit={({ record }) => openEdit(record)} ctx={ctx} t={t} writable={joboWritable} pendingIds={writer.pendingIds} />}
    {editor && <DoEditor {...editor} records={joboRecords || []} writable={joboWritable} recordJobo={writer.write} onClose={closeEditor} pendingIds={writer.pendingIds}
      t={t} cardBg={ctx.cardBg} textPrimary={ctx.textPrimary} borderClass={ctx.borderClass} />}
  </div>;
}
