import { buildHierarchy } from './hierarchy.js';
import { measureText } from './model.js';

// A view of existing identities, not another database of wishes or tasks.
export const MAP_WIDTH = 224;
export const MAP_HEIGHT = 96;
export const MAP_LEVELS = Object.freeze({ root: 0, unlinked: 1, wish: 1, vision: 2, goal: 3, project: 4, task: 5 });
export const MAP_VIEW_KEY = 'day-planner-life-map-view-v1';
export const MAP_TOMBSTONE_KEYS = ['day-planner-deleted-goal-ids', 'day-planner-deleted-project-ids'];
const lists = ['tasks', 'unscheduledTasks', 'recurringTasks'];
const array = value => Array.isArray(value) ? value : [];
const key = (type, ...parts) => JSON.stringify([type, ...parts.map(String)]);
const index = values => new Map(array(values).filter(v => v?.id != null).map(v => [String(v.id), v]));
const tombstoned = (values, id) => Array.isArray(values) ? values.some(v => String(v) === String(id)) : !!values && Object.hasOwn(values, String(id));
const active = (values, tombstones) => array(values).filter(v => v?.id != null && !v.deleted && !tombstoned(tombstones, v.id));
const completed = value => !!value?.completed || value?.status === 'completed';

/** Reuse the established hierarchy projection. Extra native relationships are
 * resolved by IDs only. A conflicting step link is drawn dashed, never repaired.
 * The caller can pass permission-filtered collections for multi-user contexts.
 */
export function buildLifeMap(input = {}) {
  const document = input.document || { wishes: [] };
  const wishes = index(document.wishes);
  const goals = index(active(input.goals, input.deletedGoalIds));
  const projects = index(active(input.projects, input.deletedProjectIds));
  const clean = { ...input, document, goals: [...goals.values()], projects: [...projects.values()] };
  const hierarchy = buildHierarchy(clean);
  const nodes = new Map(), edges = new Map(), goalIds = new Map(), projectIds = new Map();
  const root = 'root', unlinked = 'unlinked';
  function add(id, kind, title, data = {}) {
    if (!nodes.has(id)) nodes.set(id, { id, kind, title: String(title || ''), ...data });
    return id;
  }
  function edge(source, target, relation = 'child') {
    if (source === target) return;
    const id = key('edge', source, target, relation);
    edges.set(id, { id, source, target, relation });
  }
  function orphan(id) {
    add(unlinked, 'unlinked', ''); edge(root, unlinked); edge(unlinked, id);
  }
  function projectNode(project) {
    const id = key('project', project.id);
    projectIds.set(String(project.id), id);
    return add(id, 'project', project.title, { nativeId: project.id, completed: completed(project), date: project.targetDate || null });
  }
  add(root, 'root', '');
  for (const branch of hierarchy.wishes) {
    const wish = wishes.get(String(branch.id));
    if (!wish) continue;
    const w = add(key('wish', wish.id), 'wish', wish.title, { wishId: wish.id, category: wish.category, starred: !!wish.starred, completed: completed(wish) });
    edge(root, w);
    for (const projected of branch.visions) {
      const vision = array(wish.visions).find(v => String(v.id) === String(projected.id));
      if (!vision) continue;
      const ancestry = { wishId: wish.id, visionId: vision.id, category: wish.category };
      const v = add(key('vision', wish.id, vision.id), 'vision', vision.title, { ...ancestry, completed: completed(vision) });
      edge(w, v);
      for (const stage of projected.goals) {
        const step = array(vision.steps).find(s => String(s.id) === String(stage.stepId));
        const native = stage.status === 'linked' ? goals.get(String(stage.nativeGoalId)) : null;
        // A materialised goal and its planning stage are ONE node, not copies.
        const g = add(native ? key('goal', native.id) : key('stage', wish.id, vision.id, stage.stepId), 'goal',
          native?.title || measureText(vision.title, stage.value), { ...ancestry, stepId: stage.stepId,
            nativeId: native?.id ?? null, planned: !native, completed: completed(native), date: native?.targetDate || null });
        if (native) goalIds.set(String(native.id), g);
        edge(v, g);
        for (const entry of stage.projects) {
          const project = projects.get(String(entry.id));
          if (!project) continue;
          const p = projectNode(project);
          const conflict = project.goalId != null && String(project.goalId) !== String(native?.id);
          edge(g, p, conflict ? 'conflict' : 'child');
          if (conflict) nodes.get(p).conflict = true;
        }
        if (step?.projectId != null && !projects.has(String(step.projectId))) {
          const p = add(key('missing-project', step.projectId), 'project', '', { missing: true, ...ancestry, stepId: step.id });
          edge(g, p, 'missing');
        }
      }
    }
  }
  // Preserve genuine native goalId/projectId links even outside Life Planner.
  for (const goal of goals.values()) {
    if (goalIds.has(String(goal.id))) continue;
    const g = add(key('goal', goal.id), 'goal', goal.title, { nativeId: goal.id, completed: completed(goal), date: goal.targetDate || null });
    goalIds.set(String(goal.id), g); orphan(g);
  }
  for (const project of projects.values()) {
    const existed = projectIds.has(String(project.id));
    const p = projectNode(project), g = goalIds.get(String(project.goalId));
    if (g) edge(g, p);
    else if (!existed) orphan(p);
  }
  const taskIds = new Set();
  for (const taskList of lists) {
    for (const task of active(input[taskList])) {
      if (task.isExample) continue;
      // Scheduled/inbox copies share a native identity; recurring templates do
      // not share an identity with their expanded occurrences.
      const id = key(taskList === 'recurringTasks' ? 'template' : 'task', task.id);
      if (taskIds.has(id)) continue;
      taskIds.add(id);
      const n = add(id, 'task', task.title, { nativeId: task.id, taskList, completed: completed(task), date: task.date || task.deadline || null,
        recurring: taskList === 'recurringTasks', imported: !!task.imported });
      const p = projectIds.get(String(task.projectId));
      if (p) edge(p, n); else orphan(n);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], conflicts: hierarchy.conflicts };
}

