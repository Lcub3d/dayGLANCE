// What the Goal and Project widgets' taps do, and the Today and Up Next
// widgets' fallback. App.jsx drains the link (drainPendingDeepLinkRef) and
// applies the result; GoalDashboard applies the project focus.
//
//   dayglance://goal?id=…      the Goals & Projects space, that goal selected
//   dayglance://project?id=…   the space, the project's goal (or the
//                              standalone Projects list) selected and the
//                              project's card scrolled into view and ringed
//   dayglance://today          today's calendar: the Calendar space, the
//                              timeline tab on a phone, today selected
//
// The phone has no space: Goals & Projects is its own tab (mobileActiveTab
// 'goals'). Tablets and desktops use the header's space switcher.
//
// Goals & Projects can be switched off in Settings. A goal or project link on
// a device where it is off opens the app where it was, rather than turning the
// feature back on. A link to a goal or project that is gone (deleted,
// archived, or not visible to this user) still opens the space, unfocused.

/**
 * @param {'goal'|'project'} action
 * @param {URLSearchParams} params
 * @param {object} env
 * @param {boolean} env.enabled   Goals & Projects is on.
 * @param {boolean} env.phone     The phone layout (the Goals tab, not the space).
 * @returns {null | { mobileTab: string|null, space: string|null,
 *                    focusGoalId: string|null, focusProjectId: string|null }}
 *   null: not a goals link, or the feature is off (open the app as it is).
 */
export function resolveGoalsLink(action, params, { enabled, phone }) {
  if (action !== 'goal' && action !== 'project') return null;
  if (!enabled) return null;
  const id = params.get('id') || null;
  return {
    mobileTab: phone ? 'goals' : null,
    space: phone ? null : 'goals',
    focusGoalId: action === 'goal' ? id : null,
    focusProjectId: action === 'project' ? id : null,
  };
}

/**
 * Where a project lives in the Goals & Projects space: under its goal when
 * that goal is on screen (active, visible), else in the standalone list. A
 * project whose goal is archived or hidden has no card on the Goals tab, so
 * it is not focusable there; it opens the space unfocused.
 *
 * @param {string|null} projectId
 * @param {{ projects: object[], goals: object[] }} lists  The ACTIVE (not
 *        archived), visible projects and goals the dashboard draws.
 * @returns {null | { project: object, goalId: string|null }}
 *   goalId null: a standalone project (the Projects tab / standalone page).
 */
export function projectFocusTarget(projectId, { projects = [], goals = [] }) {
  if (!projectId) return null;
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  if (!project.goalId) return { project, goalId: null };
  return goals.some((g) => g.id === project.goalId) ? { project, goalId: project.goalId } : null;
}

/**
 * Whether the dashboard's area filter hides a goal (useGoalsProjects'
 * goalsAreaFilter: 'all' | 'uncategorized' | an area id). A link to a hidden
 * goal widens the filter to 'all' first, or there is no card to go to.
 */
export function areaFilterHides(goal, filter, areas = []) {
  if (!goal || !filter || filter === 'all') return false;
  if (filter === 'uncategorized') return !!goal.areaId && areas.some((a) => a.id === goal.areaId);
  return goal.areaId !== filter;
}
