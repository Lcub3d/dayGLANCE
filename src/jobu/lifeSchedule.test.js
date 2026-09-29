import { describe, it, expect } from 'vitest';
import { createJobuData, mergeJobuRecords } from './data.js';
import { createLifeNode, projectNativeNodes } from '../lifeplanner/entities.js';
import { migrateLifeNodes, readLifeNodes, patchLifeNode, saveLifeNode, deleteLifeNode, replaceNativeLifeNodes } from './lifeNodeStore.js';
import { readLifeSchedule, withLifeSchedule } from '../lifeplanner/schedule.js';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, applyRemoteEntity } from '../sync/dbAdapter.js';
async function setup(prefix = 'a') {
  let records = [], serial = 0;
  const store = { fail: false, read: async () => ({ ok: true, value: structuredClone(records) }), writable: async () => true,
    update: async fn => { if (store.fail) return { ok: false, error: 'quota' }; records = fn(records); return { ok: true, value: structuredClone(records) }; } };
  const data = createJobuData({ store, uuid: () => `${prefix}-${++serial}`, now: () => '2026-09-29T01:00:00.000Z' });
  await data.load();await migrateLifeNodes(data, { storage: { getItem: () => null, setItem: () => {} } });
  const row = id => readLifeNodes(data.get().records).heads.get(id);
  return { data, row, store };
}
const free = (id = 'idea') => createLifeNode({ id, type: 'wish', title: 'Same node', position: { x: 40, y: 90 },
  details: { wish: { memo: 'keep' }, schedule: { startDate: '2026-09-01', targetDate: '2027-03-01' } } });
const saveDates = (f, r, dates) => patchLifeNode(f.data, r.entityId, { details: withLifeSchedule(r.value, dates).details }, r.id);

describe('LifeMap dates use the existing durable node transaction', () => {
  it('writes one revision, survives reload and leaves hierarchy and all other data intact', async () => {
    const f = await setup();await saveLifeNode(f.data, free(), null);
    const opened = f.row('idea'), count = f.data.get().records.length;
    await saveDates(f, opened, { startDate: '2026-10-01', targetDate: '2027-04-01' });
    expect(f.data.get().records.length).toBe(count + 1);
    expect(f.row('idea').value).toMatchObject({ id: 'idea', position: { x: 40, y: 90 }, parentIds: [], details: { wish: { memo: 'keep' } } });
    await f.data.load();expect(readLifeSchedule(f.row('idea').value).targetDate).toBe('2027-04-01');f.data.dispose();
  });
  it('moves free-form dates to the first native facet and pins that owner when another binding is added', async () => {
    const f = await setup();await saveLifeNode(f.data, free(), null);
    await patchLifeNode(f.data, 'idea', { type: 'goal' }, f.row('idea').id);
    let value = f.row('idea').value;
    expect(value.details.schedule).toBeUndefined();expect(readLifeSchedule(value).source).toBe('goal');
    expect(projectNativeNodes([value], 'goal')[0]).toMatchObject({ startDate: '2026-09-01', targetDate: '2027-03-01' });
    const goalId = value.bindings.goalId;
    await patchLifeNode(f.data, 'idea', { type: 'project' }, f.row('idea').id);value = f.row('idea').value;
    expect(value.details.schedule).toEqual({ owner: 'goal' });expect(value.details.project.targetDate).toBeUndefined();
    expect(readLifeSchedule(value)).toMatchObject({ source: 'goal', targetDate: '2027-03-01' });
    await saveDates(f, f.row('idea'), { startDate: '2026-10-01', targetDate: '2027-05-01' });value = f.row('idea').value;
    expect(projectNativeNodes([value], 'goal')[0]).toMatchObject({ id: goalId, targetDate: '2027-05-01' });
    expect(value.details.project.targetDate).toBeUndefined();f.data.dispose();
  });
  it('reads native editor date changes without stale Gantt copies', async () => {
    const f = await setup();await saveLifeNode(f.data, { ...free(), type: 'project' }, null);
    const before = f.row('idea'), native = projectNativeNodes([before.value], 'project')[0];
    await replaceNativeLifeNodes(f.data, 'project', [{ ...native, targetDate: '2027-12-01' }], new Map([['idea', before.id]]));
    expect(readLifeSchedule(f.row('idea').value).targetDate).toBe('2027-12-01');expect(f.row('idea').value.details.schedule).toBeUndefined();f.data.dispose();
  });
  it('does not overwrite a newer editor or resurrect a deleted node', async () => {
    const f = await setup();await saveLifeNode(f.data, free(), null);const opened = f.row('idea');
    await patchLifeNode(f.data, 'idea', { title: 'Newer edit' }, opened.id);
    await expect(saveDates(f, opened, { startDate: '', targetDate: '2028-01-01' })).rejects.toThrow('conflict');
    expect(f.row('idea').value.title).toBe('Newer edit');const latest = f.row('idea');await deleteLifeNode(f.data, latest);
    await expect(saveDates(f, latest, { targetDate: '2029-01-01' })).rejects.toThrow('conflict');expect(f.row('idea').deleted).toBe(true);f.data.dispose();
  });
  it('keeps the old dates on storage failure and allows an explicit retry', async () => {
    const f = await setup();await saveLifeNode(f.data, free(), null);const opened = f.row('idea');f.store.fail = true;
    await expect(saveDates(f, opened, { startDate: '2026-10-01', targetDate: '2027-01-01' })).rejects.toThrow();
    expect(f.row('idea').id).toBe(opened.id);f.store.fail = false;
    await saveDates(f, opened, { startDate: '2026-10-01', targetDate: '2027-01-01' });expect(f.row('idea').value.details.schedule.targetDate).toBe('2027-01-01');f.data.dispose();
  });
  it('round-trips dates and ownership through existing export and restore', async () => {
    const a = await setup(), b = await setup('b');await saveLifeNode(a.data, { ...free(), type: 'project' }, null);
    await patchLifeNode(a.data, 'idea', { type: 'goal' }, a.row('idea').id);
    await b.data.restore(JSON.parse(a.data.export()).records);
    expect(readLifeSchedule(b.row('idea').value)).toEqual(readLifeSchedule(a.row('idea').value));
    expect(b.row('idea').value.details.schedule).toEqual({ owner: 'project' });a.data.dispose();b.data.dispose();
  });
  it('carries new dates in the same whole revision through both existing transport mappings', async () => {
    const f = await setup();await saveLifeNode(f.data, free(), null);const before = f.data.get().records;
    await saveDates(f, f.row('idea'), { startDate: '2026-11-01', targetDate: '2027-01-01' });const after = f.data.get().records;
    for (const [a, b] of [[before, after], [after, before]]) {
      const merged = mergeSyncData({ jobuRecords: a }, { jobuRecords: b }).data;
      expect(readLifeSchedule(readLifeNodes(merged.jobuRecords).heads.get('idea').value).startDate).toBe('2026-11-01');
    }
    expect(mergeJobuRecords(before, after)).toEqual(mergeJobuRecords(after, before));
    const entities = shredState({ jobuRecords: after });const receiver = { jobuRecords: [] };
    for (const { entity } of entities) if (entity._kind === 'jobuRecords') applyRemoteEntity(receiver, entity);
    expect(readLifeSchedule(readLifeNodes(receiver.jobuRecords).heads.get('idea').value).targetDate).toBe('2027-01-01');f.data.dispose();
  });
});
