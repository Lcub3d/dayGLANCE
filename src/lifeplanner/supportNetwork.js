// Personal decision aid, not a causal model or a full ANP implementation.
// A[source,target] passes the target's importance back to its support source.
export const NETWORK_KINDS = Object.freeze(['lifeNetworkScenario', 'lifeNetworkValue', 'lifeNetworkEdge', 'lifeNetworkJudgment']);
export const DEFAULT_SCENARIO_ID = 'lifeNetwork:default';
export const DEFAULT_SCENARIO = Object.freeze({ version: 1, name: '', horizon: '', alpha: 0.5 });
export const UNALLOCATED = '$unallocated';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const text = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const id = v => text(v) && v.length > 0;
const number = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const nullable = (v, max) => v === null || number(v, max);
const plain = v => v != null && typeof v === 'object' && !Array.isArray(v);
export function validateNetworkValue(kind, v) {
  if (!NETWORK_KINDS.includes(kind)) return;
  if (!plain(v) || v.version !== 1) throw new Error('format');
  if (kind === 'lifeNetworkScenario') {
    if (!text(v.name, 120) || !text(v.horizon, 1000) || !number(v.alpha, 0.9)) throw new Error('format');
  } else {
    if (!id(v.scenarioId)) throw new Error('format');
    if (kind === 'lifeNetworkValue' && (!id(v.nodeId) || !nullable(v.baseValue, 100) || !text(v.note, 4000))) throw new Error('format');
    if (kind === 'lifeNetworkEdge') {
      if (!id(v.source) || !id(v.target) || v.source === v.target || !['supports', 'requires'].includes(v.relation)
        || !nullable(v.weight, 1) || !['unknown', 'met', 'unmet'].includes(v.condition) || !text(v.note, 4000)
        || (v.relation === 'requires' && v.weight !== null)) throw new Error('format');
    }
    if (kind === 'lifeNetworkJudgment') {
      if (!id(v.target) || !Array.isArray(v.members) || !v.members.every(id) || new Set(v.members).size !== v.members.length
        || !Array.isArray(v.judgments)) throw new Error('format');
      pairwisePriorities(v.members, v.judgments);
    }
  }
}

// A planned stage keeps its identity after native-goal handoff. Screen IDs and
// positions remain presentation; neither a rename nor materialization rewires it.
export function networkNodeId(node) {
  if (node.networkId) return node.networkId;
  return node.kind === 'goal' && node.wishId != null && node.visionId != null && node.stepId != null
    ? JSON.stringify(['stage', String(node.wishId), String(node.visionId), String(node.stepId)]) : node.id;
}
export function networkNodes(graph) {
  const nodes = new Map();
  for (const n of graph.nodes) if (!n.missing && ['wish', 'vision', 'goal', 'project', 'task', 'untyped'].includes(n.kind)) {
    const key = networkNodeId(n);
    if (!nodes.has(key)) nodes.set(key, { ...n, mapId: n.id, id: key });
  }
  return [...nodes.values()].sort((a, b) => compare(a.id, b.id));
}

export function supportBudgets(edges) {
  const budgets = new Map();
  for (const e of edges) if (e.relation === 'supports') {
    const b = budgets.get(e.target) || { target: e.target, allocated: 0, unknown: 0 };
    if (e.weight === null) b.unknown++; else b.allocated += e.weight;
    budgets.set(e.target, b);
  }
  return [...budgets.values()].sort((a, b) => compare(a.target, b.target));
}

/** All unsatisfied prerequisites are independent AND conditions, not scores.
 * Kahn's remainder contains both cyclic nodes and nodes downstream of a cycle;
 * call it a dependency conflict, not an exact cycle-membership list.
 */