export function filterLifeMap(graph, { wishId = '', query = '', level = 5, showUnlinked = false, collapsed = [] } = {}) {
  const lookup = new Map(graph.nodes.map(n => [n.id, n]));
  const children = new Map(), parents = new Map();
  for (const e of graph.edges) {
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source).push(e.target);
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target).push(e.source);
  }
  const term = query.trim().toLocaleLowerCase();
  const folded = new Set(term ? [] : collapsed);
  const visible = new Set(), queue = ['root'];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], n = lookup.get(id);
    if (!n || visible.has(id)) continue;
    if (n.kind === 'unlinked' && (!showUnlinked || wishId)) continue;
    if (n.kind === 'wish' && wishId && String(n.wishId) !== String(wishId)) continue;
    // Search is deliberately across all five levels, not just the visible tier.
    if (!term && MAP_LEVELS[n.kind] > Number(level)) continue;
    visible.add(id);
    if (!folded.has(id)) queue.push(...(children.get(id) || []));
  }
  const matches = new Set([...visible].filter(id => term && lookup.get(id).title.toLocaleLowerCase().includes(term)));
  if (term) {
    const keep = new Set(['root']), pending = [...matches];
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i];
      if (keep.has(id) || !visible.has(id)) continue;
      keep.add(id); pending.push(...(parents.get(id) || []));
    }
    for (const id of visible) if (!keep.has(id)) visible.delete(id);
  }
  return {
    nodes: graph.nodes.filter(n => visible.has(n.id)).map(n => ({ ...n, match: matches.has(n.id), collapsed: folded.has(n.id),
      childCount: new Set(children.get(n.id) || []).size })),
    edges: graph.edges.filter(e => visible.has(e.source) && visible.has(e.target) && !folded.has(e.source)),
    matchCount: matches.size,
  };
}

