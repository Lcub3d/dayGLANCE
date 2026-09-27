import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { formatDuration } from '../utils/formatDuration.js';
import { buildJoboDayModel } from '../jobo/viewModel.js';
import { togglePlanCompletion } from '../jobo/nativePlanAdapter.js';
import useJoboViewWriter from '../hooks/useJoboViewWriter.js';
import DoEditor from './jobo/DoEditor.jsx';
import ExecutionDetails from './jobo/ExecutionDetails.jsx';
import { timingRows } from './jobo/ExecutionAxes.jsx';
import './jobo/JoboView.css';

const SCALE = 84;
const two = value => String(value).padStart(2, '0');
const clock = minute => `${two(Math.floor((minute % 1440) / 60))}:${two(minute % 60)}`;
const progressText = (progress, t) => t(progress === 'completed' ? 'common.completed' : `jobo.view.progress.${progress}`);

function cardStyle(item, startHour) {
  return {
    top: (item.startMinute - startHour * 60) / 60 * SCALE,
    height: Math.max(40, (item.endMinute - item.startMinute) / 60 * SCALE - 2),
    left: `calc(${item.leftPct}% + 3px)`, width: `calc(${item.widthPct}% - 6px)`,
  };
}
function Signals({ item, t }) {
  const rows = timingRows(item.comparison, t);
  return rows.map(row => <span key={row.key} data-jobo-axis={row.key}>{row.text}</span>);
}
function PlanCard({ item, startHour, ctx, t, onDetails }) {
  const native = item.currentTask;
  const canComplete = native && !item.historical && !native.isJoboSyntheticOccurrence
    && (!native.imported || native.isTaskCalendar);
  return <article className={`jobo-s5-card text-white ${item.task.color || 'bg-blue-500'}`}
    style={cardStyle(item, startHour)} data-jobo-plan={item.id}>
    <span className="jobo-s5-exact-interval" aria-hidden="true" style={{ height: (item.endMinute - item.startMinute) / 60 * SCALE }} />
    <div className="jobo-s5-title-row">
      {canComplete && <input type="checkbox" checked={!!native.completed}
        aria-label={`${t('common.completed')}: ${native.title}`}
        onChange={() => togglePlanCompletion(ctx, item)} />}
      <button type="button" className="jobo-s5-title" onClick={event => onDetails(item, event.currentTarget)}
        title={item.task.title}>{item.task.title}</button>
      {item.historical && <span title={t('jobo.view.capturedPlan')}>{t('jobo.view.capturedPlan')}</span>}
    </div>
    <div className="jobo-s5-meta-row">
      <span>{ctx.formatTime(item.plan.startTime)} · {formatDuration(item.plan.duration, t)}</span>
      <Signals item={item} t={t} />
    </div>
  </article>;
}
function DoCard({ item, startHour, ctx, t, writable, pending, onEdit, onDetails }) {
  const { record } = item;
  return <article className={`jobo-s5-card text-white ${item.task?.color || 'bg-purple-500'}`}
    style={cardStyle(item, startHour)} data-jobo-record={record.id}>
    <span className="jobo-s5-exact-interval" aria-hidden="true" style={{ height: (item.endMinute - item.startMinute) / 60 * SCALE }} />
    <div className="jobo-s5-title-row">
      <button type="button" className="jobo-s5-title" title={record.title}
        onClick={event => onDetails(item, event.currentTarget)}>{record.title}</button>
      <span>{progressText(record.progress, t)}</span>
      <button type="button" disabled={!writable || pending} onClick={() => onEdit(record)}
        aria-label={`${t('common.edit')}: ${record.title}`}><Pencil size={13} /></button>
    </div>
    <div className="jobo-s5-meta-row">
      <span>{ctx.formatTime(record.startTime)}–{record.endDate !== record.date ? `${record.endDate} ` : ''}{ctx.formatTime(record.endTime)}</span>
      {pending ? <span role="status">{t('jobo.view.pendingSave')}</span> : <Signals item={item} t={t} />}
    </div>
  </article>;
}

