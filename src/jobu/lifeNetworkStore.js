import { materializeJobu } from './data.js';
import { DEFAULT_SCENARIO, DEFAULT_SCENARIO_ID, dependencyConflicts, pairwisePriorities, supportBudgets, UNALLOCATED, validateNetworkValue } from '../lifeplanner/supportNetwork.js';

export const valueId = (scenarioId, nodeId) => JSON.stringify(['lifeNetworkValue', scenarioId, nodeId]);
export const edgeId = e => JSON.stringify(['lifeNetworkEdge', e.scenarioId, e.source, e.target, e.relation]);
export const judgmentId = (scenarioId, target) => JSON.stringify(['lifeNetworkJudgment', scenarioId, target]);
const currentId = (heads, key) => heads.get(key)?.id ?? null;
function expected(heads, key, head) {
  if (head === undefined || currentId(heads, key) !== head) throw new Error('conflict');
}
function sceneChange(heads, scenarioId) {
  const row = heads.get(scenarioId);
  if (row && !row.deleted && row.kind === 'lifeNetworkScenario') return [];
  if (row || scenarioId !== DEFAULT_SCENARIO_ID) throw new Error('missing');
  return [{ entityId: scenarioId, kind: 'lifeNetworkScenario', value: { ...DEFAULT_SCENARIO } }];
}
function rowsOf(heads, kind, scenarioId) {
  return [...heads.values()].filter(r => r.kind === kind && !r.deleted && r.value.scenarioId === scenarioId);
}
export function readLifeNetwork(records, scenarioId = DEFAULT_SCENARIO_ID) {
  const heads = materializeJobu(records || []);
  const scenarios = [...heads.values()].filter(r => r.kind === 'lifeNetworkScenario' && !r.deleted);
  if (!heads.has(DEFAULT_SCENARIO_ID)) scenarios.unshift({ entityId: DEFAULT_SCENARIO_ID, id: null, value: { ...DEFAULT_SCENARIO } });
  scenarios.sort((a, b) => a.entityId.localeCompare(b.entityId, 'en'));
  const scenario = scenarios.find(s => s.entityId === scenarioId) || null;
  return { heads, scenarios, scenario, edges: rowsOf(heads, 'lifeNetworkEdge', scenarioId),
    evaluations: rowsOf(heads, 'lifeNetworkValue', scenarioId), judgments: rowsOf(heads, 'lifeNetworkJudgment', scenarioId) };
}
function endpoints(value, nodes) {
  const ids = new Set(nodes.map(n => n.id));
  if (!ids.has(value.source) || !ids.has(value.target)) throw new Error('missing');
}
export function saveNetworkScenario(data, scenarioId, value, head) {
  validateNetworkValue('lifeNetworkScenario', value);
  return data.save(scenarioId, 'lifeNetworkScenario', value, { expectedHead: head });
}
export function saveNetworkEvaluation(data, value, head, getNodes) {
  validateNetworkValue('lifeNetworkValue', value);
  const entityId = valueId(value.scenarioId, value.nodeId);
  return data.transact((_records, heads) => {
    expected(heads, entityId, head);
    if (!getNodes().some(n => n.id === value.nodeId)) throw new Error('missing');
    return [...sceneChange(heads, value.scenarioId), { entityId, kind: 'lifeNetworkValue', value }];
  });
}
export function saveNetworkEdge(data, value, head, getNodes) {
  validateNetworkValue('lifeNetworkEdge', value);
  const entityId = edgeId(value);
  return data.transact((_records, heads) => {
    expected(heads, entityId, head); endpoints(value, getNodes());
    const changes = sceneChange(heads, value.scenarioId);
    const edges = rowsOf(heads, 'lifeNetworkEdge', value.scenarioId).filter(r => r.entityId !== entityId).map(r => r.value).concat(value);
    if (value.relation === 'supports' && supportBudgets(edges).some(b => b.target === value.target && b.allocated > 1 + 1e-10)) throw new Error('networkBudget');
    if (value.relation === 'requires' && dependencyConflicts(edges).length) throw new Error('networkCycle');
    return [...changes, { entityId, kind: 'lifeNetworkEdge', value }];
  });
}
export function deleteNetworkRecord(data, row) {
  if (!row || !['lifeNetworkValue', 'lifeNetworkEdge'].includes(row.kind)) return Promise.reject(new Error('format'));
  return data.save(row.entityId, row.kind, row.value, { expectedHead: row.id, deleted: true });
}
export function calibrateNetworkTarget(data, { scenarioId, target, openedEdges, judgments, expectedJudgment }, getNodes) {
  const members = openedEdges.map(r => r.value.source).sort().concat(UNALLOCATED);
  const comparison = pairwisePriorities(members, judgments);
  if (!comparison.complete || !comparison.consistent) return Promise.reject(new Error('networkComparison'));
  return data.transact((_records, heads) => {
    const changes = sceneChange(heads, scenarioId);
    const live = rowsOf(heads, 'lifeNetworkEdge', scenarioId).filter(r => r.value.target === target && r.value.relation === 'supports');
    if (live.length !== openedEdges.length || live.some(r => !openedEdges.some(o => o.entityId === r.entityId && o.id === r.id))) throw new Error('conflict');
    const entityId = judgmentId(scenarioId, target);
    expected(heads, entityId, expectedJudgment);
    for (const row of live) {
      endpoints(row.value, getNodes());
      changes.push({ entityId: row.entityId, kind: row.kind, value: { ...row.value, weight: comparison.weights[row.value.source] } });
    }
    changes.push({ entityId, kind: 'lifeNetworkJudgment', value: { version: 1, scenarioId, target, members, judgments } });
    return changes;
  });
}
