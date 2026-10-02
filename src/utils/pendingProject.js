// "New project…" in the task modals' project picker: the project is named
// in the modal and created only when the task is saved, so a cancelled
// modal leaves nothing behind.
//
// While it is pending, newTask.projectId holds NEW_PROJECT_ID, so the modal
// treats the task as a project task (no priority or deadline, the
// Unscheduled option, the button label), and newTask.newProject holds the
// name and goal. Every path that saves newTask (addTask, saveMobileEditTask)
// passes it through createPendingProject first, which swaps in the real id.
import { PROJECT_FALLBACK_COLOR } from './colorUtils.js';

export const NEW_PROJECT_ID = '__new-project__';

/** The project fields a new project gets from its goal, as the project form defaults them. */
export function newProjectFields({ title, goal }) {
  return {
    title: title.trim(),
    ...(goal ? { goalId: goal.id } : {}),
    color: goal?.color || PROJECT_FALLBACK_COLOR,
    assignedUserSyncIds: goal?.assignedUserSyncIds || [],
  };
}

/**
 * newTask ready to save: a pending project created through addProject and
 * its id in place of the placeholder. With nothing pending, newTask as it
 * is. A placeholder without a name never reaches a task: it is dropped, and
 * the task saves without a project.
 *
 * Returns the project created too, since the app's project list does not
 * hold it until the next render, and a task tagged #obsidian writes its
 * project to its line as it is created.
 *
 * @returns {{ newTask: object, project: object | null }}
 */
export function createPendingProject(newTask, { addProject, goals = [] }) {
  if (newTask?.projectId !== NEW_PROJECT_ID) return { newTask, project: null };
  const { newProject, projectId: _placeholder, ...rest } = newTask;
  const title = (newProject?.title || '').trim();
  if (!title) return { newTask: rest, project: null };
  const goal = newProject.goalId ? goals.find((g) => g.id === newProject.goalId) || null : null;
  const project = addProject(newProjectFields({ title, goal }));
  return { newTask: { ...rest, projectId: project.id }, project };
}