// Committed ledger data is the only evidence input. Form drafts and pending
// receipts are not records and never enter the day model or another store.
export default function JoboView() {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboRecords, joboLoaded, joboWritable, joboError, reloadJobo, recordJobo } = useFeaturesCtx();
  const writer = useJoboViewWriter({ records: joboRecords, recordJobo });
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [showNotes, setShowNotes] = useState(true);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeDetails = useCallback(() => setDetails(null), []);
  const date = dateToString(ctx.selectedDate);
  const currentTime = ctx.currentTime instanceof Date ? ctx.currentTime : new Date();
  const nowDate = dateToString(currentTime);
  const nowTime = `${two(currentTime.getHours())}:${two(currentTime.getMinutes())}`;
  const { getTasksForDate, selectedDate } = ctx;
  const dayTasks = useMemo(() => getTasksForDate(selectedDate, false)
    .filter(task => !task.isAllDay && task.startTime), [getTasksForDate, selectedDate]);
  const lookup = useMemo(() => [...(ctx.tasks || []), ...(ctx.unscheduledTasks || []),
    ...(ctx.expandedRecurringTasks || []), ...dayTasks], [ctx.tasks, ctx.unscheduledTasks, ctx.expandedRecurringTasks, dayTasks]);
  const model = useMemo(() => buildJoboDayModel({ date, tasks: dayTasks, taskLookup: lookup,
    recurringTasks: ctx.recurringTasks, records: joboRecords || [], scale: SCALE,
    isVisibleForUser: ctx.isVisibleForUser, now: { date: nowDate, time: nowTime } }),
  [date, dayTasks, lookup, ctx.recurringTasks, joboRecords, ctx.isVisibleForUser, nowDate, nowTime]);
  const startHour = Math.max(0, Math.floor(Math.min(480,
    ...model.plans.map(item => item.startMinute), ...model.timedRecords.map(item => item.startMinute)) / 60));
  const hours = Array.from({ length: 24 - startHour }, (_, i) => startHour + i);
  const noteTasks = new Map();
  for (const item of [...model.plans, ...model.timedRecords, ...model.untimedRecords]) {
    const task = item.sourceTask || item.currentTask || item.task;
    if (task?.id != null && task.notes) noteTasks.set(String(task.id), task);
  }
  const liveDetail = details && [...model.plans, ...model.timedRecords, ...model.untimedRecords]
    .find(item => item.id === details.item.id);
  const openDetails = (item, anchor) => setDetails({ item, anchor });
  const openEdit = record => { closeDetails(); setEditor({ record }); };

  if (!joboLoaded) return <div data-jobo-view className={`jobo-s5-loading ${ctx.textSecondary}`} role={joboError ? 'alert' : 'status'}>
    {joboError ? <><AlertTriangle size={16} />{t('jobo.view.loadError')}
      {reloadJobo && <button type="button" onClick={() => reloadJobo()}>{t('jobo.view.retryLoad')}</button>}</> : t('common.loading')}
  </div>;

  return <div data-jobo-view className={`jobo-s5-root ${ctx.textPrimary} ${showNotes ? '' : 'jobo-s5-no-notes'}`}>
    <div className={`jobo-s5-toolbar ${ctx.cardBg} border-b ${ctx.borderClass}`}>
      <button type="button" disabled={!joboWritable} onClick={() => setEditor({ initial: { date,
        startMinute: date === nowDate ? Math.min(1410, currentTime.getHours() * 60 + currentTime.getMinutes()) : 540,
        duration: 30 } })}><Plus size={14} />{t('jobo.view.addDo')}</button>
      <label><input type="checkbox" checked={showNotes} onChange={event => setShowNotes(event.target.checked)} />{t('task.notes')}</label>
    </div>
    {(joboError || !joboWritable || writer.conflict || model.invalidRecordCount > 0) && <div className="jobo-s5-notice" role="status">
      <AlertTriangle size={14} />{writer.conflict ? t('jobo.view.recordChanged') : joboError ? t('jobo.view.storageError')
        : !joboWritable ? t('jobo.view.readOnly') : t('jobo.view.invalidRecords', { count: model.invalidRecordCount })}
    </div>}
    {writer.pendingIds.length > 0 && <p className="jobo-s5-notice" role="status">{t('jobo.view.pendingSave')}</p>}
    <div className="jobo-s5-scroll">
      <div className={`jobo-s5-columns jobo-s5-head ${ctx.cardBg} border-b ${ctx.borderClass}`}>
        <b>{t('jobo.view.plan')}</b><span /><b>{t('jobo.view.do')}</b><b className="jobo-s5-notes">{t('task.notes')}</b>
      </div>
      {model.untimedRecords.length > 0 && <div className="jobo-s5-columns jobo-s5-untimed-row">
        <span /><span /><div><span>{t('jobo.view.untimed')}</span>
          {model.untimedRecords.map(item => <div className="jobo-s5-untimed" key={item.id} data-jobo-record={item.id}>
            <button type="button" onClick={event => openDetails(item, event.currentTarget)}>{item.record.title} · {progressText(item.record.progress, t)}</button>
            <button type="button" disabled={!joboWritable || writer.pendingIds.includes(item.id)} onClick={() => openEdit(item.record)}
              aria-label={`${t('common.edit')}: ${item.record.title}`}><Pencil size={13} /></button>
          </div>)}
        </div><span className="jobo-s5-notes" />
      </div>}
      <div className="jobo-s5-columns jobo-s5-grid">
        <div className="jobo-s5-lane" data-jobo-lane="plan">
          {hours.map(hour => <div key={hour} className={`jobo-s5-hour border-b ${ctx.borderClass}`} style={{ height: SCALE }} />)}
          {model.plans.map(item => <PlanCard key={item.id} {...{ item, startHour, ctx, t }} onDetails={openDetails} />)}
          {!model.plans.length && <p className="jobo-s5-empty">{t('jobo.view.emptyPlan')}</p>}
        </div>
        <div className={`jobo-s5-ruler ${ctx.cardBg}`}>
          {hours.map(hour => <div key={hour} className={`border-b ${ctx.borderClass}`} style={{ height: SCALE }}>{ctx.formatTime(clock(hour * 60))}</div>)}
        </div>
        <div className="jobo-s5-lane" data-jobo-lane="do">
          {hours.map(hour => <div key={hour} className={`jobo-s5-hour border-b ${ctx.borderClass}`} style={{ height: SCALE }} />)}
          {model.timedRecords.map(item => <DoCard key={item.id} {...{ item, startHour, ctx, t }} writable={joboWritable}
            pending={writer.pendingIds.includes(item.id)} onEdit={openEdit} onDetails={openDetails} />)}
          {!model.timedRecords.length && !model.untimedRecords.length && <p className="jobo-s5-empty">{t('jobo.view.emptyDo')}</p>}
        </div>
        <aside className={`jobo-s5-notes border-l ${ctx.borderClass}`}>
          {[...noteTasks.values()].map(task => <section key={task.id} className="jobo-s5-note"><b>{task.title}</b><p>{task.notes}</p></section>)}
          {!noteTasks.size && <p>{t('common.empty')}</p>}
        </aside>
      </div>
    </div>
    {liveDetail && <ExecutionDetails item={liveDetail} anchor={details.anchor} onClose={closeDetails}
      onEdit={({ record }) => openEdit(record)} ctx={ctx} t={t} writable={joboWritable} pendingIds={writer.pendingIds} />}
    {editor && <DoEditor {...editor} records={joboRecords || []} writable={joboWritable}
      recordJobo={writer.write} onClose={closeEditor} pendingIds={writer.pendingIds}
      t={t} cardBg={ctx.cardBg} textPrimary={ctx.textPrimary} borderClass={ctx.borderClass} />}
  </div>;
}
