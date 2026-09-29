import React, { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X } from 'lucide-react';
import { buildCheckJournal } from '../../jobo/checkJournal.js';
import { completionMoment } from '../../jobo/completionMarker.js';
import { formatDuration } from '../../utils/formatDuration.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { renderFormattedText, renderTitle } from '../../utils/textFormatting.jsx';
import { extractWikilinks } from '../../utils/taskUtils.js';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { timingRows, metricRows } from './ExecutionAxes.jsx';

const METRIC_LABELS = {
  recordedMinutes: 'recordedLabel', elapsedMinutes: 'elapsedLabel',
  gapMinutes: 'gapLabel', overlapMinutes: 'overlapLabel',
};
const progressText = (record, t) => t(record.progress === 'completed'
  ? 'common.completed' : `jobo.view.progress.${record.progress}`);
const showTime = (ctx, time) => ctx.formatTime ? ctx.formatTime(time) : time;
const momentText = (date, time, ctx) => `${date} ${showTime(ctx, time)}`;

function actualText(record, ctx, t) {
  if (record.timing === 'timed') {
    return `${momentText(record.date, record.startTime, ctx)} – ${momentText(record.endDate, record.endTime, ctx)}`;
  }
  const point = completionMoment(record.createdAt);
  return point ? t(record.source === 'completion' ? 'jobo.check.completionTime' : 'jobo.check.recordTime', {
    time: momentText(point.date, point.time, ctx),
  }) : t('jobo.check.untimed');
}

// The journal only reads task notes. Reuse the app's formatting and existing
// Obsidian navigation; no new notes editor, draft, autosave or persistence.
function TaskNotes({ task, ctx, t, openInObsidian }) {
  const links = [...new Set(extractWikilinks(`${task.title || ''}\n${task.notes || ''}`))];
  return <details className="mt-3" data-jobo-check-notes>
    <summary className="cursor-pointer text-blue-600 dark:text-blue-400">{t('jobo.check.notes')}</summary>
    <p className={`mt-2 text-xs ${ctx.textSecondary}`}>{t('jobo.check.currentNotes')}</p>
    <div className="mt-2 whitespace-pre-wrap break-words text-sm">
      {task.notes ? renderFormattedText(task.notes) : <p className={ctx.textSecondary}>{t('jobo.check.noTaskNotes')}</p>}
    </div>
    {typeof openInObsidian === 'function' && links.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {links.map(name => <button key={name} type="button" onClick={() => openInObsidian(name)}
        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 underline break-all">
        <BookOpen size={14} aria-hidden="true" />{t('jobo.check.openNote', { name })}
      </button>)}
    </div>}
  </details>;
}

