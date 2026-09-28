import { materializeJobu, stable } from './data.js';
import { defaultDocument, validateDocument } from '../lifeplanner/model.js';
import { STORAGE_KEY } from '../lifeplanner/store.js';
import { createLifeNode, flattenLifeSources, generatedStageTitle, LIFE_NODE_SCHEMA, lifeHierarchyCycles,
  lifeKey, patchFromNative, projectNativeNodes, projectNotebookNodes, strictNativeList, validateLifeValue, withNotebookOrder } from '../lifeplanner/entities.js';

const liveRows = heads => [...heads.values()].filter(r => r.kind === 'lifeNode' && !r.deleted);
export function lifeNodesReady(records) { return materializeJobu(records || []).get(LIFE_NODE_SCHEMA)?.deleted === false; }
export function readLifeNodes(records) {
  const heads = materializeJobu(records || []), rows = liveRows(heads);
  return { ready: heads.get(LIFE_NODE_SCHEMA)?.deleted === false, heads, rows, nodes: rows.map(r => r.value) };
}
/** Legacy native arrays are snapshots, not commands to the normalized owner.
 * Inspect the store at apply time, including the incoming marker, rather than
 * a render's cache-ready flag (which can lag or wait for a recovery backup).
 */
export function mayApplyLegacyLifeSnapshot(current, incoming) {
  if (current === undefined) return false;
  try { return !lifeNodesReady(current) && !lifeNodesReady(incoming); }
  catch { return false; }
}
const nodeChange = node => ({ entityId: node.id, kind: 'lifeNode', value: node });
const assertHead = (heads, id, expected) => {
  if (expected === undefined || (heads.get(id)?.id ?? null) !== expected) throw new Error('conflict');
};
const json = (storage, key, fallback) => {
  const raw = storage?.getItem(key);
  return raw == null ? fallback : JSON.parse(raw);
};

export const LIFE_SOURCE_BACKUP = 'jobu-life-node-source-backup-v1';
export function backupLifeSources(storage = globalThis.localStorage) {
  if (!storage) throw Error('storageRead');
  if (storage.getItem(LIFE_SOURCE_BACKUP) !== null) return;
  const keys = [STORAGE_KEY, 'day-planner-goals', 'day-planner-projects', 'day-planner-deleted-goal-ids', 'day-planner-deleted-project-ids', 'day-planner-life-map-view-v1'];
  const sources = Object.fromEntries(keys.map(key => [key, storage.getItem(key)]));
  // Recovery snapshot only. It is never read as the live planning owner.
  storage.setItem(LIFE_SOURCE_BACKUP, JSON.stringify({ format: 'jobu-life-source-backup', version: 1, sources }));
}

export function legacyNotebook(records, storage, fallback = defaultDocument()) {
  const heads = materializeJobu(records || []), order = heads.get('lifeOrder');
  if (!order || order.deleted) return validateDocument(json(storage, STORAGE_KEY, fallback));
  const ranked = (kind, ids) => [...heads.values()].filter(r => r.kind === kind && !r.deleted)
    .sort((a,b) => ids.indexOf(a.value.id) - ids.indexOf(b.value.id)).map(r => r.value);
  return validateDocument({ version: 1, revision: 0, updatedAt: null,
    wishes: ranked('lifeWish', order.value.wishes), principles: ranked('lifeMotto', order.value.principles) });
}

/** One atomic, idempotent, non-destructive migration. Original wish revisions
 * remain as history; native payloads are retained in each canonical node. The
 * old localStorage keys become legacy projection caches, never read as updates.
 */
export function migrateLifeNodes(data, { storage = globalThis.localStorage } = {}) {
  return data.transact((records, heads) => {
    if (heads.has(LIFE_NODE_SCHEMA)) return [];
    const document = legacyNotebook(records, storage);
    const goals = strictNativeList(json(storage, 'day-planner-goals', []));
    const projects = strictNativeList(json(storage, 'day-planner-projects', []));
    const deletedGoalIds = json(storage, 'day-planner-deleted-goal-ids', {});
    const deletedProjectIds = json(storage, 'day-planner-deleted-project-ids', {});
    if (!deletedGoalIds || typeof deletedGoalIds !== 'object' || Array.isArray(deletedGoalIds) || !deletedProjectIds || typeof deletedProjectIds !== 'object' || Array.isArray(deletedProjectIds)) throw Error('format');
    const nodes = withNotebookOrder(flattenLifeSources({ document, goals, projects, deletedGoalIds, deletedProjectIds }), document);
    if (lifeHierarchyCycles(nodes).length) throw Error('lifeCycle');
    const changes = nodes.filter(n => !heads.has(n.id)).map(nodeChange);
    for (const row of heads.values()) if (row.kind === 'lifeWish' && !row.deleted) changes.push({ ...row, deleted: true });
    if (!heads.has('lifeOrder')) changes.push({ entityId: 'lifeOrder', kind: 'lifeOrder', value: {
      wishes: document.wishes.map(w => w.id), principles: document.principles.map(p => p.id) } });
    for (const p of document.principles) if (!heads.has(`lifeMotto:${p.id}`)) changes.push({ entityId: `lifeMotto:${p.id}`, kind: 'lifeMotto', value: p });
    changes.push({ entityId: LIFE_NODE_SCHEMA, kind: 'lifeNodeSchema', value: { version: 1, format: 'jobu-life-nodes',
      sourceCounts: { wishes: document.wishes.length, goals: goals.length, projects: projects.length } } });
    return changes;
  });
}

