import { describe, it, expect, vi } from 'vitest';
import { createLedger, mergeRecordsById } from './ledger.js';
import { pickJoboRecord } from './core.js';
import { buildJoboRecords } from './detector.js';

const T1 = '2026-09-19T15:10:02.000Z';
const T2 = '2026-09-19T16:00:00.000Z';
const rec = (id, over = {}) => ({ id, updatedAt: T1, observedAt: T1, title: 'Draft', ...over });

// A store with the real contract and a switchable personality: readable or
// not, writable or not, and a log of what was committed.
function fakeStore({ initial, readFails = false, writable = true, updateFails = false } = {}) {
  let value = initial;
  const store = {
    committed: [],
    async writable() { return writable; },
    async mode() { return writable ? 'indexeddb' : 'readonly'; },
    async read() { return readFails ? { ok: false, error: 'storageRead' } : { ok: true, value }; },
    async update(fn) {
      if (!writable) return { ok: false, error: 'readOnly' };
      if (updateFails) return { ok: false, error: 'storageWrite' };
      value = fn(value);
      store.committed.push(value);
      return { ok: true, value };
    },
    async write(v) { return store.update(() => v); },
    peek: () => value,
  };
  return store;
}

// The rule itself is core's and is tested in core.test.js. What the ledger owns
// is that the merge applies it in both orders and reaches the same result.
describe('the merge uses core pickJoboRecord', () => {
  it('on an exact updatedAt tie the earlier observer wins, whichever side is local', () => {
    const early = rec('x', { observedAt: T1, date: '2026-09-19', title: 'as it was' });
    const late = rec('x', { observedAt: T2, date: '2026-09-18', title: 'after the reschedule' });
    expect(mergeRecordsById([early], [late])[0]).toBe(early);
    expect(mergeRecordsById([late], [early])[0]).toBe(early);
    expect(pickJoboRecord(early, late)).toBe(early);
  });
});

