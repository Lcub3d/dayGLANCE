import { describe, it, expect } from 'vitest';
import { analyzeNetwork, dependencyConflicts, networkNodeId, networkNodes, pairwisePriorities, UNALLOCATED, validateNetworkValue } from './supportNetwork.js';
const nodes = ['health', 'speech', 'career'].map(id => ({ id, title: id, kind: 'goal' }));
const value = (nodeId, baseValue) => ({ version: 1, scenarioId: 's', nodeId, baseValue, note: '' });
const edge = (source, target, weight, extra = {}) => ({ version: 1, scenarioId: 's', source, target, weight, relation: 'supports', condition: 'unknown', note: '', ...extra });
const evaluations = [value('health', 30), value('speech', 20), value('career', 50)];
const edges = [edge('health', 'career', .6), edge('speech', 'career', .4)];
describe('Life Map support importance', () => {
  it('passes importance backwards and reproduces 36/24/40, not link popularity', () => {
    const result = analyzeNetwork({ nodes, edges, evaluations });
    expect(result.complete).toBe(true);
    for (const [id, score, weight] of [['health', 45, .36], ['speech', 30, .24], ['career', 50, .4]]) {
      const row = result.rows.find(n => n.id === id);
      expect(row.score).toBeCloseTo(score); expect(row.weight).toBeCloseTo(weight);
      expect((row.baseValue || 0) + row.causes.reduce((s, c) => s + c.contribution, 0)).toBeCloseTo(score);
    }
  });
  it('does not count missing judgments as zero or auto-allocate 100% to one link', () => {
    const result = analyzeNetwork({ nodes, edges: [edge('health', 'career', null)], evaluations: [value('career', 50)] });
    expect(result.complete).toBe(false); expect(result.unweighted).toHaveLength(1);
    expect(result.rows.find(n => n.id === 'health').baseValue).toBeNull();
    expect(result.rows.every(n => n.weight === null && n.rank === null)).toBe(true);
  });
  it('distinguishes explicit zero, unassessed and absent; unused nodes never gain default value', () => {
    const result = analyzeNetwork({ nodes, evaluations: [value('health', 0)] });
    expect(result.rows).toHaveLength(1); expect(result.complete).toBe(true);
    expect(result.rows[0].score).toBe(0); expect(result.rows[0].weight).toBeNull();
  });
  it('keeps unallocated influence instead of normalizing each target to one', () => {
    const r = analyzeNetwork({ nodes, edges: [edge('health', 'career', .2)], evaluations });
    expect(r.rows.find(n => n.id === 'health').score).toBe(35);
    expect(r.budgets[0].allocated).toBe(.2);
  });
  it('converges for feedback, without making prerequisites numeric', () => {
    const r = analyzeNetwork({ nodes, evaluations, edges: [edge('health', 'career', 1), edge('career', 'health', 1)] });
    expect(r.converged).toBe(true); expect(r.rows.find(n => n.id === 'health').score).toBeCloseTo(73.3333333);
    const p = analyzeNetwork({ nodes, evaluations, edges: [edge('health', 'career', null, { relation: 'requires', condition: 'unmet' })] });
    expect(p.rows.find(n => n.id === 'career').score).toBe(50);
    expect(p.rows.find(n => n.id === 'career').prerequisiteState).toBe('unmet');
  });
  it('detects imported/concurrent over-allocation rather than silently rescaling', () => {
    const r = analyzeNetwork({ nodes, evaluations, edges: [edge('health', 'career', .7), edge('speech', 'career', .4)] });
    expect(r.valid).toBe(false); expect(r.overBudget).toHaveLength(1); expect(r.rows.every(n => n.score === null)).toBe(true);
  });
  it('reports dangling references without rebinding to a title or forgetting their data', () => {
    const r = analyzeNetwork({ nodes: nodes.slice(1), evaluations, edges });
    expect(r.dangling).toEqual(['health']); expect(r.complete).toBe(false);
  });
  it('is independent of node/edge order and canvas coordinates', () => {
    const a = analyzeNetwork({ nodes, edges, evaluations });
    const b = analyzeNetwork({ nodes: [...nodes].reverse(), edges: [...edges].reverse(), evaluations: [...evaluations].reverse() });
    expect(b.rows).toEqual(a.rows);
  });
  it('detects dependency loops including downstream blockage; support loops stay legal', () => {
    expect(dependencyConflicts(edges)).toEqual([]);
    const requires = (s, t) => edge(s, t, null, { relation: 'requires' });
    expect(dependencyConflicts([requires('a', 'b'), requires('b', 'a'), requires('b', 'c')])).toEqual(['a', 'b', 'c']);
  });
  it('computes sensitivity only after calibration; labels the actual tested alphas', () => {
    const r = analyzeNetwork({ nodes, edges, evaluations });
    expect(r.testedAlphas).toEqual([.4, .5, .6]); expect(r.rows.every(n => n.rankRange.length === 2)).toBe(true);
  });
  it('keeps stable stage identity when a stage materializes to a native goal', () => {
    const stage = { id: '["stage","w","v","s"]', kind: 'goal', wishId: 'w', visionId: 'v', stepId: 's' };
    expect(networkNodeId({ ...stage, id: '["goal","native"]' })).toBe(networkNodeId(stage));
    expect(networkNodes({ nodes: [{ id: 'root', kind: 'root' }, { ...stage, missing: true }, { id: 'g', kind: 'goal' }] })).toHaveLength(1);
  });
  it.each([-1, 1, NaN, Infinity])('rejects unsafe propagation alpha %s', alpha => {
    expect(() => analyzeNetwork({ nodes, evaluations, alpha })).toThrow('format');
  });
  it('rejects duplicate relationships and impossible numeric fields', () => {
    expect(analyzeNetwork({ nodes, edges: [...edges, edges[0]], evaluations }).valid).toBe(false);
    expect(() => validateNetworkValue('lifeNetworkEdge', edge('a', 'b', -1))).toThrow();
    expect(() => validateNetworkValue('lifeNetworkValue', value('a', '30'))).toThrow();
  });
});
describe('optional local pairwise calibration', () => {
  it('requires every pair, does not assume equal answers', () => {
    expect(pairwisePriorities(['a', 'b', UNALLOCATED], []).missing).toBe(3);
  });
  it('computes reciprocal principal priorities and zero inconsistency for consistent ratios', () => {
    const r = pairwisePriorities(['a', 'b', 'c'], [{ a: 'a', b: 'b', ratio: 2 }, { a: 'a', b: 'c', ratio: 4 }, { a: 'b', b: 'c', ratio: 2 }]);
    expect(r.weights.a).toBeCloseTo(4 / 7); expect(r.weights.b).toBeCloseTo(2 / 7); expect(r.consistencyRatio).toBeCloseTo(0);
  });
  it('warns about contradictory cycles and rejects duplicate pairs', () => {
    const j = [{ a: 'a', b: 'b', ratio: 9 }, { a: 'a', b: 'c', ratio: 1 / 9 }, { a: 'b', b: 'c', ratio: 9 }];
    expect(pairwisePriorities(['a', 'b', 'c'], j).consistent).toBe(false);
    expect(() => pairwisePriorities(['a', 'b', 'c'], [...j, j[0]])).toThrow();
  });
});

