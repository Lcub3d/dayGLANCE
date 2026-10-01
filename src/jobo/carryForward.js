// What a Check entry offers once the day is read: Continue or Add follow-up
// (docs/jobo-carry-forward.md). Pure: it decides and pre-fills, and the
// panel carries the result out through the app's ordinary task actions.
//
// Nothing here reads or writes the ledger. The entry's own day-model fields
// (its resolved task, its group's measured coverage) are all it needs.
import { tagsIn } from '../utils/taskUtils.js';
import { validCivilDate } from './viewDates.js';

export const CARRY_ACTION = Object.freeze({
  CONTINUE: 'continue',
  FOLLOW_UP: 'followUp',
  MOVED: 'moved',
  SCHEDULE: 'schedule',
  NONE: 'none',
});

const SLOT_MINUTES = 15;
const NONE = Object.freeze({ kind: CARRY_ACTION.NONE });

/** The civil day after `date`, without a time zone or DST to cross. */
export function nextCivilDate(date) {
  if (!validCivilDate(date)) return null;
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
}

/**
 * What is left of a plan once `recordedMinutes` of it were measured, rounded
 * up to the 15 minutes every view snaps to. Unmeasured work and work that
 * already ran over keep the full plan: neither says how much is left.
 */
export function remainingMinutes(plannedMinutes, recordedMinutes) {
  if (!Number.isFinite(plannedMinutes) || plannedMinutes <= 0) return plannedMinutes;
  if (!Number.isFinite(recordedMinutes) || recordedMinutes <= 0 || recordedMinutes >= plannedMinutes) return plannedMinutes;
  // Rounding up never hands back more than was planned.
  return Math.min(plannedMinutes, Math.ceil((plannedMinutes - recordedMinutes) / SLOT_MINUTES) * SLOT_MINUTES);
}

// Moving one occurrence is a series exception, not a continuation, and the
// next occurrence carries the work on anyway.
const recurring = task => task.recurringTemplateId != null || task.isRecurring === true
  || task.isRecurringSeries === true || task.isJoboSyntheticOccurrence === true
  || (typeof task.id === 'string' && task.id.startsWith('recurring-'));

const calendarEvent = task => task.imported === true && !task.isTaskCalendar;

const scheduled = task => validCivilDate(task.date) && (task.isAllDay === true || typeof task.startTime === 'string' && task.startTime !== '');

const slotOf = task => ({ date: task.date, startTime: task.startTime, isAllDay: task.isAllDay === true });

/**
 * The one action a Check entry offers, picked by the state of its task now.
 *
 * `date` is the day the Check reads; `today` is the device's civil today.
 * Continue lands on the day after TODAY, not after the entry's date: a Monday
 * reviewed on Wednesday continues on Thursday.
 */
export function checkEntryAction(entry, { date, today } = {}) {
  const task = entry?.sourceTask;
  // Unlinked, deleted and archived work offers nothing for now.
  if (!task || task.id == null || task.archived) return NONE;
  if (recurring(task) || calendarEvent(task)) return NONE;
  // A finished task is grown from, never continued, whatever its last Do said.
  if (task.completed === true) return { kind: CARRY_ACTION.FOLLOW_UP, task };
  const tomorrow = nextCivilDate(today);
  if (!tomorrow) return NONE;
  // No planned time to carry: the editor picks one, opened on tomorrow.
  if (!scheduled(task)) return { kind: CARRY_ACTION.SCHEDULE, task, date: tomorrow };
  // Moved off this day already, by hand or from another device. Only the day
  // the task sits on offers Continue, so its remaining time is that day's.
  if (task.date !== date || task.date > today) return { kind: CARRY_ACTION.MOVED, task, slot: slotOf(task) };
  const duration = task.isAllDay
    ? task.duration
    : remainingMinutes(Number(task.duration), entry.comparisonMeta?.measured?.recordedMinutes);
  return {
    kind: CARRY_ACTION.CONTINUE,
    task,
    slot: { date: tomorrow, startTime: task.startTime, duration, isAllDay: task.isAllDay === true },
  };
}

const openProject = (projects, id) => (Array.isArray(projects) ? projects : []).find(project => (
  project && String(project.id) === String(id) && project.status !== 'archived' && project.status !== 'completed'
));

/**
 * The new-task form's pre-fill for a follow-up to `task`: its project (and so
 * its goal), its tags and its colour. Never its time, notes, subtasks or
 * priority, which belong to the finished work.
 *
 * The tags sit after the cursor, so what the user types goes before them. The
 * follow-up starts unscheduled: in its project's list, or in the Inbox when
 * the project is gone or closed. The form can still give it a day.
 */
export function followUpDraft(task, { projects = [] } = {}) {
  const seen = new Set();
  const tags = tagsIn(task?.title).filter(tag => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
  const project = task?.projectId != null ? openProject(projects, task.projectId) : null;
  return {
    title: tags.length ? ` ${tags.map(tag => `#${tag}`).join(' ')}` : '',
    cursor: 0,
    ...(typeof task?.color === 'string' && task.color ? { color: task.color } : {}),
    ...(project
      ? { projectId: project.id, keepUnscheduled: true }
      : { openInInbox: true, deadline: null, priority: 0 }),
  };
}
