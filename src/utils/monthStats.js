// The month view's headline numbers, with the All-Time Summary's
// definitions (hooks/useStats.js) narrowed to one calendar month:
//
//  • scheduled: the user's non-imported tasks dated in the month, recurring
//    occurrences that fall in it, and inbox tasks whose deadline falls in it;
//  • completed: those of them that are done;
//  • incomplete: the rest.
//
// Like the summary, only days up to and including today count: a task set
// for next week is not "incomplete" yet. So a past month is fully counted,
// the current month is counted through today, and a future month has
// nothing to report (`counted` is false) and the header shows nothing.

import { getOccurrencesInRange } from './recurrenceEngine.js';
import { notBucketed } from './bucketList.js';
import { daysInMonth } from './monthGrid.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {object} args
 * @param {Array} args.tasks
 * @param {Array} [args.unscheduledTasks]
 * @param {Array} [args.recurringTasks]
 * @param {number} args.year
 * @param {number} args.month            1..12
 * @param {string} args.today            YYYY-MM-DD
 * @param {(task: object) => boolean} [args.isVisibleForUser]
 * @returns {{ counted: boolean, from: string, to: string, scheduled: number, completed: number, incomplete: number }}
 */
export function monthStats({ tasks = [], unscheduledTasks = [], recurringTasks = [], year, month, today, isVisibleForUser = () => true }) {
  const from = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  const to = monthEnd < today ? monthEnd : today;
  if (to < from) return { counted: false, from, to: from, scheduled: 0, completed: 0, incomplete: 0 };

  const inSpan = (d) => typeof d === 'string' && d >= from && d <= to;
  const own = tasks.filter((t) => !t.imported && !t.isExample && inSpan(t.date) && isVisibleForUser(t));
  const deadlines = unscheduledTasks.filter((t) => notBucketed(t) && inSpan(t.deadline) && isVisibleForUser(t));
  let recurringScheduled = 0;
  let recurringCompleted = 0;
  for (const template of recurringTasks.filter(isVisibleForUser)) {
    const start = template.recurrence?.startDate && template.recurrence.startDate > from ? template.recurrence.startDate : from;
    if (start > to) continue;
    const occurrences = getOccurrencesInRange(template, start, to);
    const done = new Set(template.completedDates || []);
    recurringScheduled += occurrences.length;
    recurringCompleted += occurrences.filter((d) => done.has(d)).length;
  }

  const scheduled = own.length + deadlines.length + recurringScheduled;
  const completed = own.filter((t) => t.completed).length + deadlines.filter((t) => t.completed).length + recurringCompleted;
  return { counted: true, from, to, scheduled, completed, incomplete: scheduled - completed };
}