describe('import and uncertain-data defenses', () => {
  it('does not treat a vanished prerequisite as satisfied', () => {
    const a = analyzeNetwork({ nodes: [{ id: 'b' }], evaluations: [value('b', 5)], edges: [edge('missing', 'b', null, { relation: 'requires', condition: 'met' })] });
    expect(a.rows[0].prerequisiteState).toBe('unknown'); expect(a.complete).toBe(false);
  });
  it('does not select one of two competing imported semantic assessments', () => {
    const a = analyzeNetwork({ nodes: [{ id: 'a' }], evaluations: [value('a', 30), value('a', 90)] });
    expect(a.valid).toBe(false); expect(a.duplicateValues).toEqual(['a']); expect(a.rows[0].weight).toBeNull();
  });
  it('rejects malformed pair entries with a stable format error', () => {
    expect(() => pairwisePriorities(['a', 'b'], [null])).toThrow('format');
  });
  it('meets the fixed-point equation on a dense cyclic support graph', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const es = ids.flatMap((source, i) => ids.filter(target => target !== source).map(target => edge(source, target, (i + 1) / 30)));
    const a = analyzeNetwork({ nodes: ids.map(id => ({ id })), edges: es, evaluations: ids.map((id, i) => value(id, (i + 1) * 10)), alpha: .9 });
    expect(a.complete).toBe(true);
    for (const row of a.rows) expect(row.score).toBeCloseTo(row.baseValue + .9 * es.filter(e => e.source === row.id).reduce((sum, e) => sum + e.weight * a.rows.find(r => r.id === e.target).score, 0), 7);
  });
});
