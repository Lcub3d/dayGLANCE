import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createJoboStore } from '../jobo/store.js';
import { createJobuData, materializeJobu, mergeJobuRecords } from './data.js';
import { readLifeNetwork, saveNetworkEvaluation, saveNetworkEdge, deleteNetworkRecord, calibrateNetworkTarget, edgeId, valueId } from './lifeNetworkStore.js';
import { DEFAULT_SCENARIO_ID as s, analyzeNetwork, UNALLOCATED } from '../lifeplanner/supportNetwork.js';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, applyRemoteEntity, applyRemoteDelete } from '../sync/dbAdapter.js';
const nodes = ['a', 'b', 'c'].map(id => ({ id, title: id, kind: 'goal' }));
const v = (nodeId, baseValue) => ({ version: 1, scenarioId: s, nodeId, baseValue, note: '' });
const e = (source, target, weight, extra = {}) => ({ version: 1, scenarioId: s, source, target, weight, condition: 'unknown', relation: 'supports', note: '', ...extra });
function fixture() {
  let raw = [], i = 0;
  const disk = { fail: false, writable: async () => true, read: async () => ({ ok: true, value: structuredClone(raw) }), update: async fn => {
    if (disk.fail) return { ok: false, error: 'quota' };
    try { raw = structuredClone(fn(raw)); return { ok: true, value: raw }; } catch (error) { return { ok: false, error: error.message }; }
  } };
  return { disk, data: createJobuData({ store: disk, uuid: () => `r${++i}` }) };
}
describe('personal Life Map network revisions', () => {
  it('creates no data on read and stores evaluations separately from native entities', async () => {
    const { data } = fixture(); await data.load();
    expect(readLifeNetwork(data.get().records).scenario.value.alpha).toBe(.5);
    expect(data.get().records).toEqual([]);
    await saveNetworkEvaluation(data, v('a', 30), null, () => nodes);
    expect(data.get().records.map(r => r.kind)).toEqual(['lifeNetworkScenario', 'lifeNetworkValue']); data.dispose();
  });
  it('rejects over-allocation without poisoning the data store; allows unweighted drawing', async () => {
    const { data } = fixture(); await data.load();
    await saveNetworkEdge(data, e('a', 'c', .7), null, () => nodes);
    await expect(saveNetworkEdge(data, e('b', 'c', .4), null, () => nodes)).rejects.toThrow('networkBudget');
    expect(data.get().error).toBeNull();
    await saveNetworkEdge(data, e('b', 'c', null), null, () => nodes); data.dispose();
  });
  it('rejects hard dependency cycles; allows feedback support cycles', async () => {
    const { data } = fixture(); await data.load();
    await saveNetworkEdge(data, e('a', 'b', null, { relation: 'requires' }), null, () => nodes);
    await expect(saveNetworkEdge(data, e('b', 'a', null, { relation: 'requires' }), null, () => nodes)).rejects.toThrow('networkCycle');
    await saveNetworkEdge(data, e('b', 'a', .4), null, () => nodes); data.dispose();
  });
  it('retains drafts on failed save and rejects stale values, relations and delete', async () => {
    const { data, disk } = fixture(); await data.load();
    await saveNetworkEdge(data, e('a', 'c', .6), null, () => nodes);
    const old = readLifeNetwork(data.get().records).edges[0];
    disk.fail = true; await expect(saveNetworkEdge(data, e('a', 'c', .4), old.id, () => nodes)).rejects.toThrow();
    expect(readLifeNetwork(data.get().records).edges[0]).toEqual(old);
    disk.fail = false; await saveNetworkEdge(data, e('a', 'c', .4), old.id, () => nodes);
    await expect(deleteNetworkRecord(data, old)).rejects.toThrow('conflict');
    await expect(saveNetworkEdge(data, e('a', 'c', .5), old.id, () => nodes)).rejects.toThrow('conflict');
    const row = readLifeNetwork(data.get().records).edges[0]; await deleteNetworkRecord(data, row);
    expect(readLifeNetwork(data.get().records).edges).toEqual([]);
    expect(data.get().records.filter(r => r.entityId === row.entityId)).toHaveLength(3); data.dispose();
  });
  it('does not overwrite data when endpoints disappear or scene is unknown', async () => {
    const { data } = fixture(); await data.load();
    await expect(saveNetworkEdge(data, e('a', 'missing', .3), null, () => nodes)).rejects.toThrow('missing');
    await expect(saveNetworkEvaluation(data, { ...v('a', 30), scenarioId: 'unknown' }, null, () => nodes)).rejects.toThrow('missing');
    expect(data.get().records).toHaveLength(0); data.dispose();
  });
  it('saves pairwise judgments and all edge weights atomically, retaining other factors', async () => {
    const { data } = fixture(); await data.load(); await saveNetworkEdge(data, e('a', 'c', null), null, () => nodes);
    const openedEdges = readLifeNetwork(data.get().records).edges;
    await calibrateNetworkTarget(data, { scenarioId: s, target: 'c', openedEdges, expectedJudgment: null,
      judgments: [{ a: 'a', b: UNALLOCATED, ratio: 3 }] }, () => nodes);
    const result = readLifeNetwork(data.get().records); expect(result.edges[0].value.weight).toBeCloseTo(.75);
    expect(result.judgments).toHaveLength(1);
    await expect(calibrateNetworkTarget(data, { scenarioId: s, target: 'c', openedEdges, expectedJudgment: null,
      judgments: [{ a: 'a', b: UNALLOCATED, ratio: 1 }] }, () => nodes)).rejects.toThrow('conflict'); data.dispose();
  });
  it('walks revisions through file/vault sync, export, restore and deletion without touching tasks', async () => {
    const { data: a } = fixture(), { data: b } = fixture(); await a.load(); await b.load();
    await saveNetworkEvaluation(a, v('c', 50), null, () => nodes); await saveNetworkEdge(a, e('a', 'c', .6), null, () => nodes);
    const old = readLifeNetwork(a.get().records).edges[0]; await deleteNetworkRecord(a, old);
    const task = { id: 'native', title: 'untouched' }, payload = { tasks: [task], jobuRecords: a.get().records };
    const merged = mergeSyncData(payload, { tasks: [task] }).data; const remote = {};
    for (const { entity } of shredState(merged)) if (entity._kind === 'jobuRecords') applyRemoteEntity(remote, entity);
    const count = remote.jobuRecords.length; applyRemoteDelete(remote, `jobuRecords:${old.id}`);
    expect(remote.jobuRecords).toHaveLength(count); await b.applyRemote(remote.jobuRecords); await b.load();
    expect(b.get().records).toEqual(a.get().records);
    const backup = JSON.parse(b.export()); await b.restore(backup.records);
    expect(readLifeNetwork(b.get().records).edges).toHaveLength(0);
    expect(readLifeNetwork(b.get().records).evaluations[0].value.baseValue).toBe(50);
    expect(task).toEqual({ id: 'native', title: 'untouched' }); a.dispose(); b.dispose();
  });
  it('surfaces over-budget or dependency conflicts after offline immutable merges', async () => {
    const { data: a } = fixture(), { data: b } = fixture(); await a.load(); await b.load();
    await saveNetworkEdge(a, e('a', 'c', .8), null, () => nodes);
    await saveNetworkEdge(b, e('b', 'c', .8), null, () => nodes);
    // Revision ids are device-unique in production; use distinct ids here.
    const merged = mergeJobuRecords(a.get().records, b.get().records.map(r => ({ ...r, id: `b-${r.id}` })));
    const state = readLifeNetwork(merged);
    expect(analyzeNetwork({ nodes, edges: state.edges.map(r => r.value) }).overBudget).toHaveLength(1); a.dispose(); b.dispose();
  });
  it('serializes real IndexedDB independent edits and catches a stale concurrent same-value edit', async () => {
    const idb = new IDBFactory();
    const db = await new Promise((resolve, reject) => { const r = idb.open('net', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const a = createJobuData({ store: createJoboStore({ open: async () => db }) }), b = createJobuData({ store: createJoboStore({ open: async () => db }) });
    await Promise.all([a.load(), b.load()]);
    await Promise.all([saveNetworkEvaluation(a, v('a', 30), null, () => nodes), saveNetworkEvaluation(b, v('b', 20), null, () => nodes)]);
    await a.load(); expect(readLifeNetwork(a.get().records).evaluations).toHaveLength(2);
    await expect(saveNetworkEvaluation(b, v('a', 99), null, () => nodes)).rejects.toThrow('conflict');
    a.dispose(); b.dispose(); db.close();
  });
});
