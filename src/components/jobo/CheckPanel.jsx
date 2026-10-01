import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { stripWikilinks } from '../../utils/taskUtils.js';
import { taskColorToHex } from '../../utils/colorUtils.js';
import { summaryRows, timingRows } from './ExecutionAxes.jsx';
import { buildCheckJournal, journalDate, journalMoment, journalPlanRange, journalRange } from './checkJournal.js';
import { CARRY_ACTION, checkEntryAction } from '../../jobo/carryForward.js';

const clock = value => value;
const progressText = (progress, t) => t(progress === 'completed' ? 'common.completed' : `jobo.view.progress.${progress}`);

const linkButton = 'inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 underline underline-offset-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500';

// What an entry offers once read (docs/jobo-carry-forward.md), picked by
// carryForward.js from the task as it is now. The actions are the app's task
// actions, passed in as `carry`; this panel never writes a task or a Do.
function EntryCarry({ entry, date, today, carry, outcome, setOutcome, undoable, onUndo, formatTime, language, textSecondary }) {
  const { t } = useTranslation();
  const action = checkEntryAction(entry, { date, today });
  const slotText = slot => slot.isAllDay ? journalDate(slot.date, language, date)
    : `${journalDate(slot.date, language, date)} ${formatTime(slot.startTime)}`;
  const label = title => `${title}: ${stripWikilinks(entry.title)}`;
  // A continuation reads as one until the task is moved again, or undone.
  const stillThere = action.kind === CARRY_ACTION.MOVED && action.slot.date === outcome?.slot?.date
    && action.slot.startTime === outcome.slot.startTime;
  if (outcome?.kind === 'continued' && stillThere) {
    return <p role="status" data-check-carry="continued" className="text-xs flex flex-wrap items-center gap-x-2">
      <span>{t('jobo.check.continued', { slot: slotText(outcome.slot) })}</span>
      {undoable && onUndo && <button type="button" data-check-undo onClick={onUndo} className={linkButton}>{t('shortcuts.undoAction')}</button>}
    </p>;
  }
  if (outcome?.kind === 'clash' && action.kind === CARRY_ACTION.CONTINUE) {
    return <p role="alert" data-check-carry="clash" className="text-xs flex flex-wrap items-center gap-x-2 text-amber-700 dark:text-amber-400">
      <span>{outcome.title ? t('jobo.check.clash', { slot: slotText(outcome.slot), event: outcome.title })
        : t('jobo.check.clashUnnamed', { slot: slotText(outcome.slot) })}</span>
      <button type="button" data-check-edit onClick={() => carry.editOn(action.task, action.slot.date)}
        aria-label={label(t('common.edit'))} className={linkButton}>{t('common.edit')}</button>
    </p>;
  }
  switch (action.kind) {
    case CARRY_ACTION.CONTINUE: {
      const { slot } = action;
      const text = slot.isAllDay ? t('jobo.check.continueAllDay', { slot: slotText(slot) })
        : t('jobo.check.continue', { slot: slotText(slot), minutes: slot.duration });
      return <p data-check-carry="continue"><button type="button" data-check-continue
        onClick={() => {
          const result = carry.continueTask(action, date);
          if (result?.moved) setOutcome({ kind: 'continued', slot });
          else if (result?.conflict) setOutcome({ kind: 'clash', slot, title: result.conflict.title });
        }}
        aria-label={label(text)} className={linkButton}>{text}</button></p>;
    }
    case CARRY_ACTION.FOLLOW_UP:
      return <p data-check-carry="followUp"><button type="button" data-check-follow-up
        onClick={() => carry.openFollowUp(action.task, today)}
        aria-label={label(t('jobo.check.followUp'))} className={linkButton}>{t('jobo.check.followUp')}</button></p>;
    case CARRY_ACTION.SCHEDULE:
      return <p data-check-carry="schedule"><button type="button" data-check-schedule
        onClick={() => carry.editOn(action.task, action.date)}
        aria-label={label(t('jobo.check.schedule'))} className={linkButton}>{t('jobo.check.schedule')}</button></p>;
    case CARRY_ACTION.MOVED:
      return <p data-check-carry="moved" className={`text-xs ${textSecondary}`}>{t('jobo.check.next', { slot: slotText(action.slot) })}</p>;
    default:
      return null;
  }
}

