import { describe, it, expect } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { createAspireNotebook, applyAspireOperation, visibleAspireEntries } from '../aspire/notebook.js';
import { shredState, reassembleState, isInsertOnly, COLLECTION_KINDS, applyRemoteEntity, applyRemoteDelete, absentCollectionKinds, carryAbsentCollections } from './dbAdapter.js';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-10-11T10:00:00.000Z';
const T2 = '2026-10-11T11:00:00.000Z';
const row = (id, order = 1) => ({ id, kind: 'wish', text: id, order, createdAt: T0, updatedAt: T0, contentUpdatedAt: T0, orderUpdatedAt: T0, deleted: false });
const empty = () => ({ tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [], habits: [], goals: [], projects: [], areas: [], gtdFrames: [], users: [], dailyNotes: {} });
const memoryStore = (initial = []) => { let value = initial; return { read: async () => ({ ok: true, value }), writable: async () => true, update: async fn => { value = fn(value); return { ok: true, value }; }, peek: () => value }; };
const payload = book => book.get().records === undefined ? empty() : { ...empty(), aspireEntries: book.get().records };

describe('Aspire through both app-data sync tiers', () => {
  it('registers independent always-merged rows and preserves an absent payload', () => {
    expect(COLLECTION_KINDS.aspireEntries).toEqual({ idField: 'id', tsField: 'updatedAt' });
    expect(isInsertOnly({ _kind: 'aspireEntries' })).toBe(true);
    expect(absentCollectionKinds({})).toContain('aspireEntries');
    expect(carryAbsentCollections({ 'aspireEntries:a': 'hash' }, {})).toEqual({ 'aspireEntries:a': 'hash' });
    expect(carryAbsentCollections({ 'aspireEntries:a': 'hash' }, { aspireEntries: [] })).toEqual({});
  });
  it('save reaches committed state, payload, file merge, vault row, remote persistence and reload', async () => {
    const a = createAspireNotebook({ store: memoryStore(), now: () => T1, id: () => 'a' });
    await a.load(); await a.commit({ type: 'add', kind: 'wish', text: 'Learn pottery' });
    const original = a.get().records;
    const serialized = JSON.parse(JSON.stringify(payload(a)));
    const merged = mergeSyncData(empty(), serialized, 30).data;
    expect(merged.aspireEntries).toEqual(original);
    const rows = shredState(merged).filter(row => row.kind === 'aspireEntries');
    expect(rows).toHaveLength(1);
    expect(reassembleState(rows).aspireEntries).toEqual(original);
    const mirror = empty();
    applyRemoteEntity(mirror, rows[0].entity);
    const bStore = memoryStore();
    const b = createAspireNotebook({ store: bStore });
    await b.load(); await b.applyRemote(mirror.aspireEntries);
    expect(b.get().records).toEqual(original);
    expect(bStore.peek()).toEqual(original);
    const reload = createAspireNotebook({ store: bStore }); await reload.load();
    expect(reload.get().records).toEqual(original);
  });
  it('old builds and retention cannot erase notebook entries or their tombstones', () => {
    const dead = { ...row('gone'), deleted: true, deletedAt: T0 };
    const local = { ...empty(), aspireEntries: [row('old'), dead] };
    const remote = { ...empty(), tombstonePrunedBefore: T1 };
    const merged = mergeSyncData(local, remote, 30).data;
    expect(merged.aspireEntries).toHaveLength(2);
    const mirrored = { ...empty(), aspireEntries: [dead] };
    applyRemoteDelete(mirrored, 'aspireEntries:gone');
    expect(mirrored.aspireEntries).toEqual([dead]);
  });
  it('file merges concurrent additions without whole-notebook replacement', () => {
    const merged = mergeSyncData({ ...empty(), aspireEntries: [row('a')] }, { ...empty(), aspireEntries: [row('b')] }, 30);
    expect(merged.data.aspireEntries.map(row => row.id)).toEqual(['a', 'b']);
    expect(merged.localChanged).toBe(true); expect(merged.remoteChanged).toBe(true);
  });
  it('vault devices converge after simultaneous text edits and reordering, without push churn', () => {
    const initial = [row('a'), row('b', 2)];
    const edit = applyAspireOperation(initial, { type: 'edit', id: 'a', text: 'Edited', expectedContentUpdatedAt: T0 }, { now: () => T1 }).records;
    const reordered = applyAspireOperation(initial, { type: 'reorder', kind: 'wish', ids: ['b', 'a'], expectedIds: ['a', 'b'] }, { now: () => T2 }).records;
    const a = createDevice('A', { ...empty(), aspireEntries: edit });
    const b = createDevice('B', { ...empty(), aspireEntries: reordered });
    const vault = createVault();
    for (const device of [a, b]) for (const item of initial) device.markDirty(`aspireEntries:${item.id}`);
    syncToConvergence(a, b, vault);
    expect(a.data.aspireEntries).toEqual(b.data.aspireEntries);
    expect(visibleAspireEntries(a.data.aspireEntries).map(row => row.id)).toEqual(['b', 'a']);
    expect(a.data.aspireEntries.find(row => row.id === 'a').text).toBe('Edited');
    const seq = vault.snapshot().map(row => row.seq);
    syncToConvergence(a, b, vault);
    expect(vault.snapshot().map(row => row.seq)).toEqual(seq);
  });
});
