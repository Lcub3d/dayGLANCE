import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderFormattedText } from '../utils/textFormatting.jsx';
import { formatShortDate } from '../utils/taskUtils.js';
import { doneDateOf, plainTitle } from '../utils/followUp.js';

const civil = (date) => new Date(`${date}T12:00:00`);

/**
 * A task a note links to (utils/followUp.js), shown read-only over whatever
 * is open, the task form included, so following the link never costs the
 * form its unsaved typing. Its own notes keep their links, so a chain of
 * follow-ups can be walked back. `onShow`, when given, closes this and goes
 * to the task where it lives.
 */
export default function TaskPeek({ found, onClose, onShow, darkMode }) {
  const { t } = useTranslation();
  const closeRef = useRef(null);

  // Escape closes this alone: caught before the form's own Escape.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  useEffect(() => { closeRef.current?.focus(); }, [found]);

  const task = found?.task;
  const panel = darkMode ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-white text-stone-900 border-stone-200';
  const muted = darkMode ? 'text-gray-400' : 'text-stone-500';
  const where = !task ? null
    : found.where === 'deleted' ? t('followUp.peekDeleted')
      : task.date ? t('followUp.peekOn', { date: formatShortDate(civil(task.date)) })
        : t('followUp.peekInbox');
  const done = task?.completed
    ? t('followUp.peekDone', { date: formatShortDate(civil(doneDateOf(task, task.date || ''))) })
    : t('followUp.peekNotDone');
  const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40" onClick={onClose} data-task-peek>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('followUp.peekTitle')}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md max-h-[80vh] flex flex-col rounded-xl border shadow-2xl ${panel}`}
      >
        <div className="flex items-start gap-2 px-4 pt-3 pb-2">
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>{t('followUp.peekTitle')}</div>
            {task && (
              <div className={`mt-0.5 font-semibold break-words ${task.completed ? 'line-through opacity-70' : ''}`} data-task-peek-title>
                {plainTitle(task.title)}
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')}
            className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`}>
            <X size={16} />
          </button>
        </div>
        {task ? (
          <div className="px-4 pb-3 overflow-y-auto space-y-2">
            <div className={`text-xs ${muted}`} data-task-peek-status>{done} · {where}</div>
            {task.notes?.trim() && (
              <div className={`text-sm whitespace-pre-wrap p-2 rounded ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}>
                {renderFormattedText(task.notes)}
              </div>
            )}
            {subtasks.length > 0 && (
              <ul className="space-y-1">
                {subtasks.map(sub => (
                  <li key={sub.id} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center ${sub.completed ? 'bg-green-500/30 border-green-500' : 'border-current opacity-40'}`}>
                      {sub.completed && <Check size={10} />}
                    </span>
                    <span className={sub.completed ? 'line-through opacity-60' : ''}>{sub.title}</span>
                  </li>
                ))}
              </ul>
            )}
            {onShow && found.where !== 'deleted' && (
              <div className="pt-1 flex justify-end">
                <button type="button" onClick={onShow} data-task-peek-show
                  className="text-sm font-medium text-blue-500 hover:text-blue-400">
                  {t('followUp.peekShow')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={`px-4 pb-4 text-sm ${muted}`} data-task-peek-gone>{t('followUp.peekGone')}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