// The journal reads existing executions. Its actions are navigation to the
// task's native notes and, with `carry`, the task actions above; it never
// edits a Do.
export function CheckJournal({ model, date, loaded, error, onOpenNotes, formatTime = clock,
  textSecondary = '', borderClass = '', today, carry, onUndo }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const entries = useMemo(() => loaded && model ? buildCheckJournal(model, date) : null, [loaded, model, date]);
  // What each Continue click did, by entry. Only the latest continuation can
  // be undone from here: the app's undo takes the newest step.
  const [outcomes, setOutcomes] = useState({});
  const [lastContinued, setLastContinued] = useState(null);
  if (error) return <p role="alert">{t('jobo.check.unavailable')}</p>;
  if (!entries) return <p role="status">{t('common.loading')}</p>;
  const invalid = model.invalidRecordCount > 0;
  return <article data-jobo-check-journal className="space-y-4 text-sm leading-relaxed break-words">
    {invalid && <p role="status" className="text-amber-600 dark:text-amber-400">{t('jobo.check.invalid')}</p>}
    {!invalid && !entries.length && <p role="status" className={textSecondary}>{t('jobo.check.noRecords')}</p>}
    <ol className={`divide-y ${borderClass}`}>
      {entries.map(entry => {
        const task = entry.sourceTask;
        const color = taskColorToHex(task?.color || entry.task?.color || 'bg-purple-500', task?.nativeCalendarColor);
        const planned = journalPlanRange(entry.plan, date, formatTime, language);
        // Reuse the card's vocabulary, including its incomplete/estimated rules.
        // Invalid ledger input cannot justify a complete timing comparison.
        const summaries = invalid ? [] : summaryRows(entry.labels, entry.comparison, t);
        const timings = invalid ? [] : timingRows(entry.comparison, t).filter(row => row.state);
        return <li key={entry.id} data-check-entry={entry.id} className="py-3 first:pt-0 last:pb-0 space-y-2 min-w-0">
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="flex items-start gap-2 min-w-0">
              <span aria-hidden="true" data-check-swatch className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h3 className="font-semibold min-w-0 break-words">{renderTitleWithoutTags(entry.title)}</h3>
            </div>
            {task?.id != null && entry.noteKey && onOpenNotes && <button type="button" data-check-notes
              onClick={() => onOpenNotes(task)} aria-label={`${t('task.notes')}: ${stripWikilinks(entry.title)}`}
              className="inline-flex items-center gap-1 shrink-0 text-xs text-blue-600 dark:text-blue-400 underline underline-offset-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500">
              <FileText size={13} aria-hidden="true" />{t('task.notes')}
            </button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className={`text-xs ${textSecondary}`}>{t('jobo.view.plan')}</p>
              <p data-check-plan>{planned || t('jobo.view.noTimedPlan')}</p>
            </div>
            <div className="min-w-0">
              <p className={`text-xs ${textSecondary}`}>{t('jobo.check.actual')}</p>
              <ol className="space-y-1">
                {entry.sessions.map((record, index) => {
                  const moment = journalMoment(record);
                  const timed = record.timing === 'timed';
                  return <li key={record.id} data-check-session={record.id} className="min-w-0">
                    {entry.sessions.length > 1 && <span className={`text-xs ${textSecondary}`}>{t('jobo.check.session', { number: index + 1 })}{' · '}</span>}
                    <span data-check-actual>{timed
                      ? journalRange(record.date, record.startTime, record.endDate, record.endTime, date, formatTime, language)
                      : t('jobo.check.untimed')}</span>
                    <span data-check-progress={record.progress} className="text-xs">{' · '}{progressText(record.progress, t)}</span>
                    {!timed && moment && <p className={`text-xs ${textSecondary}`} data-check-completion>
                      {t('jobo.view.completedAt', { time: `${moment.date !== date ? `${journalDate(moment.date, language, date)} ` : ''}${formatTime(moment.time)}` })}
                    </p>}
                    {record.timingBasis === 'planDuration' && <p className={`text-xs ${textSecondary}`}>{t('jobo.view.inferredPlanDuration')}</p>}
                  </li>;
                })}
              </ol>
            </div>
          </div>
          {entry.sessions.length > 1 && entry.latestAttempt && <p className="text-xs" data-check-latest>
            {t('jobo.view.latestShort')}: {progressText(entry.latestAttempt.progress, t)}
          </p>}
          {summaries.length > 0 && <p className="text-xs flex flex-wrap gap-x-2 gap-y-1" data-check-summary>
            {summaries.map(row => <span key={row.key} title={row.title}>{row.text}</span>)}
          </p>}
          {timings.length > 0 && <p className={`text-xs ${textSecondary}`} data-check-timing>{timings.map(row => row.text).join(' · ')}</p>}
          {carry && today && <EntryCarry {...{ entry, date, today, carry, formatTime, language, textSecondary, onUndo: onUndo && (() => {
            onUndo();
            setOutcomes(({ [entry.id]: _, ...rest }) => rest);
            setLastContinued(null);
          }) }}
            outcome={outcomes[entry.id]} undoable={lastContinued === entry.id}
            setOutcome={outcome => {
              setOutcomes(prev => ({ ...prev, [entry.id]: outcome }));
              if (outcome.kind === 'continued') setLastContinued(entry.id);
            }} />}
        </li>;
      })}
    </ol>
  </article>;
}

export default function CheckPanel({ model, date, loaded, error, onClose, onOpenNotes, formatTime, today, carry, onUndo,
  cardBg = 'bg-white', textPrimary = '', textSecondary = '', borderClass = '', darkMode = false }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
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
      // Give focus back only if nothing else took it: an action that opens
      // the task form closes this dialog, and the form's title is focused.
      const active = document.activeElement;
      const unclaimed = !active || active === document.body || root?.contains(active);
      if (previous?.isConnected && unclaimed) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3 sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-jobo-check-panel
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-xl ${cardBg} ${textPrimary} ${borderClass}`}>
        <header className={`px-5 py-3 border-b flex-shrink-0 flex items-center justify-between gap-3 ${borderClass}`}>
          <h2 id={titleId} className="font-semibold">{t('jobo.check.title')} <span className={`text-sm font-normal ${textSecondary}`}>{journalDate(date, language)}</span></h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={18} /></button>
        </header>
        <div tabIndex={0} role="region" aria-label={t('jobo.check.title')} className="overflow-y-auto px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
          <CheckJournal {...{ model, date, loaded, error, textSecondary, borderClass, onOpenNotes, formatTime, today, carry, onUndo }} />
        </div>
      </div>
    </div>, document.body,
  );
}
