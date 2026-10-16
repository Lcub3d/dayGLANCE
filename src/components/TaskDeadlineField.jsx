import React from 'react';
import { Calendar, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';

/**
 * The deadline control, shared by the desktop and mobile task editors.
 *
 * A deadline belongs to an INBOX task (the app's contract: scheduling strips
 * it, priority and deadline alike). "Inbox task" reaches the editor two ways,
 * which is why one component serves both flavors: the plain inbox flavor
 * (`newTask.openInInbox`), and a project task kept unscheduled
 * (`newTask.keepUnscheduled`) — the flavor the project row's own title opens.
 * Both are inbox tasks by the same rule (utils/pendingProject.js), so the field
 * is shown for them, and a project task is no exception: the project row's
 * picker already allowed a deadline, while this control used to be disabled
 * whenever a project was attached (#2116 review).
 *
 * It renders NOTHING for a scheduled task (it would offer a field the save
 * drops) and nothing for a recurring task (a series keeps one template and no
 * due date).
 *
 * `openUpward` is for the mobile sheet, whose fields sit above a
 * keyboard-anchored footer, so a dropdown below the button would fall off the
 * screen. The picker's open state, the theme, and the "select a date" jump into
 * the calendar popover all come from the day-planner context, exactly as the
 * two hand-written copies this replaces did.
 *
 * `newTask`/`setNewTask` stay the HOST modal's state: the field is one control
 * in a form, not a second source of truth.
 */
const TaskDeadlineField = ({ newTask, setNewTask, openUpward = false }) => {
  const {
    darkMode, borderClass, cardBg, textPrimary, textSecondary, hoverBg,
    showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker, setDeadlinePickerTaskId,
  } = useDayPlannerCtx();
  const { t } = useTranslation();

  // Which form of inbox task this is; see the header. A scheduled task and a
  // series take no deadline.
  const isInboxTask = !!(newTask.openInInbox || newTask.keepUnscheduled);
  if (!isInboxTask || newTask.recurrence) return null;

  const setDeadline = (deadline) => {
    setNewTask({ ...newTask, deadline });
    setShowNewTaskDeadlinePicker(false);
  };
  const inDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return dateToString(d);
  };
  const optionClass = `w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`;

  return (
    <div>
      <label className={`block text-sm ${textSecondary} mb-1`}>{t('task.deadline')}</label>
      <div className="relative deadline-picker-container">
        <button
          type="button"
          onClick={() => setShowNewTaskDeadlinePicker(!showNewTaskDeadlinePicker)}
          className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} flex items-center gap-2`}
        >
          <Calendar size={14} className={textSecondary} />
          {newTask.deadline
            ? formatLocalizedDate(new Date(newTask.deadline + 'T12:00:00'), { month: 'short', day: 'numeric' })
            : t('task.noDeadline')}
        </button>
        {showNewTaskDeadlinePicker && (
          <div className={`absolute ${openUpward ? 'bottom-12' : 'top-12'} left-0 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px] z-20`}>
            <div className="space-y-1">
              <button type="button" onClick={() => setDeadline(inDays(0))} className={optionClass}>
                <Calendar size={14} />
                {t('common.today')}
              </button>
              <button type="button" onClick={() => setDeadline(inDays(1))} className={optionClass}>
                <Calendar size={14} />
                {t('common.tomorrow')}
              </button>
              <button type="button" onClick={() => setDeadline(inDays(7))} className={optionClass}>
                <Calendar size={14} />
                {t('common.nextWeek', { defaultValue: 'Next week' })}
              </button>
              <div className={`border-t ${borderClass} my-1`}></div>
              <button
                type="button"
                onClick={() => {
                  setShowNewTaskDeadlinePicker(false);
                  setDeadlinePickerTaskId('newTask');
                }}
                className={optionClass}
              >
                <Calendar size={14} />
                {t('goals.selectDate')}
              </button>
              {newTask.deadline && (
                <>
                  <div className={`border-t ${borderClass} my-1`}></div>
                  <button type="button" onClick={() => setDeadline(null)} className={`${optionClass} text-red-500`}>
                    <X size={14} />
                    {t('task.clearDeadline', { defaultValue: 'Clear deadline' })}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskDeadlineField;
