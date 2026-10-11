import { describe, it, expect, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  applyAspireOperation, pickAspireEntry, mergeAspireEntries, mergeAspireCollections,
  visibleAspireEntries, createAspireNotebook, createAspireStore, ASPIRE_STORAGE_KEY,
} from './notebook.js';

const T0 = '2026-10-11T10:00:00.000Z';
const T1 = '2026-10-11T11:00:00.000Z';
const T2 = '2026-10-11T12:00:00.000Z';
const row = (id = 'a', overrides = {}) => ({ id, kind: 'wish', text: id, order: 1, createdAt: T0, updatedAt: T0, contentUpdatedAt: T0, orderUpdatedAt: T0, deleted: false, ...overrides });
const plan = (rows, op, at = T1) => applyAspireOperation(rows, op, { now: () => at, id: () => 'new' });
const memoryStore = (initial = []) => {
  let value = initial;
  return { read: async () => ({ ok: true, value }), writable: async () => true,
    update: async fn => { try { value = fn(value); return { ok: true, value }; } catch (error) { return { ok: false, error: error.message }; } }, peek: () => value };
};

describe('entry operations and merge', () => {
  it('adds deliberate blank rows without modeling goals or tasks', () => {
    const { entry } = plan([], { type: 'add', kind: 'motto', text: '' });
    expect(entry).toMatchObject({ id: 'new', kind: 'motto', text: '', deleted: false });
    expect(entry).not.toHaveProperty('goalId');
    expect(entry).not.toHaveProperty('completed');
  });
  it('merges concurrent text and order independently and converges in either direction', () => {
    const initial = [row('a'), row('b', { order: 2 })];
    const edit = plan(initial, { type: 'edit', id: 'a', text: 'New wish', expectedContentUpdatedAt: T0 }).records;
    const move = plan(initial, { type: 'reorder', kind: 'wish', expectedIds: ['a', 'b'], ids: ['b', 'a'] }, T2).records;
    const merged = mergeAspireEntries(edit, move);
    expect(visibleAspireEntries(merged).map(x => x.id)).toEqual(['b', 'a']);
    expect(merged.find(x => x.id === 'a').text).toBe('New wish');
    expect(mergeAspireEntries(move, edit)).toEqual(merged);
    expect(mergeAspireCollections(merged, merged)).toEqual({ merged, localChanged: false, remoteChanged: false });
  });
  it('uses deterministic ties for same-time concurrent edits', () => {
    const a = row('a', { text: 'A' }), b = row('a', { text: 'B' });
    expect(pickAspireEntry(a, b)).toEqual(pickAspireEntry(b, a));
    expect(pickAspireEntry(a, a)).toEqual(a);
  });
  it('a newer offline text edit cannot undo a delete, but an explicit restore can', () => {
    const deleted = plan([row()], { type: 'delete', id: 'a', expectedContentUpdatedAt: T0 }).entry;
    const edited = plan([row()], { type: 'edit', id: 'a', text: 'Offline', expectedContentUpdatedAt: T0 }, T2).entry;
    const merged = pickAspireEntry(deleted, edited);
    expect(merged.deleted).toBe(true);
    expect(merged.text).toBe('Offline');
    const restored = plan([merged], { type: 'restore', id: 'a', expectedContentUpdatedAt: merged.contentUpdatedAt }, T2).entry;
    expect(pickAspireEntry(restored, deleted).deleted).toBe(false);
    expect(pickAspireEntry(restored, edited).deleted).toBe(false);
    expect(() => plan([merged], { type: 'restore', id: 'a', expectedContentUpdatedAt: deleted.contentUpdatedAt })).toThrow('conflict');
  });
  it('stale content conflicts, while reordering preserves the latest text', () => {
    const edited = plan([row(), row('b', { order: 2 })], { type: 'edit', id: 'a', text: 'New', expectedContentUpdatedAt: T0 }).records;
    expect(() => plan(edited, { type: 'edit', id: 'a', text: 'Stale', expectedContentUpdatedAt: T0 })).toThrow('conflict');
    const moved = plan(edited, { type: 'reorder', kind: 'wish', expectedIds: ['a', 'b'], ids: ['b', 'a'] });
    expect(moved.records.find(x => x.id === 'a').text).toBe('New');
    expect(() => plan(moved.records, { type: 'reorder', kind: 'wish', expectedIds: ['a', 'b'], ids: ['b', 'a'] })).toThrow('conflict');
    expect(() => plan([...edited, row('c')], { type: 'reorder', kind: 'wish', expectedIds: ['a', 'b'], ids: ['b', 'a'] })).toThrow('conflict');
  });
  it('preserves absent collections, including ancient records and tombstones', () => {
    expect(mergeAspireCollections(undefined, undefined).merged).toBeUndefined();
    expect(mergeAspireCollections([row()], undefined)).toMatchObject({ merged: [row()], localChanged: false, remoteChanged: true });
  });
});