export function notebookFromLifeNodes(records, fallback = defaultDocument()) {
  const heads = materializeJobu(records), nodes = liveRows(heads).map(r => r.value), order = heads.get('lifeOrder')?.value;
  const relevant = records.filter(r => ['lifeNode', 'lifeOrder', 'lifeMotto'].includes(r.kind));
  const principles = [...heads.values()].filter(r => r.kind === 'lifeMotto' && !r.deleted)
    .sort((a,b) => (order?.principles || []).indexOf(a.value.id) - (order?.principles || []).indexOf(b.value.id)).map(r => r.value);
  return projectNotebookNodes(nodes, { ...fallback, wishOrder: order?.wishes || [], principles,
    revision: relevant.length, updatedAt: relevant.map(r => r.updatedAt).sort().at(-1) || null });
}

/** Adapt a notebook edit as a patch to the current normalized nodes. Classification,
 * custom hierarchy and layout are preserved; an old notebook does not own them.
 */
export function notebookLifeChanges(records, before, after) {
  validateDocument(after);
  const { heads, nodes } = readLifeNodes(records);
  const native = { goals: projectNativeNodes(nodes, 'goal'), projects: projectNativeNodes(nodes, 'project') };
  const flatten = doc => {
    const generated = withNotebookOrder(flattenLifeSources({ document: doc, ...native }), doc);
    const ids = new Map(generated.map(n => [n.id, nodes.find(old =>
      (n.bindings.goalId && old.bindings.goalId === n.bindings.goalId)
      || (n.bindings.projectId && old.bindings.projectId === n.bindings.projectId))?.id || n.id]));
    return generated.map(n => ({ ...n, id: ids.get(n.id), parentIds: n.parentIds.map(p => ids.get(p) || p) }));
  };
  const a = new Map(flatten(before).map(n => [n.id, n])), b = new Map(flatten(after).map(n => [n.id, n]));
  const changes = [];
  for (const [id, next] of b) {
    const previous = a.get(id), row = heads.get(id);
    if (previous && stable(previous) === stable(next)) continue;
    if (!row || row.deleted) { if (row) throw Error('conflict'); changes.push(nodeChange(next)); continue; }
    const current = row.value, detail = { ...current.details };
    for (const facet of ['wish', 'vision', 'stage']) {
      if (!next.details[facet]) delete detail[facet]; else detail[facet] = next.details[facet];
    }
    const bindings = { ...current.bindings };
    for (const field of ['wishId', 'visionId', 'stageId']) {
      if (next.bindings[field]) bindings[field] = next.bindings[field]; else delete bindings[field];
    }
    const patch = { ...current, bindings, details: detail };
    for (const field of ['title', 'description', 'completed', 'starred']) {
      if (!previous || stable(previous[field]) !== stable(next[field])) patch[field] = next[field];
    }
    if (stable(current) !== stable(patch)) changes.push(nodeChange(patch));
  }
  for (const [id, old] of a) if (!b.has(id) && heads.has(id) && !heads.get(id).deleted) {
    const row = heads.get(id), value = row.value;
    if (!old.details.wish && !old.details.vision && !old.details.stage) continue;
    changes.push({ ...nodeChange(value), deleted: true });
  }
  const oldMottos = new Map(before.principles.map(p => [p.id, p])), newMottos = new Map(after.principles.map(p => [p.id, p]));
  for (const p of after.principles) if (stable(oldMottos.get(p.id)) !== stable(p)) changes.push({ entityId: `lifeMotto:${p.id}`, kind: 'lifeMotto', value: p });
  for (const p of before.principles) if (!newMottos.has(p.id)) changes.push({ entityId: `lifeMotto:${p.id}`, kind: 'lifeMotto', value: p, deleted: true });
  const order = { wishes: after.wishes.map(w => w.id), principles: after.principles.map(p => p.id) };
  if (stable(heads.get('lifeOrder')?.value) !== stable(order)) changes.push({ entityId: 'lifeOrder', kind: 'lifeOrder', value: order });
  return changes;
}

