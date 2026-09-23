// The JOBO ledger as React sees it, without React.
//
// This is the state machine behind useJoboLedger: what "loaded" means, what
// happens to a remote apply that arrives before the load, how a local mutation
// and a remote apply each reach the store, and how state is refreshed from
// what was actually committed. It is a plain object so the whole lifecycle can
// be tested against a real store without rendering anything; the hook is a thin
// subscription over it. docs/jobo-ledger-persistence.md, "Lifecycle".
//
// THE RULES IT ENFORCES
// - NOT LOADED IS NOT EMPTY. `records` is undefined until a strict read
//   succeeds, and stays undefined if it fails. `buildSyncPayload` omits the
//   collection while it is undefined; `[]` means "this device's ledger is
//   empty", which is a different claim, and an unreadable ledger must never
//   make it.
// - APPLIES DURING LOAD ARE HELD. A remote apply before `loaded` is queued and
//   merged after hydration. Merging it into the stale initial state and then
//   loading over it would drop it.
// - EVERY MUTATION GOES THROUGH update(fn), AND STATE IS THE COMMITTED VALUE.
//   A record in state that is not on disk is exactly what a crash loses.
// - REMOTE APPLY PRESERVES INCOMING TIMESTAMPS. The merge is by id with core's
//   pickJoboRecord, the ONE rule both sync tiers use too (newer updatedAt, then
//   lower observedAt, then canonical JSON); nothing here restamps anything. The ledger has no field a
//   persist pass could re-derive, so it has no way to start the push churn the
//   `archived` field once caused.
// - A READ-ONLY DEVICE STILL LISTENS. Where the store cannot write (no
//   IndexedDB and no Web Locks) local mutations are refused with a visible
//   reason, but records arriving by sync are merged into state so the device
//   is not blind, only silent.

import { pickJoboRecord } from './core.js';

export const LEDGER_EMPTY = Object.freeze([]);

/**
 * Merge two collections by id, picking per record. Rows without an id are
 * dropped rather than rendered. Output is sorted by id so the result does not
 * depend on which side went first.
 */
export function mergeRecordsById(current, incoming, pick = pickJoboRecord) {
  const byId = new Map();
  for (const record of [...(current || []), ...(incoming || [])]) {
    if (!record || record.id == null) continue;
    const id = String(record.id);
    byId.set(id, byId.has(id) ? pick(byId.get(id), record) : record);
  }
  return [...byId.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, r]) => r);
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./store.js').createJoboStore>} deps.store
 * @param {(a, b) => object} [deps.pick]  the merge rule; core's pickJoboRecord unless a test injects one.
 */
export function createLedger({ store, pick = pickJoboRecord }) {
  let state = { records: undefined, loaded: false, writable: undefined, error: null };
  let held = [];
  const listeners = new Set();

  const set = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const mergeInto = (incoming) => (current) => mergeRecordsById(current, incoming, pick);

  async function load() {
    const [result, writable] = await Promise.all([store.read(), store.writable()]);
    if (!result.ok) {
      // Unreadable: stay unloaded, keep anything held for a later retry, and
      // say why. Never publish [] in place of what could not be read.
      set({ loaded: false, writable, error: result.error ?? 'storageRead' });
      return state;
    }
    let records = Array.isArray(result.value) ? result.value : [];
    if (held.length) {
      const queued = held;
      held = [];
      const merged = mergeRecordsById(records, queued.flat(), pick);
      if (writable) {
        const committed = await store.update(mergeInto(queued.flat()));
        records = committed.ok ? committed.value : merged;
      } else {
        records = merged;
      }
    }
    set({ records, loaded: true, writable, error: null });
    return state;
  }

  /**
   * A local mutation: records core constructed, with their own timestamps.
   * Merged by id, never a replace, so a record another tab appended survives.
   * Refuses when not loaded (nothing to merge into) or read-only.
   */
  async function commit(records) {
    if (!state.loaded) return { ok: false, error: 'notLoaded' };
    if (!state.writable) return { ok: false, error: 'readOnly' };
    const result = await store.update(mergeInto(records));
    if (!result.ok) { set({ error: result.error }); return result; }
    set({ records: result.value, error: null });
    return result;
  }

  /**
   * A remote apply from either sync tier. Held while loading; merged with
   * incoming timestamps untouched; written where the device can write, and
   * merged into state alone where it cannot.
   */
  async function applyRemote(records) {
    if (!state.loaded) { held.push(records); return { ok: true, held: true }; }
    if (!state.writable) {
      set({ records: mergeRecordsById(state.records, records, pick) });
      return { ok: true, written: false };
    }
    const result = await store.update(mergeInto(records));
    if (!result.ok) { set({ error: result.error }); return result; }
    set({ records: result.value, error: null });
    return { ok: true, written: true };
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    commit,
    applyRemote,
    /** How many applies are waiting on the load. Test seam. */
    heldCount: () => held.length,
  };
}
