import React, { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../utils/formatDuration.js';
import { CHECK_PRIORITIES, buildCheckSummary } from './checkSummary.js';

const TONES = { p1: 'text-red-500', p2: 'text-orange-500', p3: 'text-blue-500', p4: '', unknown: '' };

// Plain document, not a task list, dashboard, editor or saved reflection.
export function CheckSummary({ model, date, inboxTasks, loaded, error, textSecondary = '' }) {
  const { t, i18n } = useTranslation();
  const report = useMemo(() => loaded && model ? buildCheckSummary(model, { date, inboxTasks }) : null,
    [loaded, model, date, inboxTasks]);
  if (error) return <p role="alert">{t('jobo.check.unavailable')}</p>;
  if (!report) return <p role="status">{t('common.loading')}</p>;
  const r = report;
  const c = r.stats.comparison;
  const numbers = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, { maximumFractionDigits: 2 });
  const count = value => value == null ? '—' : numbers.format(value);
  const time = value => value == null ? '—' : formatDuration(value, t);
  const fact = value => r.clean ? count(value) : '—';
  const sentence = (key, values) => t(`jobo.check.${key}`, values);
  const priorityLine = (render, include = () => true) => (
    <p className={`text-xs leading-relaxed ${textSecondary}`}>
      {CHECK_PRIORITIES.filter(key => include(r.priorities[key])).map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 && ' · '}
          <span data-check-priority={key}>
            <span className={`font-semibold ${TONES[key]}`}>{key === 'unknown' ? sentence('unclassified') : key.toUpperCase()}</span>
            {' '}{render(r.priorities[key])}
          </span>
        </React.Fragment>
      ))}
    </p>
  );
  const section = (key, children) => <section data-check-section={key} className="space-y-1">
    <h3 className="font-semibold text-sm">{sentence(`sections.${key}`)}</h3>{children}
  </section>;
  const progressText = row => sentence('progress', Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fact(value)])));
  return <article data-jobo-check-text className="space-y-5 text-sm leading-relaxed break-words">
    <p className={`text-xs ${textSecondary}`}>{sentence('scope')}</p>
    {!r.doCount && r.clean && <p role="status" className={textSecondary}>{sentence('noRecords')}</p>}
    {!r.clean && <p role="status" className="text-amber-600 dark:text-amber-400">{sentence('invalid', { count: r.stats.invalidCount })}</p>}
    {section('completion', <>
      <p>{sentence('completion', { done: count(r.stats.native.completed), total: count(r.stats.native.total) })}</p>
      {priorityLine(row => `${count(row.completed)} / ${count(row.total)}`)}
      <p>{sentence('queues', { inbox: count(r.inboxCompleted), project: count(r.projectCompleted) })}</p>
      <p>{sentence('noDo', { value: fact(r.noDo) })}</p>
    </>)}
    {section('time', <>
      <p>{sentence('time', { planned: time(r.stats.native.plannedMinutes), recorded: time(r.stats.recordedMinutes) })}</p>
      {priorityLine(row => time(row.recordedMinutes))}
    </>)}
    {section('planChanges', <>
      <p>{sentence('changes', Object.fromEntries(['start', 'finish', 'duration', 'unchanged', 'unknown'].map(key => [key, fact(r.changes[key])])))}</p>
      {r.clean && priorityLine(row => sentence('changed', { count: row.changed }), row => row.changed > 0)}
    </>)}
    {section('deviations', <>
      <p>{sentence('comparable', { value: count(c.comparableCount), total: count(c.groupCount) })}</p>
      <p>{sentence('start', { early: fact(c.start.early), on: fact(c.start.onTime), late: fact(c.start.late) })}</p>
      <p>{sentence('finish', { early: fact(c.finish.early), on: fact(c.finish.onTime), late: fact(c.finish.late) })}</p>
      <p>{sentence('duration', { shorter: fact(c.duration.shorter), on: fact(c.duration.onEstimate), longer: fact(c.duration.longer) })}</p>
      <p>{sentence('maximum', { start: time(r.maxStart), finish: time(r.maxFinish), duration: time(r.maxLonger) })}</p>
      {r.clean && priorityLine(row => sentence('priorityDeviation', { start: row.lateStart, finish: row.lateFinish, longer: row.longer, total: row.comparable }), row => row.comparable > 0)}
      <p>{sentence('ratio', { min: count(r.minRatio), max: count(r.maxRatio), within: fact(r.withinPlan) })}</p>
    </>)}
    {section('structure', <>
      <p>{sentence('structure', { total: fact(r.doCount), single: fact(r.single), split: fact(r.split) })}</p>
      <p>{sentence('coverage', { raw: time(r.rawMinutes), recorded: time(r.stats.recordedMinutes), overlap: time(r.overlapMinutes) })}</p>
      <p>{sentence('groups', { gap: time(r.gapMinutes), span: time(r.maxSpanMinutes) })}</p>
      <p>{sentence('windows', { inside: time(r.insideMinutes), outside: time(r.outsideMinutes) })}</p>
      {r.clean && Object.keys(r.relations).length > 0 && <p>{sentence('relations')}{' '}{Object.entries(r.relations).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${sentence(`allen.${key}`)} ${count(value)}`).join(' · ')}</p>}
    </>)}
    {section('evidence', <>
      <p>{progressText(r.progress)}</p>
      {r.clean && priorityLine(row => Object.entries(row.progress).filter(([, value]) => value > 0)
        .map(([key, value]) => sentence(`progressItem.${key}`, { value: count(value) })).join(' / '), row => Object.values(row.progress).some(Boolean))}
      <p>{sentence('quality', { untimed: count(r.stats.untimedCount), inferred: count(r.stats.inferredCount), invalid: count(r.stats.invalidCount), excluded: count(c.excludedCount) })}</p>
      <p>{sentence('contexts', { planned: fact(r.contexts.planned), noPlan: fact(r.contexts.noPlan), unknown: fact(r.contexts.unknown) })}</p>
    </>)}
    <p className={`text-xs ${textSecondary}`}>{sentence('footnote')}</p>
  </article>;
}

export default function CheckPanel({ model, date, inboxTasks, loaded, error, onClose,
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
    // Block application shortcuts while reading, but retain ordinary text
    // selection, copying and scrolling. Tab and Escape belong to this dialog.
    const keyboard = event => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const fields = [...root.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
      const first = fields[0], last = fields.at(-1);
      if (!root.contains(document.activeElement) || document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3 sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-jobo-check-panel
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-xl ${cardBg} ${textPrimary} ${borderClass}`}>
        <header className={`px-5 py-3 border-b flex-shrink-0 flex items-center justify-between gap-3 ${borderClass}`}>
          <h2 id={titleId} className="font-semibold">{t('jobo.check.title')} <span className={`text-sm font-normal ${textSecondary}`}>{date}</span></h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={18} /></button>
        </header>
        <div tabIndex={0} role="region" aria-label={t('jobo.check.title')} className="overflow-y-auto px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
          <CheckSummary {...{ model, date, inboxTasks, loaded, error, textSecondary }} />
        </div>
      </div>
    </div>, document.body,
  );
}
