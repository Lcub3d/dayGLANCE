import { describe, it, expect, vi } from 'vitest';
import { createLedger, mergeRecordsById, pickRecord } from './ledger.js';

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

describe('pickRecord (stand-in for core pickJoboRecord)', () => {
  it('newer updatedAt wins in either order', () => {
    const older = rec('x', { updatedAt: T1, title: 'old' });
    const newer = rec('x', { updatedAt: T2, title: 'new' });
    expect(pickRecord(older, newer)).toBe(newer);
    expect(pickRecord(newer, older)).toBe(newer);
  });

  // The convergence case from review: same id, same anchored updatedAt,
  // different snapshots. Each tier's own "remote wins" would never settle.
  it('on an exact tie the earlier observer wins, in either order', () => {
    // The late observer saw the task after a reschedule, so its snapshot
    // differs in a field that sorts BEFORE observedAt in canonical JSON.
    // MUTATION: drop the observedAt comparison and the JSON fallback picks
    // `late` here, because '2026-09-18' < '2026-09-19'.
    const early = rec('x', { observedAt: T1, date: '2026-09-19', title: 'as it was' });
    const late = rec('x', { observedAt: T2, date: '2026-09-18', title: 'after the reschedule' });
    expect(pickRecord(early, late)).toBe(early);
    expect(pickRecord(late, early)).toBe(early);
  });

  it('with everything tied, canonical JSON decides, and key order does not matter', () => {
    const a = { id: 'x', updatedAt: T1, observedAt: T1, title: 'a' };
    const b = { title: 'a', observedAt: T1, updatedAt: T1, id: 'x' };
    expect(pickRecord(a, b)).toBe(a);
    expect(pickRecord(b, a)).toBe(b); // equal content: whichever is first, same bytes
    const c = { ...a, title: 'b' };
    expect(pickRecord(a, c)).toBe(a);
    expect(pickRecord(c, a)).toBe(a);
  });

  it('carries one side when the other is missing', () => {
    expect(pickRecord(undefined, rec('x'))).toEqual(rec('x'));
    expect(pickRecord(rec('x'), undefined)).toEqual(rec('x'));
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

  it('notifies subscribers with each state change', async () => {
    const ledger = createLedger({ store: fakeStore() });
    const seen = [];
    ledger.subscribe((s) => seen.push(s.loaded));
    await ledger.load();
    expect(seen).toEqual([true]);
  });
});