function typeBinding(value, candidateId) {
  if (!['goal', 'project'].includes(value.type) || value.bindings[`${value.type}Id`]) return value;
  // Existing planned stages acquire a native goal only through the measured
  // notebook's explicit handoff, not merely by opening the map.
  if (value.type === 'goal' && value.details.stage) return value;
  return { ...value, bindings: { ...value.bindings, [`${value.type}Id`]: candidateId },
    details: { ...value.details, [value.type]: { id: candidateId, status: value.completed ? 'completed' : 'active' } } };
}
function validateStructure(value, heads) {
  validateLifeValue('lifeNode', value);
  for (const binding of ['goalId', 'projectId']) if (value.bindings[binding] && liveRows(heads).some(row =>
    row.entityId !== value.id && row.value.bindings[binding] === value.bindings[binding])) throw Error('conflict');
  for (const p of value.parentIds) if (!heads.has(p) || heads.get(p).deleted || heads.get(p).kind !== 'lifeNode') {
    // Already-orphaned relationships remain recoverable when editing a title.
    if (!heads.get(value.id)?.value.parentIds.includes(p)) throw Error('missing');
  }
  const nodes = liveRows(heads).filter(r => r.entityId !== value.id).map(r => r.value).concat(value);
  const before = new Set(lifeHierarchyCycles(liveRows(heads).map(r => r.value)));
  if (lifeHierarchyCycles(nodes).some(id => !before.has(id))) throw Error('lifeCycle');
}
export function saveLifeNode(data, value, expectedHead) {
  value = typeBinding(value, crypto.randomUUID());
  return data.transact((_records, heads) => {
    if (!heads.has(LIFE_NODE_SCHEMA)) throw Error('loading');
    assertHead(heads, value.id, expectedHead); validateStructure(value, heads);
    return [nodeChange(value)];
  });
}
export function patchLifeNode(data, id, patch, expectedHead) {
  const candidateId = crypto.randomUUID();
  return data.transact((_records, heads) => {
    assertHead(heads, id, expectedHead);
    const row = heads.get(id); if (!row || row.deleted || row.kind !== 'lifeNode') throw Error('missing');
    let value = { ...row.value, ...patch, id: row.value.id };
    if (Object.hasOwn(patch, 'type')) value = typeBinding(value, candidateId);
    validateStructure(value, heads);
    return stable(row.value) === stable(value) ? [] : [nodeChange(value)];
  });
}
export function deleteLifeNode(data, row) {
  return data.save(row.entityId, 'lifeNode', row.value, { expectedHead: row.id, deleted: true });
}
export function placeLifeNodes(data, placements) {
  return data.transact((_records, heads) => placements.map(({ id, expectedHead, position, type }) => {
    assertHead(heads, id, expectedHead); const row = heads.get(id);
    if (!row || row.deleted) throw Error('missing');
    const value = typeBinding({ ...row.value, position, onCanvas: true, ...(type === undefined ? {} : { type }) }, crypto.randomUUID());
    validateStructure(value, heads); return nodeChange(value);
  }));
}
export function connectLifeNodes(data, parentId, childId, childHead, parentHead) {
  return data.transact((_records, heads) => {
    assertHead(heads, childId, childHead); assertHead(heads, parentId, parentHead);
    const parent = heads.get(parentId), child = heads.get(childId);
    if (parent?.deleted || child?.deleted || !parent || !child) throw Error('missing');
    const value = { ...child.value, parentIds: [...new Set(child.value.parentIds.concat(parentId))] };
    validateStructure(value, heads); return [nodeChange(value)];
  });
}

/** Native editors use the same journal. They patch only their facet, preserving
 * lane, support identity, positions and all other payloads. No absence in a sync
 * snapshot calls this API: it is exclusively a local user-command boundary.
 */
