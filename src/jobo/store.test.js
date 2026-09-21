// The fallback path: no IndexedDB here (vitest's node environment has none), so
// this is the store as a locked-down webview or a private window sees it.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createJoboStore } from './store.js';

const rec = (id, at = '2026-09-19T15:10:02.000Z') => ({ id, updatedAt: at });

function memLocalStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// A Web Locks stand-in that really serializes: each request waits for the
// previous holder of the same name.
function fakeLocks() {
  const tails = new Map();
  const log = [];
  return {
    log,
    request(name, callback) {
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(async () => { log.push(`acquire ${name}`); try { return await callback(); } finally { log.push(`release ${name}`); } });
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

describe('fallback with Web Locks', () => {
  const make = (locks = fakeLocks()) => ({ store: createJoboStore({ locks: () => locks }), locks });

  it('reports fallback mode and is writable', async () => {
    const { store } = make();
    expect(await store.mode()).toBe('fallback');
    expect(await store.writable()).toBe(true);
  });

  it('absent is ok with an undefined value', async () => {
    expect(await make().store.read()).toEqual({ ok: true, value: undefined });
  });

  it('writes under the lock and reads back', async () => {
    const { store, locks } = make();
    expect(await store.write([rec('do:1')])).toEqual({ ok: true, value: [rec('do:1')] });
    expect(await store.read()).toEqual({ ok: true, value: [rec('do:1')] });
    expect(locks.log).toEqual(['acquire dayglance-jobo', 'release dayglance-jobo']);
  });

  // MUTATION: drop underLock() from update() and the two appends interleave
  // on the shared storage; the second read-modify-write overwrites the first.
  it('two tabs appending concurrently both land under the lock', async () => {
    const locks = fakeLocks();
    const tabA = createJoboStore({ locks: () => locks });
    const tabB = createJoboStore({ locks: () => locks });
    await tabA.write([rec('do:a')]);
    const append = (r) => (current) => [...(current || []), r];
    await Promise.all([tabA.update(append(rec('do:b'))), tabB.update(append(rec('do:c')))]);
    expect((await tabB.read()).value.map((r) => r.id).sort()).toEqual(['do:a', 'do:b', 'do:c']);
  });

  it('corrupt storage is a read failure, not an empty ledger', async () => {
    global.localStorage = memLocalStorage({ records: '{not json' });
    const { store } = make();
    const result = await store.read();
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect((await store.update((c) => c)).ok).toBe(false);
  });

  it('a storage that throws is a failure on both read and write', async () => {
    global.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    const { store } = make();
    expect((await store.read()).ok).toBe(false);
    expect((await store.write([])).ok).toBe(false);
  });

  it('a write that fails leaves the previous value in place', async () => {
    const { store } = make();
    await store.write([rec('do:1')]);
    const inner = global.localStorage;
    global.localStorage = { getItem: (k) => inner.getItem(k), setItem() { throw new Error('QuotaExceededError'); } };
    const result = await store.update((c) => [...c, rec('do:2')]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('QuotaExceededError');
    expect((await store.read()).value).toEqual([rec('do:1')]);
  });
});

describe('fallback without Web Locks: read-only', () => {
  const make = () => createJoboStore({ locks: () => undefined });

  it('reports readonly and is not writable', async () => {
    const store = make();
    expect(await store.mode()).toBe('readonly');
    expect(await store.writable()).toBe(false);
  });

  it('still reads', async () => {
    global.localStorage = memLocalStorage({ records: JSON.stringify([rec('do:1')]) });
    expect(await make().read()).toEqual({ ok: true, value: [rec('do:1')] });
  });

  // MUTATION: let update() write without a lock and this fails: that is the
  // lockless window that loses a record and cannot call it recoverable.
  it('refuses to write, with the reason, rather than writing unlocked', async () => {
    const store = make();
    expect(await store.write([rec('do:1')])).toEqual({ ok: false, error: 'readOnly' });
    expect(await store.update((c) => c)).toEqual({ ok: false, error: 'readOnly' });
    expect(global.localStorage.getItem('records')).toBeNull();
  });
});