describe('mergeRecordsById', () => {
  it('is order-independent and idempotent', () => {
    const a = [rec('1'), rec('2', { updatedAt: T2 })];
    const b = [rec('2', { updatedAt: T1, title: 'stale' }), rec('3')];
    const once = mergeRecordsById(a, b);
    expect(mergeRecordsById(b, a)).toEqual(once);
    expect(mergeRecordsById(once, once)).toEqual(once);
    expect(mergeRecordsById(once, [])).toEqual(once);
    expect(once.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(once[1].updatedAt).toBe(T2);
  });

  it('drops rows without an id rather than rendering them', () => {
    expect(mergeRecordsById([null, { title: 'no id' }], [rec('1')])).toEqual([rec('1')]);
  });

  it('a tombstone beats a stale live copy of the same id', () => {
    const stale = rec('1', { updatedAt: T1, deleted: false });
    const tombstone = rec('1', { updatedAt: T2, deleted: true });
    expect(mergeRecordsById([stale], [tombstone])[0].deleted).toBe(true);
    expect(mergeRecordsById([tombstone], [stale])[0].deleted).toBe(true);
  });
});

describe('createLedger lifecycle', () => {
  it('starts unloaded with records undefined, and loads absent as empty', async () => {
    const ledger = createLedger({ store: fakeStore() });
    expect(ledger.get()).toMatchObject({ records: undefined, loaded: false });
    expect(ledger.getMutationRecords()).toBeUndefined();
    await ledger.load();
    expect(ledger.get()).toMatchObject({ records: [], loaded: true, writable: true, error: null });
  });

  // MUTATION: return [] on a failed read and this fails. "Not loaded" and
  // "empty" are different claims, and the payload key hangs on the difference.
  it('a failed read stays unloaded and never publishes an empty ledger', async () => {
    const ledger = createLedger({ store: fakeStore({ readFails: true }) });
    await ledger.load();
    expect(ledger.get().records).toBeUndefined();
    expect(ledger.get().loaded).toBe(false);
    expect(ledger.get().error).toBe('storageRead');
    expect(await ledger.commit([rec('1')])).toEqual({ ok: false, error: 'notLoaded' });
  });

  it('hides the mutation projection after a reload fails, even when old state remains in memory', async () => {
    const store = fakeStore({ initial: [rec('on-disk')] });
    let readFails = false;
    store.read = async () => readFails
      ? { ok: false, error: 'storageRead' }
      : { ok: true, value: store.peek() };
    const ledger = createLedger({ store });
    await ledger.load();
    expect(ledger.getMutationRecords()).toEqual([rec('on-disk')]);
    readFails = true;
    await ledger.load();
    expect(ledger.get().loaded).toBe(false);
    expect(ledger.get().records).toEqual([rec('on-disk')]);
    expect(ledger.getMutationRecords()).toBeUndefined();
  });

  // MUTATION: merge the apply into state immediately instead of holding it,
  // and the load overwrites it.
  it('holds a remote apply that arrives before the load, then merges and writes it', async () => {
    const store = fakeStore({ initial: [rec('on-disk')] });
    const ledger = createLedger({ store });
    const result = await ledger.applyRemote([rec('from-remote')]);
    expect(result).toEqual({ ok: true, held: true });
    expect(ledger.heldCount()).toBe(1);
    await ledger.load();
    expect(ledger.heldCount()).toBe(0);
    expect(ledger.get().records.map((r) => r.id)).toEqual(['from-remote', 'on-disk']);
    expect(store.peek().map((r) => r.id)).toEqual(['from-remote', 'on-disk']); // written, not just in state
  });

  it('state is the committed value, not the intended one', async () => {
    const store = fakeStore({ initial: [] });
    // Another tab appended between our read and our write; the store's update
    // sees it, and so must our state.
    const original = store.update.bind(store);
    store.update = (fn) => original((current) => fn([...(current || []), rec('other-tab')]));
    const ledger = createLedger({ store });
    await ledger.load();
    await ledger.commit([rec('mine')]);
    expect(ledger.get().records.map((r) => r.id)).toEqual(['mine', 'other-tab']);
  });

  it('a local commit merges by id and never replaces', async () => {
    const store = fakeStore({ initial: [rec('1')] });
    const ledger = createLedger({ store });
    await ledger.load();
    await ledger.commit([rec('2')]);
    expect(store.peek().map((r) => r.id)).toEqual(['1', '2']);
  });

  // Remote apply preserves incoming timestamps: the newer remote copy replaces
  // the local one byte for byte, and the older one is ignored.
  it('a remote apply merges with incoming timestamps untouched', async () => {
    const store = fakeStore({ initial: [rec('1', { updatedAt: T1, title: 'local' }), rec('2', { updatedAt: T2, title: 'local newer' })] });
    const ledger = createLedger({ store });
    await ledger.load();
    const remote1 = rec('1', { updatedAt: T2, title: 'remote newer' });
    const remote2 = rec('2', { updatedAt: T1, title: 'remote older' });
    await ledger.applyRemote([remote1, remote2]);
    const { records } = ledger.get();
    expect(records[0]).toEqual(remote1);
    expect(records[1].title).toBe('local newer');
  });

  it('a failed write is not acknowledged and state is unchanged', async () => {
    const store = fakeStore({ initial: [rec('1')], updateFails: true });
    const ledger = createLedger({ store });
    await ledger.load();
    const result = await ledger.commit([rec('2')]);
    expect(result.ok).toBe(false);
    expect(ledger.get().records.map((r) => r.id)).toEqual(['1']);
    expect(ledger.get().error).toBe('storageWrite');
  });

  it('a read-only device refuses local mutations but still merges remote applies into state', async () => {
    const store = fakeStore({ initial: [rec('1')], writable: false });
    const ledger = createLedger({ store });
    await ledger.load();
    expect(ledger.get().writable).toBe(false);
    expect(await ledger.commit([rec('2')])).toEqual({ ok: false, error: 'readOnly' });
    expect(await ledger.applyRemote([rec('3')])).toEqual({ ok: true, written: false });
    expect(ledger.get().records.map((r) => r.id)).toEqual(['1', '3']);
    expect(store.committed).toEqual([]); // nothing was written
  });

  it('uses the injected pick rule for every merge', async () => {
    const pick = vi.fn((a, b) => a); // "local wins", to prove it is consulted
    const store = fakeStore({ initial: [rec('1', { title: 'local' })] });
    const ledger = createLedger({ store, pick });
    await ledger.load();
    await ledger.applyRemote([rec('1', { updatedAt: T2, title: 'remote' })]);
    expect(pick).toHaveBeenCalled();
    expect(ledger.get().records[0].title).toBe('local');
  });

  // MUTATION: publish the merged value when the flush fails, or clear `held`
  // before the write lands, and one of these fails.
  it('a failed flush of held applies publishes only what was read, keeps the batch, and retries it', async () => {
    const store = fakeStore({ initial: [rec('on-disk')] });
    const original = store.update.bind(store);
    let failing = true;
    store.update = (fn) => (failing ? Promise.resolve({ ok: false, error: 'storageWrite' }) : original(fn));
    const ledger = createLedger({ store });
    await ledger.applyRemote([rec('from-remote')]);
    await ledger.load();
    // Loaded, since the read succeeded, but state is the committed value.
    expect(ledger.get().loaded).toBe(true);
    expect(ledger.get().records.map((r) => r.id)).toEqual(['on-disk']);
    expect(ledger.get().error).toBe('storageWrite');
    expect(ledger.heldCount()).toBe(1);
    // The store recovers; the next apply carries the held batch with it.
    failing = false;
    expect(await ledger.applyRemote([rec('later')])).toEqual({ ok: true, written: true });
    expect(ledger.heldCount()).toBe(0);
    expect(ledger.get().error).toBe(null);
    expect(store.peek().map((r) => r.id)).toEqual(['from-remote', 'later', 'on-disk']);
  });

  // MUTATION: flush `held` once instead of until stable, and the second batch
  // sits in the queue after loaded flips true.
  it('an apply that lands while the held flush is in flight is written before the load completes', async () => {
    const store = fakeStore({ initial: [] });
    const ledger = createLedger({ store });
    await ledger.applyRemote([rec('first')]);
    const original = store.update.bind(store);
    let second = null;
    store.update = async (fn) => {
      // Mid-flush: another apply arrives while the ledger is still not loaded.
      if (!second) second = ledger.applyRemote([rec('second')]);
      return original(fn);
    };
    await ledger.load();
    expect(await second).toEqual({ ok: true, held: true });
    expect(ledger.heldCount()).toBe(0);
    expect(ledger.get().records.map((r) => r.id)).toEqual(['first', 'second']);
    expect(store.peek().map((r) => r.id)).toEqual(['first', 'second']);
  });

  it('a loaded apply whose write fails is held and lands with the next one', async () => {
    const store = fakeStore({ initial: [] });
    const original = store.update.bind(store);
    let failing = false;
    store.update = (fn) => (failing ? Promise.resolve({ ok: false, error: 'storageWrite' }) : original(fn));
    const ledger = createLedger({ store });
    await ledger.load();
    failing = true;
    expect(await ledger.applyRemote([rec('lost?')])).toEqual({ ok: false, error: 'storageWrite', held: true });
    expect(ledger.get().records).toEqual([]);
    expect(ledger.heldCount()).toBe(1);
    failing = false;
    await ledger.applyRemote([rec('next')]);
    expect(store.peek().map((r) => r.id)).toEqual(['lost?', 'next']);
    expect(ledger.heldCount()).toBe(0);
  });

  // MUTATION: drop the hold in commit and the completion the detector handed
  // over is gone after one transient failure.
  it('a failed LOCAL commit is held too, and retries on its own with backoff until it lands', async () => {
    const store = fakeStore({ initial: [] });
    const original = store.update.bind(store);
    let failing = true;
    store.update = (fn) => (failing ? Promise.resolve({ ok: false, error: 'storageWrite' }) : original(fn));
    const timers = [];
    const schedule = vi.fn((fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    const ledger = createLedger({ store, retry: { baseMs: 100, maxMs: 1000, schedule, cancel: vi.fn() } });
    await ledger.load();
    expect(await ledger.commit([rec('mine')])).toEqual({ ok: false, error: 'storageWrite', held: true });
    expect(ledger.get().records).toEqual([]);       // state is the committed value
    expect(ledger.get().error).toBe('storageWrite');
    expect(ledger.heldCount()).toBe(1);
    expect(timers.map((t) => t.ms)).toEqual([100]);
    await timers[0].fn();                            // first retry fails: backoff doubles
    expect(timers.map((t) => t.ms)).toEqual([100, 200]);
    expect(ledger.heldCount()).toBe(1);
    failing = false;
    await timers[1].fn();                            // second retry lands
    expect(ledger.heldCount()).toBe(0);
    expect(ledger.get().records.map((r) => r.id)).toEqual(['mine']);
    expect(ledger.get().error).toBe(null);
    expect(store.peek().map((r) => r.id)).toEqual(['mine']);
    expect(timers).toHaveLength(2);                  // nothing left to retry
  });

  it('the backoff is capped and resets after a successful write; dispose cancels the pending retry', async () => {
    const store = fakeStore({ initial: [] });
    const original = store.update.bind(store);
    let failing = true;
    store.update = (fn) => (failing ? Promise.resolve({ ok: false, error: 'storageWrite' }) : original(fn));
    const timers = [];
    const cancel = vi.fn();
    const ledger = createLedger({ store, retry: { baseMs: 100, maxMs: 250, schedule: (fn, ms) => { timers.push({ fn, ms }); return ms; }, cancel } });
    await ledger.load();
    await ledger.commit([rec('a')]);
    await timers[0].fn();
    await timers[1].fn();
    await timers[2].fn();
    expect(timers.map((t) => t.ms)).toEqual([100, 200, 250, 250]);
    failing = false;
    await ledger.applyRemote([rec('b')]);            // a write by another path drains the queue and resets
    expect(ledger.heldCount()).toBe(0);
    expect(timers).toHaveLength(4);                  // the pending timer is still armed
    ledger.dispose();
    expect(cancel).toHaveBeenCalledWith(250);
    failing = true;
    await ledger.commit([rec('c')]);
    expect(timers[4].ms).toBe(100);                  // backoff reset by the successful write
  });

  it('the held queue merges by id, so a row re-delivered every cycle does not grow it', async () => {
    const ledger = createLedger({ store: fakeStore({ initial: [] }) });
    await ledger.applyRemote([rec('same')]);
    await ledger.applyRemote([rec('same')]);
    await ledger.applyRemote([rec('same', { updatedAt: T2 })]);
    expect(ledger.heldCount()).toBe(1);
  });

  it('keeps an accepted completion visible while the write is held, so reopen is not lost', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let failing = true;
    store.update = async (fn) => failing
      ? { ok: false, error: 'storageWrite' }
      : originalUpdate(fn);
    const timers = [];
    const ledger = createLedger({ store, retry: { schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel: vi.fn() } });
    await ledger.load();

    const completion = {
      id: 'do:t1:completion', updatedAt: T1, observedAt: T1,
      title: 'Draft', progress: 'completed', timing: 'untimed', source: 'completion',
      taskId: 't1', date: '2026-09-19', startTime: null, endDate: null, endTime: null,
      planSnapshot: null, createdAt: T1, deleted: false,
    };
    expect(await ledger.commit([completion])).toMatchObject({ ok: false, held: true });
    expect(ledger.get().records).toEqual([]); // pending is never published as state/sync
    expect(ledger.getMutationRecords()).toEqual([completion]);
    expect(ledger.get().pendingIds).toEqual(['do:t1:completion']);
    expect(ledger.get().pendingCount).toBe(1);

    const reopened = buildJoboRecords({
      completions: [],
      uncompletions: [{ id: completion.id, uncheckedAt: T2 }],
    }, ledger.getMutationRecords(), { observedAt: T2 });
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ id: completion.id, progress: 'partial' });

    failing = false;
    expect(await ledger.commit(reopened)).toMatchObject({ ok: true });
    expect(store.peek()).toEqual(expect.arrayContaining([expect.objectContaining({ id: completion.id, progress: 'partial' })]));
    expect(ledger.getMutationRecords()).toEqual(ledger.get().records);
    expect(ledger.get().pendingCount).toBe(0);
    expect(timers).toHaveLength(1);
    ledger.dispose();
  });

  it('exposes a mutation projection during an in-flight write and clears it only after the winner commits', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let release;
    let started;
    store.update = (fn) => new Promise((resolve) => {
      started = resolve;
      release = () => resolve(originalUpdate(fn));
    });
    const ledger = createLedger({ store });
    await ledger.load();
    const completion = rec('do:flight', { progress: 'completed' });
    const commit = ledger.commit([completion]);
    await Promise.resolve();
    expect(ledger.heldCount()).toBe(0); // detached into store.update
    expect(ledger.getMutationRecords()).toEqual([completion]);
    expect(ledger.get().records).toEqual([]);
    release();
    await commit;
    expect(ledger.getMutationRecords()).toEqual(ledger.get().records);
    expect(ledger.get().pendingCount).toBe(0);
    ledger.dispose();
  });

  it('publishes a committed winner and an empty pending projection atomically', async () => {
    const store = fakeStore({ initial: [] });
    const ledger = createLedger({ store });
    await ledger.load();
    const seen = [];
    ledger.subscribe((state) => seen.push({
      ids: state.records?.map((record) => record.id) ?? undefined,
      pendingCount: state.pendingCount,
    }));
    await ledger.commit([rec('atomic')]);
    expect(seen.some((state) => state.pendingCount > 0 && state.ids.length === 0)).toBe(true);
    expect(seen.some((state) => state.pendingCount === 0 && state.ids.includes('atomic'))).toBe(true);
    expect(seen.filter((state) => state.pendingCount === 0 && !state.ids.includes('atomic'))).toEqual([]);
    ledger.dispose();
  });

  it('shares one flush across concurrent commits and drains newer held rows in order', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let calls = 0;
    let release;
    store.update = (fn) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { release = () => resolve(originalUpdate(fn)); });
      return originalUpdate(fn);
    };
    const ledger = createLedger({ store });
    await ledger.load();
    const first = ledger.commit([rec('first')]);
    await Promise.resolve();
    const second = ledger.commit([rec('second')]);
    release();
    await Promise.all([first, second]);
    expect(store.peek().map((record) => record.id)).toEqual(['first', 'second']);
    expect(ledger.get().records.map((record) => record.id)).toEqual(['first', 'second']);
    expect(ledger.getMutationRecords()).toEqual(ledger.get().records);
    expect(ledger.get().pendingCount).toBe(0);
    ledger.dispose();
  });

  it('waits for an in-flight retry before restore so the retry cannot reintroduce old rows', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let calls = 0;
    let release;
    store.update = (fn) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { release = () => resolve(originalUpdate(fn)); });
      return originalUpdate(fn);
    };
    const ledger = createLedger({ store });
    await ledger.load();
    const oldRow = rec('old');
    const commit = ledger.commit([oldRow]);
    await Promise.resolve();
    const restored = rec('restored', { updatedAt: T2 });
    const restore = ledger.restore([restored]);
    await Promise.resolve();
    expect(store.peek()).toEqual([]);
    release();
    await Promise.all([commit, restore]);
    expect(store.peek()).toEqual([restored]);
    expect(ledger.get().records).toEqual([restored]);
    expect(ledger.getMutationRecords()).toEqual([restored]);
    expect(ledger.get().pendingCount).toBe(0);
    ledger.dispose();
  });

  it('gates a queued retry during restore and schedules it again when restore fails', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let failing = true;
    store.update = async (fn) => failing
      ? { ok: false, error: 'storageWrite' }
      : originalUpdate(fn);
    const originalWrite = store.write.bind(store);
    let releaseRestore;
    let restoreFailed = true;
    store.write = () => new Promise((resolve) => {
      releaseRestore = () => resolve(restoreFailed
        ? { ok: false, error: 'storageWrite' }
        : originalWrite([rec('restored', { updatedAt: T2 })]));
    });
    const timers = [];
    const cancel = vi.fn();
    const ledger = createLedger({ store, retry: { schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel } });
    await ledger.load();
    const oldRow = rec('old');
    await ledger.commit([oldRow]);
    expect(timers).toHaveLength(1);

    const restore = ledger.restore([rec('restored', { updatedAt: T2 })]);
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledWith(1);
    // Calling a timer that was already queued after cancellation must not
    // flush the old row while the replacement write is still pending.
    expect(timers[0].fn()).toEqual({ ok: true, records: [] });
    expect(store.peek()).toEqual([]);
    releaseRestore();
    await expect(restore).resolves.toMatchObject({ ok: false, error: 'storageWrite' });
    expect(ledger.heldCount()).toBe(1);
    expect(timers).toHaveLength(2); // failed restore restored the retry contract

    restoreFailed = false;
    failing = false;
    await timers[1].fn();
    expect(store.peek()).toEqual([oldRow]);
    expect(ledger.get().pendingCount).toBe(0);
    ledger.dispose();
  });

  it('lets a newer remote tombstone win over a held local row and does not leak pending state', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let failing = true;
    store.update = async (fn) => failing
      ? { ok: false, error: 'storageWrite' }
      : originalUpdate(fn);
    const timers = [];
    const ledger = createLedger({ store, retry: { schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel: vi.fn() } });
    await ledger.load();
    const live = rec('same', { updatedAt: T1, title: 'local' });
    const tombstone = rec('same', { updatedAt: T2, deleted: true, title: 'remote' });
    await ledger.commit([live]);
    expect(ledger.getMutationRecords()[0]).toBe(live);
    await expect(ledger.applyRemote([tombstone])).resolves.toMatchObject({ ok: false, held: true });
    expect(ledger.getMutationRecords()).toEqual([tombstone]);
    failing = false;
    await ledger.applyRemote([]);
    expect(store.peek()).toEqual([tombstone]);
    expect(ledger.getMutationRecords()).toEqual(ledger.get().records);
    expect(ledger.get().pendingCount).toBe(0);
    expect(ledger.get().pendingIds).toEqual([]);
    expect(timers.length).toBeGreaterThan(0);
    ledger.dispose();
  });

  it('clears held mutations on a successful restore and never exports them through state', async () => {
    const store = fakeStore({ initial: [] });
    const originalUpdate = store.update.bind(store);
    let failing = true;
    store.update = async (fn) => failing
      ? { ok: false, error: 'storageWrite' }
      : originalUpdate(fn);
    const ledger = createLedger({ store, retry: { schedule: () => 1, cancel: vi.fn() } });
    await ledger.load();
    const held = rec('held');
    await ledger.commit([held]);
    expect(ledger.getMutationRecords()).toEqual([held]);
    const restored = rec('restored', { updatedAt: T2 });
    failing = false;
    await expect(ledger.restore([restored])).resolves.toMatchObject({ ok: true });
    expect(ledger.heldCount()).toBe(0);
    expect(ledger.get().pendingCount).toBe(0);
    expect(ledger.getMutationRecords()).toEqual([restored]);
    expect(ledger.get().records).toEqual([restored]);
    expect(store.peek()).toEqual([restored]);
    await ledger.retryHeld();
    expect(store.peek()).toEqual([restored]);
    ledger.dispose();
  });

  it('notifies subscribers with each state change', async () => {
    const ledger = createLedger({ store: fakeStore() });
    const seen = [];
    ledger.subscribe((s) => seen.push(s.loaded));
    await ledger.load();
    expect(seen).toEqual([true]);
  });
});
