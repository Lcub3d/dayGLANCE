import React, { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import { completionMarker } from '../../jobo/completionMarker.js';
import { summaryRows, timingRows } from './ExecutionAxes.jsx';
import { buildCheckJournal, checkPlanEnd } from './checkJournal.js';

const progressText = (progress, t) => t(progress === 'completed' ? 'common.completed' : `jobo.view.progress.${progress}`);
const identityTime = value => value;

export function CheckJournal({ model, date, loaded, error, onOpenNotes, formatTime = identityTime, textSecondary = '', borderClass = '' }) {
  const { t, i18n } = useTranslation();
  const journal = useMemo(() => loaded && model ? buildCheckJournal(model) : null, [loaded, model]);
  if (error) return <p role="alert">{t('jobo.check.unavailable')}</p>;
  if (!journal) return <p role="status">{t('common.loading')}</p>;
  const civilDate = value => formatLocalizedDate(new Date(`${value}T00:00:00Z`),
    { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }, i18n.resolvedLanguage || i18n.language);
  const at = (day, time) => <time dateTime={`${day}T${time}`}>
    {day !== date && <>{civilDate(day)} · </>}{formatTime(time)}
  </time>;
  const interval = (startDate, start, endDate, end) => <>{at(startDate, start)}–{at(endDate, end)}</>;
  const entry = item => {
    const end = item.plan && checkPlanEnd(item.plan);
    const summaries = journal.invalidRecordCount === 0 ? summaryRows(item.labels, item.comparison, t) : [];
    const timings = journal.invalidRecordCount === 0
      ? timingRows(item.comparison, t).filter(row => !summaries.some(summary => summary.text === row.text)) : [];
    const hasOtherDays = item.attempts.some(record => record.timing === 'timed'
      ? record.date !== date || record.endDate !== date : completionMarker(record)?.date !== date);
    return <li key={item.key} data-check-entry={item.key} className={`py-4 first:pt-0 border-b last:border-b-0 ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-semibold min-w-0 break-words" style={{ color: TAILWIND_TO_HEX[item.sourceTask?.color] || TAILWIND_TO_HEX['bg-blue-500'] }}>
          {renderTitleWithoutTags(item.title)}
        </h4>
        {item.sourceTask && onOpenNotes && <button type="button" data-check-notes={item.notesRecord.id}
          onClick={() => onOpenNotes(item.notesRecord)}
          aria-label={t('jobo.check.openNotes', { title: item.title })}
          className={`flex-shrink-0 inline-flex items-center gap-1 text-xs underline underline-offset-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500 ${textSecondary}`}>
          <FileText size={13} aria-hidden="true" />{t('task.notes')}
        </button>}
      </div>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 mt-2">
        <div className="min-w-0">
          <p className={`text-xs mb-1 ${textSecondary}`}>{t('jobo.view.plan')}</p>
          <p data-check-plan>{end ? interval(item.plan.date, item.plan.startTime, end.date, end.time) : t('jobo.view.noTimedPlan')}</p>
        </div>
        <div className="min-w-0">
          <p className={`text-xs mb-1 ${textSecondary}`}>{t('jobo.check.recorded')}</p>
          <ol className="space-y-1">
            {item.attempts.map(record => {
              const marker = completionMarker(record);
              return <li key={record.id} data-check-session={record.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span>{marker ? t('jobo.view.completedAt', { time: `${marker.date !== date ? `${civilDate(marker.date)} · ` : ''}${formatTime(marker.time)}` })
                  : interval(record.date, record.startTime, record.endDate, record.endTime)}</span>
                <span data-progress={record.progress} className={`text-xs ${textSecondary}`}>{progressText(record.progress, t)}</span>
                {record.timingBasis === 'planDuration' && <span className={`text-xs ${textSecondary}`} title={t('jobo.view.inferredPlanDuration')}>{t('jobo.view.estimatedShort')}</span>}
              </li>;
            })}
          </ol>
          {item.attempts.length > 1 && <p className={`text-xs mt-1 ${textSecondary}`} data-check-latest>
            {t('jobo.check.sessions', { count: item.attempts.length })}
            {journal.invalidRecordCount === 0 && item.latestAttempt && <> · {t('jobo.view.latestShort')}: {progressText(item.latestAttempt.progress, t)}</>}
          </p>}
        </div>
      </div>
      {summaries.length > 0 && <p className="flex flex-wrap gap-x-2 gap-y-1 mt-2 text-xs" data-check-summary>
        {summaries.map((row, index) => <span key={row.key} title={row.title}>{index > 0 && ' · '}{row.text}</span>)}
      </p>}
      {timings.length > 0 && <p className={`flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs ${textSecondary}`} data-check-timing>
        {timings.map((row, index) => <span key={row.key}>{index > 0 && ' · '}{row.text}</span>)}
      </p>}
      {item.comparisonMeta?.hasEstimatedAttempts && <p className={`text-xs mt-1 ${textSecondary}`}>{t('jobo.view.inferredHint')}</p>}
      {hasOtherDays && <p className={`text-xs mt-1 ${textSecondary}`}>{t('jobo.check.otherDays')}</p>}
    </li>;
  };
  return <article data-jobo-check-journal className="text-sm leading-relaxed break-words space-y-5">
    {journal.invalidRecordCount > 0 && <p role="status" className="text-amber-600 dark:text-amber-400">{t('jobo.check.incomplete')}</p>}
    {!journal.planned.length && !journal.unplanned.length && journal.invalidRecordCount === 0 && <p role="status" className={textSecondary}>{t('jobo.check.noRecords')}</p>}
    {journal.planned.length > 0 && <section data-check-section="planned">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${textSecondary}`}>{t('jobo.check.planned')}</h3>
      <ol>{journal.planned.map(entry)}</ol>
    </section>}
    {journal.unplanned.length > 0 && <section data-check-section="unplanned">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${textSecondary}`}>{t('jobo.view.summary.unplanned')}</h3>
      <ol>{journal.unplanned.map(entry)}</ol>
    </section>}
  </article>;
}

// Keep the accepted shell. The journal blocks planner shortcuts. The notes
// destination uses the same shell, but lets the native notes editor handle
// its own keys; it is navigation out of Check, not a new Check writer.
export function CheckDialog({ title, subtitle, onClose, children, reading = true,
  cardBg = 'bg-white', textPrimary = '', textSecondary = '', borderClass = '', darkMode = false }) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const root = dialog.current;
    root?.querySelector('button')?.focus();
    const keyboard = event => {
      const editing = event.target?.matches?.('textarea,input,[contenteditable="true"]');
      if (event.key === 'Escape' && (reading || !editing)) {
        event.preventDefault(); event.stopImmediatePropagation(); close.current(); return;
      }
      if (event.key === 'Tab') {
        const fields = [...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];
        const first = fields[0], last = fields.at(-1);
        if (!root.contains(document.activeElement) || document.activeElement === (event.shiftKey ? first : last)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        }
      }
      if (reading) event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [reading]);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3 sm:p-6"
      onKeyDown={event => event.stopPropagation()}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
        data-jobo-check-panel={reading ? '' : undefined} data-jobo-check-notes={reading ? undefined : ''}
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-xl ${cardBg} ${textPrimary} ${borderClass}`}>
        <header className={`px-5 py-3 border-b flex-shrink-0 flex items-center justify-between gap-3 ${borderClass}`}>
          <h2 id={titleId} className="font-semibold min-w-0 break-words">{title} <span className={`text-sm font-normal ${textSecondary}`}>{subtitle}</span></h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className={`p-2 rounded-lg flex-shrink-0 ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={18} /></button>
        </header>
        <div tabIndex={0} role="region" aria-label={typeof title === 'string' ? title : t('task.notes')}
          className="overflow-y-auto px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
          {children}
        </div>
      </div>
    </div>, document.body,
  );
}

export default function CheckPanel(props) {
  const { t } = useTranslation();
  return <CheckDialog {...props} title={t('jobo.check.title')} subtitle={props.date}>
    <CheckJournal {...props} />
  </CheckDialog>;
}