function JournalEntry({ item, ctx, t, openInObsidian }) {
  const { record, sourceTask, attempts = [record] } = item;
  const plan = record.planSnapshot;
  const rows = timingRows(item.comparison, t);
  const metrics = metricRows(item.comparison, item.comparisonMeta, t);
  return <li data-jobo-check-record={record.id} className={`rounded-lg border p-4 ${ctx.borderClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h3 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{renderTitle(record.title)}</h3>
      <span data-jobo-check-progress={record.progress} className={`text-xs ${ctx.textSecondary}`}>{progressText(record, t)}</span>
    </div>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] [&_dd]:min-w-0 [&_dd]:break-words">
      <dt className={ctx.textSecondary}>{t('jobo.view.capturedPlan')}</dt>
      <dd>{plan ? `${momentText(plan.date, plan.startTime, ctx)} · ${formatDuration(plan.duration, t)}` : t('jobo.view.noTimedPlan')}</dd>
      <dt className={ctx.textSecondary}>{t('jobo.view.do')}</dt>
      <dd>{actualText(record, ctx, t)}</dd>
    </dl>
    {record.timing === 'untimed' && <p className={`mt-2 text-xs ${ctx.textSecondary}`}>{t('jobo.check.untimed')}</p>}
    {record.timingBasis === 'planDuration' && <p className={`mt-2 text-xs ${ctx.textSecondary}`}>{t('jobo.view.inferredPlanDuration')}</p>}
    {item.recordedMinutes != null && <p className={`mt-2 text-xs ${ctx.textSecondary}`} data-jobo-check-measured>
      {t('jobo.check.inDay', { duration: formatDuration(item.recordedMinutes, t) })}
    </p>}
    <details className={`mt-3 border-t pt-3 ${ctx.borderClass}`} data-jobo-check-group>
      <summary className="cursor-pointer text-sm">{t('jobo.check.group')} · {attempts.length}</summary>
      <p className={`mt-2 text-xs ${ctx.textSecondary}`}>{t('jobo.check.groupScope')}</p>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <div><dt className={ctx.textSecondary}>{t('jobo.check.measuredSessions')}</dt><dd>{item.measuredSessions}</dd></div>
        <div><dt className={ctx.textSecondary}>{t('jobo.check.unmeasured')}</dt><dd>{item.unmeasuredAttempts}</dd></div>
      </dl>
      {/* These are the FULL group's comparisons, explicitly not a judgement
          about this row or a sum of today's visible slices. */}
      {rows.length > 0 && <ul className="mt-2 space-y-1 text-xs">{rows.map(row => <li key={row.key}>{row.text}</li>)}</ul>}
      {item.comparisonMeta?.hasEstimatedAttempts && <p className="mt-2 text-xs">{t('jobo.view.inferredHint')}</p>}
      {(item.comparisonMeta?.hasUntimedAttempts || item.comparisonMeta?.hasEstimatedAttempts) && metrics.length > 0
        && <p className="mt-2 text-xs">{t('jobo.view.measuredOnly')}</p>}
      {metrics.length > 0 && <dl className="mt-2 grid gap-1 text-xs" data-jobo-check-metrics>
        {metrics.map(row => <div key={row.key} className="flex flex-wrap gap-x-3">
          <dt className={`min-w-24 ${ctx.textSecondary}`}>{t(`jobo.view.${METRIC_LABELS[row.key]}`)}</dt><dd>{row.text}</dd>
        </div>)}
      </dl>}
      <ul className={`mt-3 divide-y text-xs ${ctx.borderClass}`}>{attempts.map(attempt => <li key={attempt.id} className="py-2 break-words">
        <p>{actualText(attempt, ctx, t)} · {progressText(attempt, t)}</p>
        <p>{renderTitle(attempt.title)}</p>
      </li>)}</ul>
    </details>
    {sourceTask ? <TaskNotes task={sourceTask} ctx={ctx} t={t} openInObsidian={openInObsidian} />
      : record.taskId != null && <p className={`mt-3 text-xs ${ctx.textSecondary}`}>{t('jobo.check.notesUnavailable')}</p>}
  </li>;
}

// A read-only modal panel, reached from JOBO only. Uses the same portal,
// backdrop and theme tokens as DoEditor, but receives no mutation callbacks.
export default function JoboCheckPanel({ model, date, loaded, error, onClose, ctx, t }) {
  const { openInObsidian } = useSyncCtx() || {};
  const { entries, invalidRecordCount } = useMemo(() => buildCheckJournal(model), [model]);
  const titleId = useId();
  const dialog = useRef(null);
  const closeButton = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const onKeyDown = event => {
    // Do not let date navigation, new-task or undo shortcuts reach the view
    // behind a reading panel. Native link/disclosure keyboard actions remain.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const fields = [...dialog.current.querySelectorAll('button:not(:disabled),a[href],summary,[tabindex="0"]')]
      .filter(el => el.getClientRects().length > 0);
    const first = fields[0], last = fields.at(-1);
    if (!first) { event.preventDefault(); dialog.current.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  };
  const status = !loaded ? (error ? 'jobo.view.loadError' : 'common.loading') : null;
  return createPortal(<div data-jobo-check-backdrop className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section data-jobo-check ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}
      className={`flex max-h-[90vh] w-full max-w-3xl min-w-0 flex-col rounded-lg border shadow-xl ${ctx.cardBg} ${ctx.textPrimary} ${ctx.borderClass}`}>
      <header className={`flex shrink-0 items-start justify-between gap-3 border-b p-4 ${ctx.borderClass}`}>
        <div className="min-w-0"><h2 id={titleId} className="text-lg font-semibold">{t('jobo.check.title')}</h2>
          <p className={`text-sm ${ctx.textSecondary}`}>{formatLocalizedDate(new Date(`${date}T12:00:00`), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label={t('common.close')}
          className={`shrink-0 rounded-lg p-2 ${ctx.darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={18} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
        <p className={`mb-4 text-sm ${ctx.textSecondary}`}>{t('jobo.check.intro')}</p>
        {status ? <p role={error ? 'alert' : 'status'}>{t(status)}</p> : <>
          {error && <p role="alert" className="mb-3">{t('jobo.view.storageError')}</p>}
          {invalidRecordCount > 0 && <p role="alert" className="mb-3">{t('jobo.view.invalidRecords', { count: invalidRecordCount })}</p>}
          {entries.length > 0 ? <ol className="space-y-3">{entries.map(item => <JournalEntry key={item.id} item={item} ctx={ctx} t={t} openInObsidian={openInObsidian} />)}</ol>
            : invalidRecordCount === 0 && <p role="status">{t('jobo.check.empty')}</p>}
        </>}
      </div>
    </section>
  </div>, document.body);
}
