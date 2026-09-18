import React, { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dateToString, stripWikilinksAndTags } from '../utils/taskUtils.js';
import { starredOn, overGuideline, STAR_GUIDELINE } from '../utils/starredTasks.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// The header's entry to today's key tasks (#1684).
//
// WHY IT IS ABOUT TODAY AND NOT THE VIEWED RANGE
// A star is a statement about one day, and the per-day stars are already legible
// while planning: every card carries its own. What was missing is the other half,
// keeping the few that matter in front of you while you work, and that is a TODAY
// need rather than a per-column one. Scoping it to today is what lets one control
// serve DAY, WEEK, MULTI, MONTH and SCHED identically — there is no seven of it
// in WEEK, no thirty-five in MONTH, and no per-view layout question.
//
// WHY IT LIVES IN THE HEADER
// Every other candidate costs something the app cannot spare: the all-day row is
// conventional and load-bearing (you drag work in and out of it), timeline height
// is scarce and scarcest in MONTH, and a third panel tab would need a mobile
// bottom-nav slot that does not exist. The header already hosts exactly this
// shape in DayDialIcon — a compact entry to a richer surface, mirrored between
// desktop and mobile — so this follows it.
//
// It renders NOTHING when today has no starred tasks, which for most people on
// most days is always. That is what makes another control in a busy header
// acceptable: it is absent until it has something to say.
// The two headers place and style their entries differently: the desktop cluster
// gives each button a filled chip in a flex row, while the mobile header floats
// its controls absolutely in the flanks either side of a centred wordmark.
//
// `wrapperClass` is where POSITIONING goes and `buttonClass` where styling does,
// and the split is not cosmetic: the inner span is the popover's containing
// block, so an `absolute` passed to the button would position it against that
// span instead of the header, and anchor the popover in the wrong place too.
//
// Positioning also needs its OWN element rather than sharing the inner one.
// Tailwind emits `.relative` after `.absolute`, so the two on one element
// resolve to relative regardless of the order they are written in, and the
// control silently stays in the flow.
export default function TodayKeyTasks({ size = 18, wrapperClass = '', buttonClass, align = 'right' }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const { getTasksForDate, goToDate, scrollToHour, formatTime, darkMode, textSecondary, hoverBg } = ctx ?? {};
  if (!getTasksForDate) return null;

  const today = new Date();
  const todayStr = dateToString(today);
  const starred = starredOn(getTasksForDate(today), todayStr);
  if (!starred.length) return null;

  // Land on today and on the hour the task starts, the same way the Day Dial
  // opens a block in the planner.
  const openInPlanner = (task) => {
    setOpen(false);
    goToDate?.(today);
    if (task.startTime && !task.isAllDay) setTimeout(() => scrollToHour?.(task.startTime), 150);
  };

  return (
    <span className={wrapperClass || undefined}>
    <span ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className={buttonClass
          ?? `p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} flex items-center gap-1`}
        title={t('task.keyTasksToday')}
        aria-expanded={open}
      >
        <span className="flex items-center gap-1">
          <Star size={size} fill="currentColor" className={textSecondary} />
          <span className={`text-xs font-semibold ${textSecondary}`}>{starred.length}</span>
        </span>
      </button>
      {open && (
        <div
          className={`absolute top-full ${align === 'left' ? 'left-0' : 'right-0'} mt-1 z-50 rounded-lg shadow-xl border p-1 min-w-[220px] max-w-[320px]
            ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-stone-300 text-stone-900'}`}
        >
          <div className={`px-2 py-1 text-[11px] uppercase tracking-wide ${textSecondary}`}>
            {t('task.keyTasksToday')}
          </div>
          {starred.map((task) => (
            <button
              key={task.id}
              onClick={() => openInPlanner(task)}
              className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-sm ${hoverBg}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
              <span className={`flex-1 min-w-0 truncate ${task.completed ? 'line-through opacity-60' : ''}`}>
                {stripWikilinksAndTags(task.title)}
              </span>
              {task.startTime && !task.isAllDay && (
                <span className={`text-xs flex-shrink-0 ${textSecondary}`}>{formatTime?.(task.startTime)}</span>
              )}
            </button>
          ))}
          {overGuideline(getTasksForDate(today), todayStr) && (
            // A nudge, not a limit. Nothing anywhere refuses a fourth star; this
            // just says out loud that the day has stopped being a short list.
            <div className={`px-2 pt-1.5 pb-1 text-[11px] ${textSecondary}`}>
              {t('task.keyTasksOverGuideline', { count: STAR_GUIDELINE })}
            </div>
          )}
        </div>
      )}
    </span>
    </span>
  );
}
