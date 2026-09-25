// The Goal and Project widgets' part of the widget snapshot (App.jsx pushes
// it with the rest through DayGlanceNative.updateWidgetSnapshot). Pure, so the
// order the widgets list things in is testable where they read it: both the
// Android and the iOS widgets draw these lists in the order given, so the
// order here is the order on the Home Screen.
//
// Order, matching the app:
//   - a goal's projects as the Goals & Projects space draws them: by
//     sortOrder (sortProjectsByOrder), open ones before completed ones;
//   - a project's tasks as its card lists them (orderProjectTasks): open
//     scheduled by date, open inbox by the drag order, then the completed.

import { TAILWIND_TO_HEX } from './colorUtils.js';
import { calculateGoalProgress } from './goalProgress.js';
import { stripWikilinksAndTags } from './taskUtils.js';
import { orderProjectTasks, sortProjectsByOrder } from './projectOrder.js';

/** Tasks the Project widget payload carries per project: the iOS large
 *  widget's eight rows (Android shows six). The count line and "+N more" use
 *  the project's totals, not this list. */
export const WIDGET_PROJECT_TASK_LIMIT = 8;

const DEFAULT_HEX = '#3b82f6';
const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
const openFirst = (list) => [
  ...list.filter((p) => p.status !== 'completed'),
  ...list.filter((p) => p.status === 'completed'),
];

/**
 * @param {object} input
 * @param {object[]} input.goals        The user's visible goals.
 * @param {object[]} input.allGoals     Every goal (a project's parent lookup).
 * @param {object[]} input.projects     The user's visible projects.
 * @param {object[]} input.scheduled    Visible scheduled tasks.
 * @param {object[]} input.unscheduled  Visible unscheduled (inbox) tasks.
 * @param {string}   input.todayStr     Local today, 'YYYY-MM-DD'.
 * @returns {{ allGoals: object[], allProjects: object[] }}
 */
export function buildWidgetGoalsProjects({ goals = [], allGoals = goals, projects = [], scheduled = [], unscheduled = [], todayStr }) {
  const allTasks = [...scheduled, ...unscheduled];
  const live = (t) => !t.archived;
  const tasksOf = (projectId) => allTasks.filter((t) => t.projectId === projectId && live(t));

  const goalData = goals
    .filter((g) => g.status === 'active')
    .map((g) => {
      const childProjects = openFirst(sortProjectsByOrder(projects.filter((p) => p.goalId === g.id && p.status !== 'archived')));
      const childIds = new Set(childProjects.map((p) => p.id));
      const goalTasks = allTasks.filter((t) => childIds.has(t.projectId) && live(t));
      let daysUntilDue = null;
      if (g.targetDate) {
        daysUntilDue = Math.round((new Date(g.targetDate) - new Date(todayStr)) / 86400000);
      }
      return {
        id: g.id,
        title: g.title,
        colorHex: TAILWIND_TO_HEX[g.color] || DEFAULT_HEX,
        targetDate: g.targetDate || '',
        daysUntilDue,
        progressPct: Math.round(calculateGoalProgress(g.id, projects, allTasks) * 100),
        totalTasks: goalTasks.length,
        completedTasks: goalTasks.filter((t) => t.completed).length,
        projects: childProjects.map((p) => {
          const ptasks = tasksOf(p.id);
          const done = ptasks.filter((t) => t.completed).length;
          return {
            id: p.id,
            title: p.title,
            status: p.status,
            progressPct: pct(done, ptasks.length),
            totalTasks: ptasks.length,
            completedTasks: done,
          };
        }),
      };
    });

  const projectData = projects
    .filter((p) => p.status !== 'archived')
    .map((p) => {
      const isMine = (t) => t.projectId === p.id && live(t);
      const ordered = orderProjectTasks(scheduled.filter(isMine), unscheduled.filter(isMine));
      const done = ordered.filter((t) => t.completed).length;
      const parentGoal = allGoals.find((g) => g.id === p.goalId);
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        goalId: p.goalId || '',
        goalTitle: parentGoal?.title || '',
        goalColorHex: parentGoal ? (TAILWIND_TO_HEX[parentGoal.color] || DEFAULT_HEX) : '',
        progressPct: pct(done, ordered.length),
        totalTasks: ordered.length,
        completedTasks: done,
        tasks: ordered
          .slice(0, WIDGET_PROJECT_TASK_LIMIT)
          .map((t) => ({ id: t.id, title: stripWikilinksAndTags(t.title), completed: !!t.completed })),
      };
    });

  return { allGoals: goalData, allProjects: projectData };
}
