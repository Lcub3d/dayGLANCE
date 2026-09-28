import { describe, expect, it } from 'vitest';
import { createJobuData } from './data.js';
import { createNativeLifeQueue } from './nativeLifeQueue.js';
import { migrateLifeNodes, readLifeNodes, patchLifeNode } from './lifeNodeStore.js';
import { lifeKey, projectNativeNodes } from '../lifeplanner/entities.js';

async function fixture() {
  let disk = [], sequence = Promise.resolve(), i = 0;
  const store = { fail: false, read: async () => ({ ok: true, value: structuredClone(disk) }), writable: async () => true,
    update(fn) {
      const work = sequence.then(() => {
        try {
          const value = fn(structuredClone(disk));
          if (store.fail) return { ok: false, error: 'quota' };
          disk = value; return { ok: true, value: structuredClone(value) };
        } catch (error) { return { ok: false, error: error.message }; }
      });
      sequence = work.catch(() => {}); return work;
    },
  };
  const data = createJobuData({ store, uuid: () => `a${++i}` }); await data.load();
  const raw = new Map([['day-planner-goals', JSON.stringify([{ id: 'g', title: 'Initial', status: 'active' }])]]);
  await migrateLifeNodes(data, { storage: { getItem: key => raw.get(key) ?? null, setItem: (k,v) => raw.set(k,v) } });
  const queue = createNativeLifeQueue(data);
  const expected = () => new Map(readLifeNodes(data.get().records).rows.map(r => [r.entityId,r.id]));
  const goals = () => projectNativeNodes(readLifeNodes(data.get().records).nodes, 'goal');
  return { data, store, queue, expected, goals };
}
const rename = title => list => list.map(row => ({ ...row, title }));

describe('ordered native edits over the canonical journal', () => {
  it('composes rapid edits without treating its own earlier save as a remote conflict', async () => {
    const f = await fixture(), opened = f.expected();
    const first = f.queue.enqueue('goal', rename('New title'), opened);
    const second = f.queue.enqueue('goal', list => list.map(row => ({ ...row, description: 'Second edit' })), opened);
    expect(f.goals()[0].title).toBe('Initial'); // only committed values are published
    await Promise.all([first, second]);
    expect(f.queue.get()).toEqual({ pending: 0, error: '' });
    expect(f.goals()[0]).toMatchObject({ title: 'New title', description: 'Second edit' }); f.data.dispose();
  });
  it('can edit a just-created native item before a React render publishes its first head', async () => {
    const f = await fixture(), opened = f.expected();
    const create = f.queue.enqueue('goal', list => [...list,{ id:'new',title:'Created',status:'active' }], opened);
    const edit = f.queue.enqueue('goal', list => list.map(row => row.id === 'new' ? {...row,title:'Edited'} : row), opened);
    await Promise.all([create,edit]);
    expect(f.queue.get()).toEqual({ pending:0,error:'' });
    expect(f.goals().find(g => g.id === 'new').title).toBe('Edited'); f.data.dispose();
  });
  it('pins a supplied native array rather than letting later caller mutation change the command', async () => {
    const f = await fixture(), replacement = f.goals(); replacement[0].title = 'User intent';
    const saved = f.queue.enqueue('goal', replacement, f.expected());
    replacement[0].title = 'Unrelated later mutation'; await saved;
    expect(f.goals()[0].title).toBe('User intent'); f.data.dispose();
  });
  it('halts on a failed write and retries the original sequence without dropping later input', async () => {
    const f = await fixture(), opened = f.expected(); f.store.fail = true;
    await Promise.all([f.queue.enqueue('goal', rename('One'), opened), f.queue.enqueue('goal', rename('Two'), opened)]);
    expect(f.queue.get()).toEqual({pending:2,error:'quota'}); expect(f.goals()[0].title).toBe('Initial');
    f.store.fail = false; await f.queue.retry();
    expect(f.goals()[0].title).toBe('Two'); expect(f.queue.get()).toEqual({pending:0,error:''});
    expect(f.data.get().records.filter(r => r.entityId === lifeKey('goal','g'))).toHaveLength(3); f.data.dispose();
  });
  it('discards a failed sequence only explicitly and starts a fresh sequence afterwards', async () => {
    const f = await fixture(); f.store.fail = true;
    await f.queue.enqueue('goal', rename('Discard this'), f.expected());
    f.queue.discard(); f.store.fail = false; await f.queue.retry();
    expect(f.goals()[0].title).toBe('Initial');
    await f.queue.enqueue('goal', rename('New intent'), f.expected());
    expect(f.goals()[0].title).toBe('New intent'); f.data.dispose();
  });
  it('never adopts a competing controller head as its own queued-write receipt', async () => {
    const f = await fixture(); const remote = createJobuData({store:f.store}); await remote.load();
    let changed = false, foreign;
    const off = f.data.subscribe(() => {
      const row = readLifeNodes(f.data.get().records).heads.get(lifeKey('goal','g'));
      if (!changed && row.value.title === 'Local first') {
        changed = true; foreign = patchLifeNode(remote,row.entityId,{title:'Remote winner'},row.id);
      }
    });
    const opened = f.expected();
    await Promise.all([f.queue.enqueue('goal', rename('Local first'), opened),f.queue.enqueue('goal', rename('Must not win'), opened)]);
    await foreign; await f.data.load(); off();
    expect(f.queue.get()).toEqual({pending:1,error:'conflict'});
    expect(f.goals()[0].title).toBe('Remote winner');
    await f.queue.retry(); expect(f.queue.get().error).toBe('conflict');
    expect(f.goals()[0].title).toBe('Remote winner'); f.queue.discard(); f.data.dispose(); remote.dispose();
  });
  it('forgets automatic local-head adoption when the command sequence finishes', async () => {
    const f = await fixture(), old = f.expected();
    await f.queue.enqueue('goal', rename('Committed'), old);
    await f.queue.enqueue('goal', rename('Stale screen'), old);
    expect(f.queue.get().error).toBe('conflict'); expect(f.goals()[0].title).toBe('Committed');
    f.queue.discard(); f.data.dispose();
  });
});