export function dependencyConflicts(edges) {
  const degree = new Map(), children = new Map();
  for (const { source, target } of edges.filter(e => e.relation === 'requires')) {
    if (!degree.has(source)) degree.set(source, 0);
    degree.set(target, (degree.get(target) || 0) + 1);
    if (!children.has(source)) children.set(source, []);
    children.get(source).push(target);
  }
  const ready = [...degree.keys()].filter(k => degree.get(k) === 0);
  for (let i = 0; i < ready.length; i++) for (const child of children.get(ready[i]) || []) {
    degree.set(child, degree.get(child) - 1); if (degree.get(child) === 0) ready.push(child);
  }
  return [...degree.keys()].filter(k => degree.get(k) > 0).sort(compare);
}
function solve(ids, bases, edges, alpha) {
  // ||alpha A||_1 <= .9; at most 600 iterations bounds residual conservatively.
  let values = new Map(ids.map(k => [k, bases.get(k) ?? 0]));
  for (let step = 0; step < 600; step++) {
    const next = new Map(ids.map(k => [k, bases.get(k) ?? 0]));
    for (const e of edges) next.set(e.source, next.get(e.source) + alpha * e.weight * values.get(e.target));
    let delta = 0;
    for (const k of ids) delta += Math.abs(next.get(k) - values.get(k));
    values = next;
    if (delta < 1e-9) return { values, converged: true };
  }
  return { values, converged: false };
}
function ranks(rows) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || compare(a.id, b.id));
  const out = new Map(); let rank = 1;
  sorted.forEach((r, i) => { if (i && Math.abs(r.score - sorted[i - 1].score) > 1e-8) rank = i + 1; out.set(r.id, rank); });
  return out;
}

export function analyzeNetwork({ nodes, edges = [], evaluations = [], alpha = 0.5 }) {
  if (!number(alpha, 0.9)) throw new Error('format');
  for (const e of edges) validateNetworkValue('lifeNetworkEdge', e);
  for (const v of evaluations) validateNetworkValue('lifeNetworkValue', v);
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const participants = new Set(evaluations.map(v => v.nodeId));
  for (const e of edges) { participants.add(e.source); participants.add(e.target); }
  const ids = [...participants].filter(k => lookup.has(k)).sort(compare);
  const dangling = [...participants].filter(k => !lookup.has(k)).sort(compare);
  const liveEdges = edges.filter(e => lookup.has(e.source) && lookup.has(e.target))
    .sort((a, b) => compare(JSON.stringify([a.source, a.target, a.relation]), JSON.stringify([b.source, b.target, b.relation])));
  const budgets = supportBudgets(edges);
  const overBudget = budgets.filter(b => b.allocated > 1 + 1e-10);
  const bases = new Map(evaluations.map(v => [v.nodeId, v.baseValue]));
  const unassessed = ids.filter(k => bases.get(k) == null);
  const unweighted = edges.filter(e => e.relation === 'supports' && e.weight === null);
  const duplicateKeys = new Set(), duplicates = [];
  for (const e of edges) {
    const key = JSON.stringify([e.source, e.target, e.relation]);
    if (duplicateKeys.has(key)) duplicates.push(key); duplicateKeys.add(key);
  }
  const seenValues = new Set(), duplicateValues = [];
  for (const value of evaluations) {
    if (seenValues.has(value.nodeId)) duplicateValues.push(value.nodeId);
    seenValues.add(value.nodeId);
  }
  const weighted = liveEdges.filter(e => e.relation === 'supports' && e.weight !== null);
  const valid = !overBudget.length && !duplicates.length && !duplicateValues.length;
  const solution = valid ? solve(ids, bases, weighted, alpha) : null;
  const complete = valid && solution.converged && !dangling.length && !unassessed.length && !unweighted.length;
  const total = solution ? [...solution.values.values()].reduce((a, b) => a + b, 0) : 0;
  const conflictIds = dependencyConflicts(edges);
  const rows = ids.map(key => {
    const baseValue = bases.get(key) ?? null;
    const knownScore = solution?.values.get(key) ?? null;
    const causes = weighted.filter(e => e.source === key).map(e => ({ target: e.target, weight: e.weight,
      contribution: solution ? alpha * e.weight * solution.values.get(e.target) : null }));
    const prerequisites = edges.filter(e => e.relation === 'requires' && e.target === key);
    return { ...lookup.get(key), baseValue, knownScore, score: complete ? knownScore : null,
      supportValue: knownScore === null ? null : knownScore - (baseValue ?? 0),
      weight: complete && total > 0 ? knownScore / total : null, causes,
      prerequisiteState: conflictIds.includes(key) ? 'conflict' : prerequisites.some(e => e.condition === 'unmet') ? 'unmet'
        : prerequisites.some(e => e.condition === 'unknown' || !lookup.has(e.source)) ? 'unknown' : prerequisites.length ? 'met' : 'none',
      prerequisites };
  });
  // Before calibration is complete, knownScore is only a partial-evidence
  // subtotal. Never rank missing values as zero or present normalized weights.
  const ranked = complete && total > 0 ? ranks(rows) : new Map();
  const testedAlphas = [...new Set([Math.max(0, alpha - .1), alpha, Math.min(.9, alpha + .1)])];
  const alternate = complete && total > 0 ? testedAlphas.map(a => {
    const s = solve(ids, bases, weighted, a);
    return ranks(ids.map(k => ({ id: k, score: s.values.get(k) })));
  }) : [];
  for (const row of rows) {
    row.rank = ranked.get(row.id) ?? null;
    const trials = alternate.map(m => m.get(row.id));
    row.rankRange = trials.length ? [Math.min(...trials), Math.max(...trials)] : null;
  }
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || compare(a.id, b.id));
  return { rows, complete, valid, total: complete ? total : null, budgets, overBudget, duplicates, duplicateValues,
    dangling, unassessed, unweighted, conflictIds, testedAlphas, converged: solution?.converged ?? false };
}