export function replaceNativeLifeNodes(data, kind, updater, expectedRows) {
  return data.transact((_records, heads) => {
    if (!heads.has(LIFE_NODE_SCHEMA)) throw Error('loading');
    const rows = liveRows(heads), nodes = rows.map(r => r.value), binding = `${kind}Id`;
    const before = projectNativeNodes(nodes, kind);
    const after = strictNativeList(typeof updater === 'function' ? updater(structuredClone(before)) : updater);
    const byId = new Map(before.map(v => [String(v.id), v])), incoming = new Map(after.map(v => [String(v.id), v]));
    const changes = [];
    for (const raw of after) {
      if (stable(byId.get(String(raw.id))) === stable(raw)) continue;
      const row = rows.find(r => r.value.bindings[binding] === String(raw.id));
      if (row) {
        if (expectedRows && expectedRows.get(row.entityId) !== row.id) throw Error('conflict');
        let value = patchFromNative(row.value, kind, raw);
        if (kind === 'project' && (raw.goalId ?? null) !== (byId.get(String(raw.id))?.goalId ?? null)) {
          const goalParents = new Set(nodes.filter(n => n.bindings.goalId).map(n => n.id));
          const parent = nodes.find(n => n.bindings.goalId === String(raw.goalId));
          value = { ...value, parentIds: value.parentIds.filter(id => !goalParents.has(id)).concat(parent ? [parent.id] : []) };
        }
        validateStructure(value, heads); changes.push(nodeChange(value));
      } else {
        // A stage handed off to a native goal keeps its preexisting network ID.
        const meta = raw.lifeplanner;
        const stage = kind === 'goal' && meta ? rows.find(r => r.value.bindings.stageId === meta.stepId
          && r.value.bindings.visionId === meta.visionId && r.value.bindings.wishId === meta.wishId) : null;
        if (stage && expectedRows && expectedRows.get(stage.entityId) !== stage.id) throw Error('conflict');
        const key = stage?.entityId || lifeKey(kind, raw.id);
        if (heads.has(key) && !stage) throw Error('conflict');
        const parent = kind === 'project' && nodes.find(n => n.bindings.goalId === String(raw.goalId));
        let value = stage?.value || createLifeNode({ id: key, type: kind, parentIds: parent ? [parent.id] : [] });
        value = { ...patchFromNative(value, kind, raw), bindings: { ...value.bindings, [binding]: String(raw.id) } };
        validateStructure(value, heads); changes.push(nodeChange(value));
      }
    }
    for (const raw of before) if (!incoming.has(String(raw.id))) {
      const row = rows.find(r => r.value.bindings[binding] === String(raw.id));
      if (expectedRows && expectedRows.get(row.entityId) !== row.id) throw Error('conflict');
      changes.push({ ...nodeChange(row.value), deleted: true });
    }
    if (new Set(changes.map(c => c.entityId)).size !== changes.length) throw Error('conflict');
    return changes;
  });
}

export function lifeNodesGraph(nodes, input = {}) {
  const graph = { nodes: nodes.map(n => ({ id: n.id, unifiedId: n.id, networkId: n.id, kind: n.type || 'untyped', title: n.title,
    completed: n.completed, starred: n.starred, parentIds: n.parentIds, position: n.position, onCanvas: n.onCanvas,
    nativeId: n.bindings.projectId || n.bindings.goalId || null,
    wishId: n.bindings.wishId, visionId: n.bindings.visionId, stepId: n.bindings.stageId,
    planned: !!n.bindings.stageId && !n.bindings.goalId })), edges: [] };
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) for (const p of n.parentIds) if (ids.has(p)) graph.edges.push({ id: lifeKey('child', p, n.id), source: p, target: n.id, relation: 'child' });
  const seen = new Set();
  for (const taskList of ['tasks', 'unscheduledTasks', 'recurringTasks']) for (const task of input[taskList] || []) {
    if (task.deleted || task.isExample) continue;
    const id = lifeKey(taskList === 'recurringTasks' ? 'template' : 'task', task.id);
    if (seen.has(id)) continue; seen.add(id);
    const parent = nodes.find(n => n.bindings.projectId === String(task.projectId));
    if (!parent) continue;
    graph.nodes.push({ id, kind: 'task', title: task.title, nativeId: task.id, completed: !!task.completed,
      taskList, recurring: taskList === 'recurringTasks', parentIds: [parent.id] });
    graph.edges.push({ id: lifeKey('child', parent.id, id), source: parent.id, target: id, relation: 'child' });
  }
  return graph;
}

// Exported for tests of title-versus-legacy-metric behavior.
export { generatedStageTitle };

/** Restoring a canonical item is a new revision, not a bypass around hierarchy
 * and alias guards. Retired nested wish rows remain available for inspection and
 * raw recovery, but must not become a second live writer after migration. */
export function restorePlanningRevision(data, row) {
  return data.transact((records, heads) => {
    if (row.kind === 'lifeWish' && lifeNodesReady(records)) throw Error('lifeLegacyRevision');
    if (row.kind === 'lifeNodeSchema') return [];
    if (row.kind === 'lifeNode' && !row.deleted) validateStructure(row.value, heads);
    return [{ entityId:row.entityId, kind:row.kind, value:row.value, deleted:row.deleted }];
  });
}
