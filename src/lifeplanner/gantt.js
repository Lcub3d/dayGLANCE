// Read-only temporal projection. One row per stable graph ID, even with multiple
// parents. Hierarchy is not a scheduling dependency and never shifts descendants.
import { readLifeSchedule } from './schedule.js';
import { isDate } from './model.js';
import { calculateGoalProgress } from '../utils/goalProgress.js';
import { calculateProjectProgress } from '../utils/projectProgress.js';

const DAY = 86400000;
export const civilDay = value => isDate(value) ? Date.parse(`${value}T00:00:00Z`) / DAY : null;
export const GANTT_PERIODS = [1, 3, 6, 12, 24, 60];
const COLORS = { wish: 'bg-amber-500', vision: 'bg-indigo-500', goal: 'bg-blue-500', project: 'bg-purple-500', task: 'bg-teal-500', untyped: 'bg-gray-500' };

export function shiftGanttMonth(anchor, months) {
  if (!isDate(anchor) || !Number.isInteger(months)) throw Error('scheduleDate');
  const d = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCFullYear() < 1000 || d.getUTCFullYear() > 9999) return `${anchor.slice(0, 7)}-01`;
  return d.toISOString().slice(0, 10);
}

export function ganttWindow(anchor, months) {
  if (!isDate(anchor) || !GANTT_PERIODS.includes(months)) throw Error('scheduleDate');
  // Clamp the viewport, not the stored dates. The exclusive right edge may
  // be 1 Jan 10000 so even 31 Dec 9999 remains inspectable without wrapping.
  const monthIndex = Math.min(10000 * 12 - months, Math.max(1000 * 12,
    Number(anchor.slice(0, 4)) * 12 + Number(anchor.slice(5, 7)) - 1));
  const at = offset => new Date(Date.UTC(Math.floor((monthIndex + offset) / 12), (monthIndex + offset) % 12, 1));
  const first = at(0), last = at(months);
  const left = first.getTime() / DAY, right = last.getTime() / DAY;
  return { startDate: first.toISOString().slice(0, 10), endDate: last.toISOString().split('T')[0],
    left, right, leftEdge: left * DAY, span: (right - left) * DAY,
    monthTicks: Array.from({ length: months + 1 }, (_, i) => ({ ms: at(i).getTime(), month: at(i).getUTCMonth() })) };
}

/** Date-only endpoints are inclusive. A target without a start is a milestone,
 * not a fabricated bar beginning at today/creation. Wholly undated stays blank. */
export function ganttGeometry(schedule, window) {
  if (!schedule || schedule.invalid) return null;
  const start = civilDay(schedule.startDate), end = civilDay(schedule.targetDate);
  if (start === null && end === null) return null;
  const milestone = start === null || (start === end && !schedule.summary);
  const first = start ?? end, last = end === null ? window.right : end + 1;
  if (first >= window.right || last <= window.left) return null;
  const span = window.right - window.left;
  const leftPct = Math.max(0, (first - window.left) / span * 100);
  const rightPct = Math.min(100, (last - window.left) / span * 100);
  return { leftPct, widthPct: Math.max(0, rightPct - leftPct), clippedLeft: first < window.left,
    clippedRight: end !== null && last > window.right, openEnded: end === null, milestone };
}

export function buildLifeGantt({ graph, nodes, tasks = [], unscheduledTasks = [], recurringTasks = [], goals = [], projects = [], collapsed = new Set(), root = null }) {
  const byId = new Map(nodes.map(n => [n.id, n])), visible = new Map(graph.nodes.map(n => [n.id, n]));
  const taskLists = { tasks, unscheduledTasks, recurringTasks }, allTasks = [...tasks, ...unscheduledTasks];
  const schedules = new Map();
  for (const g of graph.nodes) {
    if (g.kind === 'task') {
      const task = (taskLists[g.taskList] || []).find(t => String(t.id) === String(g.nativeId));
      const date = task?.date, due = task?.deadline?.slice?.(0, 10);
      // A template is not an occurrence. No arbitrary future expansion here.
      const targetDate = g.recurring ? null : isDate(date) ? date : isDate(due) ? due : null;
      schedules.set(g.id, { source: 'task', editable: false, startDate: null, targetDate, invalid: false });
    } else schedules.set(g.id, readLifeSchedule(byId.get(g.id), nodes));
  }
  const children = new Map();
  for (const g of graph.nodes) for (const parent of g.parentIds || []) {
    if (visible.has(parent)) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(g.id); }
  }
  // Summary range derives from ALL visible descendants, not only expanded rows.
  // It is labelled explicitly and is never written into the parent's own dates.
  for (const g of graph.nodes) {
    const own = schedules.get(g.id);
    if (own.invalid || own.startDate || own.targetDate || g.kind === 'task') continue;
    const queue = [...(children.get(g.id) || [])], seen = new Set([g.id]), dates = [];
    let hasOpenEnd = false;
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]; if (seen.has(id)) continue; seen.add(id);
      const s = schedules.get(id);
      if (s && !s.invalid && !s.summary) {
        dates.push(...[s.startDate, s.targetDate].filter(d => civilDay(d) !== null));
        if (s.startDate && !s.targetDate) hasOpenEnd = true;
      }
      queue.push(...(children.get(id) || []));
    }
    if (dates.length) { dates.sort(); schedules.set(g.id, { ...own, startDate: dates[0], targetDate: hasOpenEnd ? null : dates.at(-1), summary: true }); }
  }
  // Canonical primary-parent outline: additional parents are shown in metadata,
  // never copied into a second editable row. Remote cycles remain inspectable.
  const branches = new Map(), primary = new Map();
  for (const g of graph.nodes) {
    const parent = g.id === root ? null : (g.parentIds || []).find(p => visible.has(p) && p !== g.id) ?? null;
    primary.set(g.id, parent);
    if (!branches.has(parent)) branches.set(parent, []); branches.get(parent).push(g.id);
  }
  const seen = new Set(), rows = [];
  const visit = (id, depth, hidden = false) => {
    if (seen.has(id)) return; seen.add(id);
    const g = visible.get(id), node = byId.get(id), schedule = schedules.get(id);
    let progress = node?.completed || g.completed ? 1 : null;
    const source = schedule.source;
    if (source === 'goal' && node.bindings.goalId) progress = calculateGoalProgress(node.bindings.goalId, projects, allTasks);
    if (source === 'project' && node.bindings.projectId) progress = calculateProjectProgress(node.bindings.projectId, allTasks);
    if (!hidden) rows.push({ ...g, depth, schedule, progress, childCount: (branches.get(id) || []).length,
      extraParents: (g.parentIds || []).filter(p => p !== primary.get(id)),
      color: node?.details?.[source]?.color || COLORS[g.kind] || COLORS.untyped });
    for (const child of branches.get(id) || []) visit(child, depth + 1, hidden || collapsed.has(id));
  };
  for (const id of branches.get(null) || []) visit(id, 0);
  for (const g of graph.nodes) if (!seen.has(g.id)) visit(g.id, 0);
  return rows;
}