/** Local AHP comparison only: principal right eigenvector of a positive
 * reciprocal matrix; RI values are the conventional Saaty 1–8 table.
 * No unanswered pair is silently treated as equal. $unallocated is a real
 * calibration alternative, so one drawn support never gets 100% by default.
 */
export function pairwisePriorities(members, judgments) {
  if (!Array.isArray(members) || members.length < 2 || members.length > 8 || new Set(members).size !== members.length
    || !members.every(id) || !Array.isArray(judgments)) throw new Error('format');
  const n = members.length, matrix = Array.from({ length: n }, () => Array(n).fill(null)), known = new Set();
  for (let i = 0; i < n; i++) matrix[i][i] = 1;
  for (const j of judgments) {
    if (!plain(j)) throw new Error('format');
    const a = members.indexOf(j.a), b = members.indexOf(j.b);
    if (a < 0 || b < 0 || a === b || typeof j.ratio !== 'number' || !Number.isFinite(j.ratio)
      || j.ratio < 1 / 9 || j.ratio > 9) throw new Error('format');
    const key = [Math.min(a, b), Math.max(a, b)].join(':');
    if (known.has(key)) throw new Error('format');
    known.add(key); matrix[a][b] = j.ratio; matrix[b][a] = 1 / j.ratio;
  }
  const missing = n * (n - 1) / 2 - known.size;
  if (missing) return { complete: false, missing, weights: null, consistencyRatio: null };
  let vector = Array(n).fill(1 / n);
  for (let it = 0; it < 2000; it++) {
    const y = matrix.map(row => row.reduce((s, v, k) => s + v * vector[k], 0)), sum = y.reduce((a, b) => a + b, 0);
    const next = y.map(v => v / sum), delta = next.reduce((s, v, k) => s + Math.abs(v - vector[k]), 0);
    vector = next; if (delta < 1e-12) break;
  }
  const lambda = matrix.map(row => row.reduce((s, v, k) => s + v * vector[k], 0)).reduce((s, v, i) => s + v / vector[i], 0) / n;
  const ri = [0, 0, 0, .58, .90, 1.12, 1.24, 1.32, 1.41][n];
  const consistencyRatio = n <= 2 ? 0 : Math.max(0, (lambda - n) / (n - 1)) / ri;
  return { complete: true, missing: 0, weights: Object.fromEntries(members.map((k, i) => [k, vector[i]])),
    consistencyRatio, consistent: consistencyRatio <= .1 };
}
