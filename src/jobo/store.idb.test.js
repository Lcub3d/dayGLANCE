// The IndexedDB path of the ledger store, against a real implementation.
// fake-indexeddb/auto installs the globals for THIS FILE ONLY (vitest isolates
// each file), which is what keeps store.test.js honestly on the fallback.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createJoboStore } from './store.js';

let counter = 0;
const fresh = (over = {}) => createJoboStore({ dbName: `jobo-test-${++counter}`, ...over });
const rec = (id, at = '2026-09-19T15:10:02.000Z') => ({ id, updatedAt: at });

function memLocalStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

describe('IndexedDB path', () => {
  it('reports its mode and is writable', async () => {
    const store = fresh();
    expect(await store.mode()).toBe('indexeddb');
    expect(await store.writable()).toBe(true);
  });

  it('absent is ok with an undefined value, never an empty list', async () => {
    expect(await fresh().read()).toEqual({ ok: true, value: undefined });
  });

  it('round-trips through a checked write', async () => {
    const store = fresh();
    expect(await store.write([rec('do:1')])).toEqual({ ok: true, value: [rec('do:1')] });
    expect(await store.read()).toEqual({ ok: true, value: [rec('do:1')] });
  });

  // The whole reason the ledger has its own store: two writers over the same
  // database, appending at the same moment, and both records land.
  it('two tabs appending concurrently both land, because update runs in one transaction', async () => {
    const name = `jobo-test-${++counter}`;
    const tabA = createJoboStore({ dbName: name });
    const tabB = createJoboStore({ dbName: name });
    await tabA.write([rec('do:a')]);
    const append = (r) => (current) => [...(current || []), r];
    const [a, b] = await Promise.all([tabA.update(append(rec('do:b'))), tabB.update(append(rec('do:c')))]);
    expect(a.ok && b.ok).toBe(true);
    const { value } = await tabA.read();
    expect(value.map((r) => r.id).sort()).toEqual(['do:a', 'do:b', 'do:c']);
  });

  it('resolves with the COMMITTED value, not the intended one', async () => {
    const store = fresh();
    await store.write([rec('do:1')]);
    const result = await store.update((current) => [...current, rec('do:2')]);
    expect(result.value.map((r) => r.id)).toEqual(['do:1', 'do:2']);
  });

  it('a throwing fn aborts the transaction and leaves the ledger untouched', async () => {
    const store = fresh();
    await store.write([rec('do:1')]);
    const result = await store.update(() => { throw new Error('boom'); });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect((await store.read()).value).toEqual([rec('do:1')]);
  });

  // MUTATION: make idbRead fall through to fallbackRead on failure and this
  // fails: the seeded fallback value would come back looking clean.
  it('a failed IndexedDB read is a failure, and never consults the fallback', async () => {
    global.localStorage = memLocalStorage({ records: JSON.stringify([rec('do:stale')]) });
    const broken = { transaction() { throw new Error('InvalidStateError'); } };
    const store = createJoboStore({ dbName: 'broken', open: async () => broken });
    const result = await store.read();
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect((await store.update((c) => c)).ok).toBe(false);
  });
});
