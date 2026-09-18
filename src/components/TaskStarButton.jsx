import React from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isStarred, toggleStar } from '../utils/starredTasks.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// Marks a task as one of the few you intend to move forward today (#1684).
//
// Always visible rather than revealed on hover, because the point of the feature
// is that the day's key tasks can be picked out of a crowded timeline at a
// glance; an affordance you have to go looking for cannot do that. Unstarred it
// sits at low opacity so a screen of tasks does not read as a screen of stars.
//
// Filled versus outline carries the state, not colour. Timeline cards come in a
// dozen background colours with white text while SCHED rows are on the card
// background, so `currentColor` is the only fill that reads correctly on all of
// them in both themes.
//
// Deliberately NOT tied to priority. A star is a property of today; priority is
// a property of the task. See utils/starredTasks.js.
export default function TaskStarButton({ task, size = 12 }) {
  const { t } = useTranslation();
  const setTasks = useDayPlannerCtx()?.setTasks;

  // The star is a statement about a particular day, so an undated task cannot
  // carry one. Without setTasks there is nothing to toggle, which is the case in
  // render-only surfaces such as the tray.
  if (!task?.date || !setTasks) return null;

  const starred = isStarred(task);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setTasks((prev) => prev.map((x) => (String(x.id) === String(task.id) ? toggleStar(x) : x)));
      }}
      className={`rounded p-0.5 transition-colors flex-shrink-0 hover:bg-white/20 ${
        starred ? 'opacity-100' : 'opacity-30 hover:opacity-70'
      }`}
      title={starred ? t('task.unstarKeyTask') : t('task.starKeyTask')}
      aria-pressed={starred}
      aria-label={starred ? t('task.unstarKeyTask') : t('task.starKeyTask')}
    >
      <Star size={size} fill={starred ? 'currentColor' : 'none'} />
    </button>
  );
}
