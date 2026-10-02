// "Add from Inbox" on a Project card: Inbox tasks that belong to no project,
// moved into this one without leaving the Goals & Projects workspace.
import { getProjectColor } from './colorUtils.js';
import { notBucketed } from './bucketList.js';

/** An Inbox task the card can offer: open, in no project, not in the Bucket List, and yours to see. */
export const isInboxCandidate = (task, isVisibleForUser = () => true) =>
  !!task && !task.projectId && !task.completed && !task.archived && notBucketed(task) && isVisibleForUser(task);

/** The Inbox tasks to offer, in the Inbox's own order. */
export const inboxCandidates = (unscheduledTasks, isVisibleForUser) =>
  (unscheduledTasks || []).filter((task) => isInboxCandidate(task, isVisibleForUser));

/**
 * The Inbox with the chosen tasks in `project`, as choosing the project in
 * the task editor does: its id and its colour. Its assigned users only where
 * the project has some, so adding never clears a task's own. A task that has
 * stopped being a candidate since the list was drawn (completed, or given a
 * project on another device) is left as it is. A leftover order from an
 * earlier project is dropped, so the task joins at the end of this one's list.
 */
export function assignInboxTasks(unscheduledTasks, ids, project, parentGoal = null) {
  const chosen = new Set((ids || []).map(String));
  const color = getProjectColor(project, parentGoal);
  const users = project.assignedUserSyncIds?.length ? { assignedUserSyncIds: project.assignedUserSyncIds } : {};
  return (unscheduledTasks || []).map((task) => {
    if (!chosen.has(String(task.id)) || !isInboxCandidate(task)) return task;
    const { projectOrder: _earlier, ...rest } = task;
    return { ...rest, projectId: project.id, color, ...users };
  });
}
