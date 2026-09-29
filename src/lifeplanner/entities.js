/** Canonical Jobu planning nodes. Type is a classification, never an identity.
 * Native lists and the ruled notebook are compatibility projections of these
 * records, not additional writable owners. Facets retain source-specific data.
 */
import { defaultDocument, validateDocument, measureText } from './model.js';
import { buildLifeMap } from './lifeMap.js';
import { validSchedule } from './schedule.js';

export const LIFE_TYPES = Object.freeze(['wish', 'vision', 'goal', 'project']);
export const LIFE_NODE_SCHEMA = 'jobu:life-nodes:v1';
export const LIFE_NODE_KINDS = ['lifeNode', 'lifeNodeSchema'];
export const lifeKey = (kind, ...ids) => JSON.stringify([kind, ...ids.map(String)]);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, limit = 20000) => typeof v === 'string' && v.length <= limit;
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 3000;
const clean = value => JSON.parse(JSON.stringify(value));
const without = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.includes(key)));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function validateLifeValue(kind, v) {
  if (!LIFE_NODE_KINDS.includes(kind)) return;
  if (!object(v) || v.version !== 1) throw new Error('format');
  if (kind === 'lifeNodeSchema') {
    if (v.format !== 'jobu-life-nodes') throw new Error('format');
    return;
  }
  if (!id(v.id) || (v.type !== null && !LIFE_TYPES.includes(v.type)) || !text(v.title, 2000)
    || !text(v.description, 20000) || typeof v.completed !== 'boolean' || typeof v.starred !== 'boolean'
    || !Array.isArray(v.parentIds) || !v.parentIds.every(id) || new Set(v.parentIds).size !== v.parentIds.length
    || v.parentIds.includes(v.id) || typeof v.onCanvas !== 'boolean' || !object(v.bindings) || !object(v.details)
    || (v.position !== null && (!object(v.position) || !Number.isFinite(v.position.x) || !Number.isFinite(v.position.y)
      || Math.abs(v.position.x) > 100000 || Math.abs(v.position.y) > 100000))) throw new Error('format');
  for (const value of Object.values(v.bindings)) if (value !== null && !id(value)) throw new Error('format');
  for (const value of Object.values(v.details)) if (!object(value)) throw new Error('format');
  if (v.details.schedule) {
    const schedule = v.details.schedule;
    if (!validSchedule(schedule)) throw new Error('format');
    if (schedule.owner !== undefined && (!['goal', 'project', 'vision', 'stage'].includes(schedule.owner)
      || !v.details[schedule.owner] || (['goal', 'project'].includes(schedule.owner) && !v.bindings[`${schedule.owner}Id`])
      || schedule.startDate != null || schedule.targetDate != null)) throw new Error('format');
  }
  // Nested planning collections would create a second owner for the same node.
  if (v.details.wish?.visions || v.details.vision?.steps) throw new Error('format');
}

export function createLifeNode({ id: key, type = null, title = '', description = '', parentIds = [], position = null,
  onCanvas = type !== null, completed = false, starred = false, bindings = {}, details = {} }) {
  const node = clean({ version: 1, id: key, type, title, description, completed, starred, parentIds, position, onCanvas, bindings, details });
  validateLifeValue('lifeNode', node);
  return node;
}

export function strictNativeList(values) {
  if (!Array.isArray(values)) throw new Error('format');
  const ids = new Set();
  for (const v of values) {
    if (!object(v) || (typeof v.id !== 'string' && typeof v.id !== 'number') || !String(v.id)
      || ids.has(String(v.id)) || !text(v.title ?? '', 2000)) throw new Error('format');
    ids.add(String(v.id));
  }
  return values;
}

/** Flatten all four legacy owners in one pass, reusing the support-network
 * identity of stages that already have a native goal. Missing links stay in
 * the original facets and are never turned into invented entities.
 */