/** A stable left-to-right tree layout, with cross-links for shared identities.
 * It does not sort business arrays or persist positions into any native record.
 */
export function layoutLifeMap(graph, positions = {}) {
  const children = new Map(graph.nodes.map(n => [n.id, []]));
  const assigned = new Set(['root']);
  // Real hierarchy edges own layout before advisory conflict edges.
  const orderedEdges = [...graph.edges].sort((a, b) => Number(a.relation === 'conflict') - Number(b.relation === 'conflict'));
  const candidates = new Map();
  for (const e of orderedEdges) {
    if (!candidates.has(e.source)) candidates.set(e.source, []);
    candidates.get(e.source).push(e.target);
  }
  const order = ['root'];
  for (let i = 0; i < order.length; i++) {
    for (const target of candidates.get(order[i]) || []) {
      if (assigned.has(target) || !children.has(target)) continue;
      assigned.add(target); children.get(order[i]).push(target); order.push(target);
    }
  }
  for (const n of graph.nodes) if (!assigned.has(n.id)) { assigned.add(n.id); children.get('root')?.push(n.id); order.push(n.id); }
  const y = new Map(); let cursor = 0;
  // Iterative postorder avoids stack overflow for large native collections.
  const stack = [['root', false]];
  while (stack.length) {
    const [id, visited] = stack.pop(), list = children.get(id) || [];
    if (!visited && list.length) { stack.push([id, true]); for (const child of [...list].reverse()) stack.push([child, false]); }
    else if (list.length) y.set(id, (y.get(list[0]) + y.get(list.at(-1))) / 2);
    else { y.set(id, cursor); cursor += MAP_HEIGHT + 32; }
  }
  return graph.nodes.map(n => ({ id: n.id, type: 'life', width: MAP_WIDTH, height: MAP_HEIGHT, draggable: true, deletable: false,
    position: validPosition(positions[n.id]) ? positions[n.id] : { x: MAP_LEVELS[n.kind] * (MAP_WIDTH + 64), y: y.get(n.id) || 0 }, data: n }));
}

const bounded = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7;
const validPosition = p => p && bounded(p.x) && bounded(p.y);
export const emptyMapView = () => ({ version: 1, positions: {}, collapsed: [] });
export function readMapView(storage) {
  try {
    const raw = storage.getItem(MAP_VIEW_KEY);
    if (!raw) return { value: emptyMapView(), error: null };
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions) || !Array.isArray(value.collapsed)) throw new Error('view');
    const positions = Object.fromEntries(Object.entries(value.positions).filter(([id, p]) => id.length <= 600 && validPosition(p)).slice(0, 2000));
    return { value: { version: 1, positions, collapsed: [...new Set(value.collapsed.filter(id => typeof id === 'string' && id.length <= 600))].slice(0, 2000) }, error: null };
  } catch { return { value: emptyMapView(), error: 'viewReadError' }; }
}
export function writeMapView(storage, value, nodeIds) {
  const valid = new Set(nodeIds);
  const clean = { version: 1,
    positions: Object.fromEntries(Object.entries(value.positions).filter(([id, p]) => valid.has(id) && validPosition(p)).slice(0, 2000)),
    collapsed: [...new Set(value.collapsed.filter(id => valid.has(id)))].slice(0, 2000) };
  try { storage.setItem(MAP_VIEW_KEY, JSON.stringify(clean)); return true; } catch { return false; }
}

// These native tombstones have no React setter. Refresh after collection
// changes and external storage events; never resurrect a tombstoned entity.
export function readMapTombstones(storage) {
  try {
    const values = MAP_TOMBSTONE_KEYS.map(key => {
      const value = JSON.parse(storage.getItem(key) || '{}');
      if (!value || typeof value !== 'object') throw new Error('tombstones');
      return value;
    });
    return { deletedGoalIds: values[0], deletedProjectIds: values[1], error: null };
  } catch { return { deletedGoalIds: {}, deletedProjectIds: {}, error: 'nativeReadError' }; }
}
