import React, { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { planHistory } from '../utils/originalPlan.js';
import { formatShortDate } from '../utils/taskUtils.js';
import { formatLocalizedDurationMinutes } from '../utils/localeFormatting.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// Reveals what a task was ORIGINALLY planned for, next to where it sits now.
//
// This is the first thing in the app to read `originalPlan` (utils/originalPlan.js),
// and it exists for two reasons. The obvious one is that a rescheduled task
// losing its original intention was the gap #1623 opened with. The less obvious
// one is that a field nothing reads can be silently wrong for months: the
// baseline shipped once already in a state where it never survived a sync cycle,
// and the only way to notice was a console query. This makes that check part of
// using the app.
//
// It renders NOTHING when there is no story to tell — no baseline recorded, or
// the task is still exactly where it was first put. An affordance on every task
// that opens to say "nothing happened" is worse than no affordance, and most
// tasks are in that state.
//
// The icon is lucide's `History` (a clock with a turn-back arrow) rather than
// `Clock`, which the card already uses for the task's CURRENT start time. Two
// clocks side by side meaning different things would be worse than precise.
// The panel body, exported so a test can render it directly. Everything inside
// only ever runs while the popover is open, which is precisely the code a static
// render of the closed badge cannot reach.
export function PlanHistoryPanel({ history, task, formatTime }) {
  const { t } = useTranslation();
  const { plan, changed } = history;

  // A changed value is stated plainly; an unchanged one is dimmed, so the eye
  // lands on what actually moved rather than on three values of equal weight.
  const part = (value, didChange) => (
    <span className={didChange ? 'font-semibold' : 'opacity-60'}>{value}</span>
  );

  const row = (date, startTime, duration) => (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {part(formatShortDate(new Date(`${date}T12:00:00`)), changed.date)}
      <span className="opacity-40">·</span>
      {part(formatTime(startTime), changed.startTime)}
      {typeof duration === 'number' && (<>
        <span className="opacity-40">·</span>
        {part(formatLocalizedDurationMinutes(duration), changed.duration)}
      </>)}
    </div>
  );

  return (
    <>
      <div className="opacity-60 mb-0.5">{t('task.originallyPlanned')}</div>
      {row(plan.date, plan.startTime, plan.duration)}
      <div className="opacity-60 mt-1.5 mb-0.5">{t('task.nowScheduled')}</div>
      {row(task.date, task.startTime, task.duration)}
    </>
  );
}

export default function TaskPlanHistory({ task }) {
  const { t } = useTranslation();
  const { formatTime } = useDayPlannerCtx();
  const [open, setOpen] = useState(false);
  // Fixed coordinates, measured from the button when it opens. An absolutely
  // positioned panel is clipped by the timeline column and by the card itself —
  // a WEEK column is narrower than this panel — so it has to escape both.
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  const PANEL_WIDTH = 230;
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        top: r.bottom + 4,
        // Clamped to the viewport so a task at either edge still reads.
        left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8)),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e) => { if (!ref.current?.contains(e.target)) close(); };
    const onKeyDown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // A fixed panel does not follow its anchor, so a resize retires it rather
    // than leaving it over an unrelated part of the timeline. Deliberately NOT
    // listening for scroll in the capture phase: the click that opens the panel
    // can itself scroll the card into view, and that closed the panel instantly.
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const history = planHistory(task);
  if (!history) return null;

  return (
    <span ref={ref} className="relative flex-shrink-0 inline-flex">
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="hover:bg-white/20 rounded p-0.5 transition-colors opacity-75 hover:opacity-100"
        title={t('task.planHistory')}
        aria-expanded={open}
      >
        <History size={12} />
      </button>
      {open && pos && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH }}
          className="z-50 rounded-lg shadow-xl border p-2 text-xs
                     bg-white dark:bg-gray-800 text-gray-800 dark:text-white
                     border-stone-300 dark:border-gray-700"
        >
          <PlanHistoryPanel history={history} task={task} formatTime={formatTime} />
        </div>
      )}
    </span>
  );
}
