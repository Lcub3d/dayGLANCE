import React from 'react';
import { NotebookPen, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString, formatShortDate } from '../utils/taskUtils.js';
import { MiniHabitRing } from './HabitRing.jsx';

// The day header every view shares: the date, the daily-note and focus-log
// buttons, past-day habit rings, and a tap that starts a new all-day task on
// that day. MULTI draws one per visible day, the phone header one for its
// day, MONTH one for the selected day; WEEK, SCHED's date strip and SCHED's
// day groups take just the buttons (DayHeaderActions) beside their own
// labels. One place, so the four views cannot drift apart again.

/** The daily-note and focus-log buttons for a day. Stops propagation so a parent's tap target keeps its own meaning. */
export function DayHeaderActions({ dateStr, size = 14, className = '' }) {
  const { t } = useTranslation();
  const { dailyNotes, setDailyNotesModalDate } = useDayPlannerCtx();
  const { focusLog, setFocusLogModalDate } = useFeaturesCtx();
  const hasNote = !!dailyNotes?.[dateStr]?.text;
  const hasFocus = (focusLog?.[dateStr]?.totalMinutes || 0) > 0;
  const btn = 'p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors';
  return (
    <span data-day-header-actions={dateStr} className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setDailyNotesModalDate?.(dateStr); }}
        className={`${btn} ${hasNote ? '' : 'opacity-50'}`}
        title={t('common.dailyNote')}
        aria-label={t('common.dailyNote')}
        data-day-note={hasNote ? 'present' : 'empty'}
      >
        <NotebookPen size={size} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setFocusLogModalDate?.(dateStr); }}
        className={`${btn} ${hasFocus ? '' : 'opacity-50'}`}
        title={t('app.focusLog')}
        aria-label={t('app.focusLog')}
        data-day-focus={hasFocus ? 'present' : 'empty'}
      >
        <Target size={size} />
      </button>
    </span>
  );
}

/** A past day's habit rings, when habits are on and that day has a log. Nothing for today or the future. */
export function DayHabitRings({ dateStr }) {
  const { darkMode } = useDayPlannerCtx();
  const { habitsEnabled, habitLogs, activeHabits, setHabitDayPopup } = useFeaturesCtx();
  const todayStr = dateToString(new Date());
  if (!habitsEnabled || dateStr >= todayStr || !habitLogs?.[dateStr] || !activeHabits?.length) return null;
  const weekday = new Date(`${dateStr}T12:00:00`).getDay();
  const habits = activeHabits.filter((h) => (h.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6]).includes(weekday)).slice(0, 6);
  if (habits.length === 0) return null;
  return (
    <div data-day-habit-rings className="flex items-center justify-center gap-0.5 mt-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setHabitDayPopup?.(dateStr); }}>
      {habits.map((habit) => (
        <MiniHabitRing key={habit.id} habit={habit} count={habitLogs[dateStr]?.[habit.id] || 0} darkMode={darkMode} />
      ))}
    </div>
  );
}

/**
 * The whole header cell for one day.
 *
 * @param {object} props
 * @param {Date} props.date
 * @param {string} [props.className]  layout and highlight classes from the caller (flex-1, borders, drag-over)
 * @param {boolean} [props.compact]   the phone header's smaller title
 * @param {string} [props.title]      tooltip override (a drag target says "drop to make all-day")
 * @param {() => void} [props.onClick]  default: start a new all-day task on this day
 * Any other props (drag handlers) land on the cell element.
 */
export default function DayHeaderCell({ date, className = '', compact = false, title, onClick, ...rest }) {
  const { t } = useTranslation();
  const { darkMode, cardBg, textPrimary, openNewAllDayTask } = useDayPlannerCtx();
  const dateStr = dateToString(date);
  const isToday = dateStr === dateToString(new Date());
  const background = isToday
    ? (darkMode ? 'bg-blue-900/30 hover:bg-blue-900/50' : 'bg-blue-50 hover:bg-blue-100')
    : `${cardBg} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`;
  return (
    <div
      data-day-header={dateStr}
      data-today={isToday ? 'true' : undefined}
      className={`py-2 px-3 text-center cursor-pointer transition-colors ${background} ${className}`}
      style={{ minHeight: 'var(--header-row-h)' }}
      onClick={onClick || (() => openNewAllDayTask?.(dateStr))}
      title={title || `${t('task.addTask')}: ${t('task.allDay')}`}
      {...rest}
    >
      <div className={`font-bold ${compact ? 'text-sm' : ''} flex items-center justify-center gap-1.5 ${isToday ? 'text-blue-600' : textPrimary}`}>
        {formatShortDate(date)}
        <DayHeaderActions dateStr={dateStr} />
      </div>
      <DayHabitRings dateStr={dateStr} />
    </div>
  );
}