export function flattenLifeSources({ document = defaultDocument(), goals = [], projects = [], deletedGoalIds = {}, deletedProjectIds = {} } = {}) {
  validateDocument(document); strictNativeList(goals); strictNativeList(projects);
  const graph = buildLifeMap({ document, goals, projects, deletedGoalIds, deletedProjectIds });
  const sourceNodes = graph.nodes.filter(n => LIFE_TYPES.includes(n.kind) && !n.missing);
  const remap = new Map(sourceNodes.map(n => [n.id, n.kind === 'goal' && n.stepId != null
    ? lifeKey('stage', n.wishId, n.visionId, n.stepId) : n.id]));
  const result = [];
  for (const n of sourceNodes) {
    const wish = document.wishes.find(w => w.id === n.wishId);
    const vision = wish?.visions.find(v => v.id === n.visionId);
    const stage = vision?.steps.find(s => s.id === n.stepId);
    const native = n.nativeId == null ? null : (n.kind === 'project' ? projects : goals).find(x => String(x.id) === String(n.nativeId));
    const bindings = {}, details = {};
    if (wish && n.kind === 'wish') { bindings.wishId = wish.id; details.wish = without(wish, ['visions']); }
    if (vision && n.kind === 'vision') { Object.assign(bindings, { wishId: wish.id, visionId: vision.id }); details.vision = without(vision, ['steps']); }
    if (stage && n.kind === 'goal') {
      Object.assign(bindings, { wishId: wish.id, visionId: vision.id, stageId: stage.id }); details.stage = clean(stage);
    }
    if (native) { bindings[n.kind === 'project' ? 'projectId' : 'goalId'] = String(native.id); details[n.kind] = clean(native); }
    result.push(createLifeNode({ id: remap.get(n.id), type: n.kind, title: n.title,
      description: String(native?.description || ''), completed: !!n.completed, starred: !!n.starred,
      parentIds: [...new Set(graph.edges.filter(e => e.target === n.id && e.relation === 'child')
        .map(e => remap.get(e.source)).filter(Boolean))], bindings, details }));
  }
  // Shared/conflicting legacy native links must not drop a second milestone.
  // Keep the extra planning stage as its own node without duplicating ownership
  // of a native goal. Its original goalId/projectId remain in the stage facet.
  for (const w of document.wishes) for (const v of w.visions) for (const step of v.steps) {
    const key = lifeKey('stage', w.id, v.id, step.id);
    if (!result.some(n => n.bindings.wishId === w.id && n.bindings.visionId === v.id && n.bindings.stageId === step.id)) {
      result.push(createLifeNode({ id: key, type: 'goal', title: measureText(v.title, step.value),
        parentIds: [lifeKey('vision', w.id, v.id)], bindings: { wishId: w.id, visionId: v.id, stageId: step.id }, details: { stage: clean(step) } }));
    }
  }
  return result;
}

export function projectNativeNodes(nodes, kind) {
  const binding = kind === 'goal' ? 'goalId' : 'projectId';
  return nodes.filter(n => n.bindings[binding]).map(n => {
    const raw = n.details[kind] || { id: n.bindings[binding], status: 'active' };
    const value = { ...raw, title: n.title };
    if (n.description || Object.hasOwn(raw, 'description')) value.description = n.description;
    if (n.completed) value.status = 'completed';
    else if (value.status === 'completed') value.status = 'active';
    if (Object.hasOwn(raw, 'completed')) value.completed = n.completed;
    return value;
  });
}

export function patchFromNative(node, kind, raw) {
  const result = { ...node, title: raw.title || '', description: String(raw.description || ''),
    completed: raw.status === 'completed' || raw.completed === true, details: { ...node.details, [kind]: clean(raw) } };
  return result;
}

/** The notebook retains its original editing idioms. Its binding roles do not
 * change when a card changes lane, just as a native projectId must not disappear.
 * New free-form nodes use the common editor; no numeric vision is fabricated.
 */
