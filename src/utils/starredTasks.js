// Marking the few tasks you specifically want to move forward today.
//
// WHY THIS IS NOT PRIORITY
// dayGLANCE already has P1-P3, and this deliberately does not touch it.
// @Lcub3d's distinction on #1684 is the reason the two coexist:
//
//   Priority is a property of the TASK. A star is a property of TODAY.
//
// A task can be P3 and not today's focus; a P1 can sit untouched for a week
// without that being wrong. Folding one into the other would lose the question
// the star answers, which is "which of these am I actually going to move today?"
//
// HOW THE DATE WORKS
// `starredDate` records the day the star was FOR, not merely that a star exists.
// A task reads as starred only while that day is still the day it is scheduled
// on. Reschedule it and the star falls away, which is @Lcub3d's rule: the star
// stays with the original date, and whether it deserves one on the new date is a
// fresh decision. That also means no cleanup is ever needed — a stale
// `starredDate` simply stops matching.
//
// Unstarring writes `null` rather than deleting the key, and that is load-bearing
// for sync: an ABSENT value means "this device never had the field" and is
// carried forward across a merge, while an explicit `null` is a real unstar and
// propagates. Exactly the rule `archived` uses. See utils/preserveStickyFields.js.

/** Is this task starred for the day it is currently scheduled on? */
export function isStarred(task) {
  return !!task?.date && task.starredDate === task.date;
}

/** The tasks starred for `dateStr`, in the order given. */
export function starredOn(tasks, dateStr) {
  return (tasks || []).filter((t) => t && t.date === dateStr && t.starredDate === dateStr);
}

/**
 * Return `task` with its star toggled for the day it sits on.
 *
 * A task with no date cannot be starred: the star is a statement about a
 * particular day, and an inbox item is not on one yet.
 */
export function toggleStar(task) {
  if (!task?.date) return task;
  return { ...task, starredDate: isStarred(task) ? null : task.date };
}

/**
 * The guideline is three (Covey's "put first things first", by way of @Lcub3d).
 * It is a nudge and not a limit: this reports when a day is over the guideline
 * so the UI can say so quietly, and nothing anywhere refuses a fourth star.
 */
export const STAR_GUIDELINE = 3;

export function overGuideline(tasks, dateStr) {
  return starredOn(tasks, dateStr).length > STAR_GUIDELINE;
}