describe('strict persistence lifecycle', () => {
  it('guards edits against the atomic stored value, not a stale render', async () => {
    const store = memoryStore([row()]);
    const book = createAspireNotebook({ store, now: () => T2 });
    await book.load();
    const newer = plan([row()], { type: 'edit', id: 'a', text: 'Other tab', expectedContentUpdatedAt: T0 }).records;
    await store.update(() => newer);
    expect(await book.commit({ type: 'edit', id: 'a', text: 'Stale render', expectedContentUpdatedAt: T0 })).toMatchObject({ ok: false, error: 'conflict' });
    expect(store.peek()[0].text).toBe('Other tab');
  });
  it('queues remote data before load, commits it and survives a reload with feature UI off', async () => {
    const store = memoryStore([row('local')]);
    const book = createAspireNotebook({ store });
    expect(book.get().records).toBeUndefined();
    await book.applyRemote([row('remote')]);
    await book.load();
    expect(book.get().records.map(x => x.id)).toEqual(['local', 'remote']);
    const reloaded = createAspireNotebook({ store });
    await reloaded.load();
    expect(reloaded.get().records).toEqual(book.get().records);
  });
  it('does not claim an unreadable collection is empty or writable', async () => {
    const book = createAspireNotebook({ store: { ...memoryStore(), read: async () => ({ ok: false, error: 'readFailed' }) } });
    await book.load();
    expect(book.get()).toMatchObject({ records: undefined, loaded: false, error: 'readFailed' });
    expect(await book.commit({ type: 'add', kind: 'wish', text: '' })).toMatchObject({ ok: false, error: 'notLoaded' });
  });
  it('rejects structurally corrupt original data rather than replacing it', async () => {
    const store = memoryStore({ not: 'an array' });
    const book = createAspireNotebook({ store });
    await book.load();
    expect(book.get().loaded).toBe(false);
    expect(store.peek()).toEqual({ not: 'an array' });
  });
  it('failed local writes never publish or retry a stale draft', async () => {
    vi.useFakeTimers();
    const store = memoryStore([row()]);
    const write = store.update;
    store.update = vi.fn(async () => ({ ok: false, error: 'diskFull' }));
    const book = createAspireNotebook({ store });
    await book.load();
    expect(await book.commit({ type: 'edit', id: 'a', text: 'Unsaved', expectedContentUpdatedAt: T0 })).toMatchObject({ ok: false });
    expect(book.get().records[0].text).toBe('a');
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.update).toHaveBeenCalledTimes(1);
    store.update = write;
    book.dispose(); vi.useRealTimers();
  });
  it('failed remote writes stay retryable and are published only after durability', async () => {
    vi.useFakeTimers();
    const store = memoryStore([]);
    const write = store.update;
    store.update = async () => ({ ok: false, error: 'diskFull' });
    const book = createAspireNotebook({ store });
    await book.load();
    await book.applyRemote([row()]);
    expect(book.get().records).toEqual([]);
    store.update = write;
    await vi.advanceTimersByTimeAsync(2000);
    expect(book.get().records).toEqual([row()]);
    expect(store.peek()).toEqual([row()]);
    book.dispose(); vi.useRealTimers();
  });
  it('read-only fallback still receives remote data but refuses local mutation', async () => {
    const book = createAspireNotebook({ store: { ...memoryStore([]), writable: async () => false } });
    await book.load(); await book.applyRemote([row()]);
    expect(book.get().records).toEqual([row()]);
    expect(await book.commit({ type: 'delete', id: 'a', expectedContentUpdatedAt: T0 })).toEqual({ ok: false, error: 'readOnly' });
  });
  it('restore replaces durably and refuses reload-worthy success when storage fails', async () => {
    const store = memoryStore([row()]);
    const book = createAspireNotebook({ store });
    await book.load();
    expect((await book.restore([row('restored')])).ok).toBe(true);
    const reload = createAspireNotebook({ store }); await reload.load();
    expect(reload.get().records).toEqual([row('restored')]);
    store.update = async () => ({ ok: false, error: 'diskFull' });
    expect((await book.restore([])).ok).toBe(false);
    expect(book.get().records).toEqual([row('restored')]);
  });
  it('unchanged remote applies preserve the state reference and do not churn listeners', async () => {
    const book = createAspireNotebook({ store: memoryStore([row()]) });
    await book.load();
    const records = book.get().records;
    const listener = vi.fn(); book.subscribe(listener);
    await book.applyRemote([row()]);
    expect(book.get().records).toBe(records);
    expect(listener).not.toHaveBeenCalled();
  });
  it('uses a distinct fallback key, separate from the JOBO ledger', async () => {
    const values = new Map([['records', '[{"id":"jobo"}]']]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const store = createAspireStore({ open: async () => null, storage: () => storage, locks: () => ({ request: (_key, fn) => fn() }) });
    await store.write([row()]);
    expect(values.get('records')).toBe('[{"id":"jobo"}]');
    expect(JSON.parse(values.get(ASPIRE_STORAGE_KEY))).toEqual([row()]);
  });
  it('real IndexedDB transactions preserve cross-tab adds and reject a stale concurrent edit', async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`aspire-test-${crypto.randomUUID()}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const store = createAspireStore({ open: async () => database });
    const a = createAspireNotebook({ store, id: () => 'a', now: () => T1 });
    const b = createAspireNotebook({ store, id: () => 'b', now: () => T1 });
    await Promise.all([a.load(), b.load()]);
    const added = await Promise.all([a.commit({ type: 'add', kind: 'wish', text: 'A' }), b.commit({ type: 'add', kind: 'wish', text: 'B' })]);
    expect(added.every(result => result.ok)).toBe(true);
    expect((await store.read()).value.map(x => x.id)).toEqual(['a', 'b']);
    const expectedContentUpdatedAt = added[0].entry.contentUpdatedAt;
    const changes = await Promise.all([a.commit({ type: 'edit', id: 'a', text: 'First', expectedContentUpdatedAt }), b.commit({ type: 'edit', id: 'a', text: 'Second', expectedContentUpdatedAt })]);
    expect(changes.filter(result => result.ok)).toHaveLength(1);
    expect(changes.filter(result => result.error === 'conflict')).toHaveLength(1);
    database.close();
  });
});

describe('restore racing remote delivery', () => {
  it('keeps a remote batch delivered while the replacement write is in flight', async () => {
    const store = memoryStore([row('original')]);
    const book = createAspireNotebook({ store });
    await book.load();
    const update = store.update;
    let finish, started;
    const entered = new Promise(resolve => { started = resolve; });
    store.update = async fn => {
      store.update = update;
      started();
      await new Promise(resolve => { finish = resolve; });
      return update(fn);
    };
    const restore = book.restore([row('backup')]);
    await entered;
    const apply = book.applyRemote([row('arrived-during-restore')]);
    finish();
    expect(await restore).toMatchObject({ ok: true });
    expect(book.get().records.map(entry => entry.id)).toEqual(['arrived-during-restore', 'backup']);
    expect(store.peek()).toEqual(book.get().records);
    await apply;
  });
  it('omits an unreadable notebook after a previously successful load', async () => {
    const store = memoryStore([row()]);
    const book = createAspireNotebook({ store });
    await book.load();
    store.read = async () => ({ ok: false, error: 'readFailed' });
    await book.load();
    expect(book.get().loaded).toBe(false);
    expect(book.get().records).toBeUndefined();
  });
});

describe('restore acknowledgement', () => {
  it('refuses reload-ready success if a late remote batch is not durable yet', async () => {
    vi.useFakeTimers();
    const store = memoryStore([row('original')]);
    const book = createAspireNotebook({ store });
    await book.load();
    const update = store.update;
    let finish, started;
    const entered = new Promise(resolve => { started = resolve; });
    store.update = async fn => {
      store.update = async () => ({ ok: false, error: 'diskFull' });
      started();
      await new Promise(resolve => { finish = resolve; });
      return update(fn);
    };
    const restoring = book.restore([row('backup')]);
    await entered;
    const incoming = book.applyRemote([row('late')]);
    finish();
    expect(await restoring).toMatchObject({ ok: false, error: 'diskFull' });
    await incoming;
    expect(store.peek().map(entry => entry.id)).toEqual(['backup']);
    store.update = update;
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.peek().map(entry => entry.id)).toEqual(['backup', 'late']);
    book.dispose();
    vi.useRealTimers();
  });
});

describe('restore drains every arrival before acknowledging', () => {
  it('waits for a second remote batch arriving during the first flush', async () => {
    const store = memoryStore([]);
    const book = createAspireNotebook({ store });
    await book.load();
    const update = store.update;
    let releaseRestore, releaseFirstFlush, signalRestore, signalFirstFlush;
    const restoreStarted = new Promise(resolve => { signalRestore = resolve; });
    const flushStarted = new Promise(resolve => { signalFirstFlush = resolve; });
    let writes = 0;
    store.update = async fn => {
      writes += 1;
      if (writes === 1) {
        signalRestore();
        await new Promise(resolve => { releaseRestore = resolve; });
      } else if (writes === 2) {
        signalFirstFlush();
        await new Promise(resolve => { releaseFirstFlush = resolve; });
      }
      return update(fn);
    };
    const restoring = book.restore([row('backup')]);
    await restoreStarted;
    const first = book.applyRemote([row('first')]);
    releaseRestore();
    await flushStarted;
    const second = book.applyRemote([row('second')]);
    releaseFirstFlush();
    expect(await restoring).toMatchObject({ ok: true });
    // Check at the acknowledgement, before awaiting queued apply promises.
    expect(store.peek().map(entry => entry.id)).toEqual(['backup', 'first', 'second']);
    expect(book.get().records).toEqual(store.peek());
    await Promise.all([first, second]);
  });
});
