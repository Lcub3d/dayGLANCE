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
// COLOUR IS PER SURFACE, and the rule is that the star takes each surface's icon
// treatment and earns colour only where that treatment is neutral.
//
// A timeline card is white-on-colour by design and every icon on it is white —
// notes, skip, pencil, inbox, the plan-history badge — so the star is white too,
// and `currentColor` is the only fill that survives a dozen user-chosen
// backgrounds in both themes. The day header is blue-tinted chrome, same answer.
//
// On a neutral row (SCHED, LIST, GLANCE) the opposite applies. There the star
// sits among system badges — recurring, Obsidian, repeat, note-source — all of
// them grey, and it means something categorically different from all of them:
// YOU chose this, the rest are the app reporting. `accent` separates the two.
//
// Only the SET state takes colour. An unstarred star is an affordance rather
// than a mark, so it stays faint and neutral, and the colour arriving on click
// is itself the confirmation.
//
// Deliberately NOT tied to priority. A star is a property of today; priority is
// a property of the task. See utils/starredTasks.js.
// `readOnly` renders the star as a plain indicator with no toggle, and only when
// the task is actually starred. The GLANCE sidebar wants that: it reports on the
// day rather than being a place you edit it, and a faint unstarred outline on
// every row there would be noise you cannot act on.
export default function TaskStarButton({ task, size = 12, readOnly = false, accent = false }) {
  const { t } = useTranslation();
  const setTasks = useDayPlannerCtx()?.setTasks;

  // The star is a statement about a particular day, so an undated task cannot
  // carry one.
  if (!task?.date) return null;

  // A recurring occurrence is generated for display and has no stored row, so a
  // toggle would look like it worked and change nothing: setTasks maps over the
  // real tasks by id and would match none of them. Better no control than one
  // that silently fails.
  if (typeof task.id === 'string' && task.id.startsWith('recurring-')) return null;

  const starred = isStarred(task);
  // amber-500 rather than 400 in light mode: 400 is too pale to hold at 12-13px
  // on white.
  const tone = starred && accent ? 'text-amber-500 dark:text-amber-400' : '';

  // Read-only surfaces show the star only when there is one to show.
  if (readOnly) {
    return starred
      ? <Star size={size} fill="currentColor" className={`flex-shrink-0 ${tone}`} aria-label={t('task.starKeyTask')} />
      : null;
  }

  // Without setTasks there is nothing to toggle, which is the case in render-only
  // surfaces such as the tray.
  if (!setTasks) return null;
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
      <Star size={size} fill={starred ? 'currentColor' : 'none'} className={tone} />
    </button>
  );
}