export function projectNotebookNodes(nodes, meta = defaultDocument()) {
  const wishes = nodes.filter(n => n.details.wish && n.bindings.wishId && !n.bindings.visionId);
  const order = meta.wishOrder || [];
  wishes.sort((a, b) => {
    const ai = order.indexOf(a.bindings.wishId), bi = order.indexOf(b.bindings.wishId);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || compare(a.id, b.id);
  });
  return { version: 1, revision: meta.revision || 0, updatedAt: meta.updatedAt || null, principles: meta.principles || [],
    wishes: wishes.map(w => ({ ...without(w.details.wish, ['visionOrder']), title: w.title, completed: w.completed, starred: w.starred,
      visions: nodes.filter(n => n.details.vision && n.bindings.wishId === w.bindings.wishId).sort((a,b) =>
        (w.details.wish.visionOrder || []).indexOf(a.bindings.visionId) - (w.details.wish.visionOrder || []).indexOf(b.bindings.visionId)
        || compare(a.id,b.id)).map(v => {
          const original = v.details.vision;
          // Free text edited in the common editor must not corrupt the legacy
          // measured editor; its saved metric title is retained as a facet.
          const metricTitle = original.title;
          return { ...without(original, ['stepOrder']), title: metricTitle, completed: v.completed,
            steps: nodes.filter(n => n.details.stage && n.bindings.wishId === w.bindings.wishId && n.bindings.visionId === v.bindings.visionId)
              .sort((a,b) => (original.stepOrder || []).indexOf(a.bindings.stageId) - (original.stepOrder || []).indexOf(b.bindings.stageId)
                || compare(a.id,b.id)).map(n => n.details.stage) };
        }) })) };
}

/** Add explicit source order so a normalize/reload never rearranges successive
 * vision periods (whose order has semantic significance, not just cosmetics).
 */
export function withNotebookOrder(nodes, document) {
  return nodes.map(n => {
    if (n.details.wish) {
      const wish = document.wishes.find(w => w.id === n.bindings.wishId);
      return { ...n, details: { ...n.details, wish: { ...n.details.wish, visionOrder: wish.visions.map(v => v.id) } } };
    }
    if (n.details.vision) {
      const v = document.wishes.find(w => w.id === n.bindings.wishId)?.visions.find(v => v.id === n.bindings.visionId);
      return { ...n, details: { ...n.details, vision: { ...n.details.vision, stepOrder: v.steps.map(s => s.id) } } };
    }
    return n;
  });
}

export function lifeDescendants(nodes, root) {
  const children = new Map();
  for (const n of nodes) for (const parent of n.parentIds) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(n.id); }
  const found = new Set(), queue = [root];
  for (let i = 0; i < queue.length; i++) {
    if (found.has(queue[i])) continue;
    found.add(queue[i]); queue.push(...(children.get(queue[i]) || []));
  }
  return found;
}
export function lifeHierarchyCycles(nodes) {
  const ids = new Set(nodes.map(n => n.id)), indegrees = new Map(nodes.map(n => [n.id, 0])), children = new Map();
  for (const n of nodes) for (const parent of n.parentIds) if (ids.has(parent)) {
    indegrees.set(n.id, indegrees.get(n.id) + 1);
    if (!children.has(parent)) children.set(parent, []); children.get(parent).push(n.id);
  }
  const queue = [...indegrees.keys()].filter(k => !indegrees.get(k));
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) || []) {
    indegrees.set(child, indegrees.get(child) - 1); if (!indegrees.get(child)) queue.push(child);
  }
  return [...indegrees.keys()].filter(k => indegrees.get(k) > 0);
}

export function generatedStageTitle(node, nodes) {
  const vision = nodes.find(v => v.details.vision && v.bindings.visionId === node.bindings.visionId && v.bindings.wishId === node.bindings.wishId);
  return vision ? measureText(vision.details.vision.title, node.details.stage?.value) : node.title;
}

/** Keep the inherited permission-filtered native lists authoritative for visibility.
 * Changing a node's lane must never make a previously hidden native item visible. */
export function visibleLifeNodes(nodes, goals, projects) {
  const allowedGoals = Array.isArray(goals) ? new Set(goals.map(g => String(g.id))) : null;
  const allowedProjects = Array.isArray(projects) ? new Set(projects.map(p => String(p.id))) : null;
  return nodes.filter(n => (!allowedGoals || !n.bindings.goalId || allowedGoals.has(n.bindings.goalId))
    && (!allowedProjects || !n.bindings.projectId || allowedProjects.has(n.bindings.projectId)));
}
