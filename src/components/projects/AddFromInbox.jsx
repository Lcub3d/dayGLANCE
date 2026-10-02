import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Inbox, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { extractTags } from '../../utils/taskUtils.js';
import { assignInboxTasks, inboxCandidates } from '../../utils/inboxToProject.js';

/**
 * A Project card's "Add from Inbox": a button in the card's header beside
 * the goal button, and a list of the Inbox tasks in no project, to tick and
 * add to this one (utils/inboxToProject.js), without leaving the Goals &
 * Projects workspace. A dialog on desktop, a bottom sheet on the phone.
 */
export default function AddFromInbox({ project, parentGoal, buttonClass }) {
  const { t } = useTranslation();
  const {
    unscheduledTasks, setUnscheduledTasks, pushUndo, setUndoToast,
    isMobile, darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();
  const { isVisibleForUser } = useFeaturesCtx();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const close = () => { setOpen(false); setChosen(new Set()); setFilter(''); };

  const candidates = useMemo(
    () => (open ? inboxCandidates(unscheduledTasks, isVisibleForUser) : []),
    [open, unscheduledTasks, isVisibleForUser],
  );
  const needle = filter.trim().toLowerCase();
  const shown = needle ? candidates.filter((task) => task.title.toLowerCase().includes(needle)) : candidates;
  // A ticked task that has left the Inbox since (synced elsewhere) is not counted.
  const count = candidates.filter((task) => chosen.has(task.id)).length;

  const toggle = (id) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const add = () => {
    if (!count) return;
    pushUndo?.();
    setUnscheduledTasks((prev) => assignInboxTasks(prev, [...chosen], project, parentGoal));
    setUndoToast?.({ message: t('goals.addedFromInbox', { count, project: project.title }), actionable: true });
    close();
  };

  // Escape closes this list and nothing behind it: the window's capture
  // phase runs before the workspace's own Escape chain on the document.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false); setChosen(new Set()); setFilter('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const list = (
    <div data-add-from-inbox={project.id} className="flex flex-col gap-3 min-h-0" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${textPrimary} truncate min-w-0`}>{t('goals.addFromInboxTo', { project: project.title })}</span>
        <button type="button" onClick={close} className={`p-1 rounded-lg ${hoverBg} flex-shrink-0`} aria-label={t('common.close')}>
          <X size={16} className={textSecondary} />
        </button>
      </div>
      {candidates.length > 0 ? (
        <>
          {candidates.length > 6 && (
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus={!isMobile}
              placeholder={t('goals.filterInbox')}
              aria-label={t('goals.filterInbox')}
              className={`w-full px-3 py-2 text-sm border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400'}`}
            />
          )}
          <ul className="flex flex-col gap-0.5 overflow-y-auto max-h-[50vh] -mx-1 px-1" role="group" aria-label={t('goals.inboxTasks')}>
            {shown.map((task) => {
              const on = chosen.has(task.id);
              const tags = extractTags(task.title);
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    data-inbox-candidate={task.id}
                    onClick={() => toggle(task.id)}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left ${hoverBg}`}
                  >
                    <span className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${on ? 'bg-blue-600 border-blue-600 text-white' : borderClass}`}>
                      {on && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} aria-hidden="true" />
                    <span className={`text-sm ${textPrimary} truncate flex-1 min-w-0`}>{renderTitleWithoutTags(task.title)}</span>
                    {tags.length > 0 && <span className={`text-xs ${textSecondary} truncate max-w-[40%]`}>{tags.map((tag) => `#${tag}`).join(' ')}</span>}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className={`text-sm ${textSecondary} px-2 py-2`}>{t('goals.noInboxMatch')}</li>}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              data-add-from-inbox-confirm
              disabled={!count}
              onClick={add}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {count ? t('goals.addTasks', { count }) : t('goals.chooseTasks')}
            </button>
            <button type="button" onClick={close} className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-stone-200 text-stone-700'}`}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      ) : (
        <p className={`text-sm ${textSecondary}`}>{t('goals.inboxEmptyForProjects')}</p>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        data-add-from-inbox-toggle
        onClick={() => setOpen(true)}
        className={buttonClass}
        title={t('goals.addFromInbox')}
        aria-label={t('goals.addFromInbox')}
        aria-haspopup="dialog"
      >
        <Inbox size={12} />
      </button>
      {open && createPortal(
        isMobile ? (
          <div className="fixed inset-0 z-[75] flex flex-col justify-end" onClick={close} role="dialog" aria-modal="true" aria-label={t('goals.addFromInbox')}>
            <div className="absolute inset-0 bg-black/50" />
            <div className={`relative ${cardBg} rounded-t-2xl shadow-xl px-4 pt-4 border-t ${borderClass} max-h-[85vh] flex flex-col`} style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }} onClick={(e) => e.stopPropagation()}>
              {list}
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-[75] bg-black/50 flex items-center justify-center p-4" onClick={close} role="dialog" aria-modal="true" aria-label={t('goals.addFromInbox')}>
            <div className={`${cardBg} rounded-2xl shadow-2xl w-full max-w-md p-5 max-h-[85vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
              {list}
            </div>
          </div>
        ),
        document.body,
      )}
    </>
  );
}
