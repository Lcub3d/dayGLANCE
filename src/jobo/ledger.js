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
// - APPLIES DURING LOAD ARE HELD, AND HELD IS RETRYABLE. A remote apply before
//   `loaded` is queued and merged after hydration; merging it into the stale
//   initial state and then loading over it would drop it. The queue is drained
//   until it is stable, since an apply can land while the flush is in flight,
//   and a batch whose write fails, local or remote, goes back on the queue
//   rather than being published: the ledger retries it with backoff, and the
//   next apply or load carries it too. A completion the detector handed over
//   is therefore never lost to a transient storage failure, and the detector
//   can stay one-shot.
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

// Sorted-key JSON for content equality between two copies of one record. The
// sync tiers need "did the merge change this side" as a fact about content,
// not identity: the merge always builds a fresh array.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function sameCollection(side, merged) {
  if (!Array.isArray(side)) return false;
  const byId = new Map(side.filter((r) => r && r.id != null).map((r) => [String(r.id), canonical(r)]));
  if (byId.size !== merged.length) return false;
  return merged.every((r) => byId.get(String(r.id)) === canonical(r));
}

/**
 * The file-tier merge of two devices' collections, on the change-flag contract
 * every other collection in mergeSyncData uses: `localChanged` when the merge
 * differs from what this device holds (apply it), `remoteChanged` when it
 * differs from what the remote holds (push it), neither when the copies are
 * equal. A side that is `undefined` did not carry the collection (an older
 * build, or a device whose ledger has not loaded): it is never treated as
 * empty, and the side that has it is kept and marked as needing to reach the
 * other. No sync horizon is applied here, ever: the ledger's tombstones are
 * rows kept forever, and a horizon would drop exactly those (see
 * docs/jobo-ledger-persistence.md, "Both sync tiers").
 */
export function mergeJoboCollections(local, remote, pick = pickJoboRecord) {
  if (local === undefined && remote === undefined) {
    return { merged: undefined, localChanged: false, remoteChanged: false };
  }
  const merged = mergeRecordsById(local, remote, pick);
  return {
    merged,
    localChanged: !sameCollection(local, merged),
    remoteChanged: !sameCollection(remote, merged),
  };
}

const defaultSchedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  handle?.unref?.(); // never keep a Node process alive for a retry
  return handle;
};

/**
 * @param {object} deps
 * @param {ReturnType<import('./store.js').createJoboStore>} deps.store
 * @param {(a, b) => object} [deps.pick]  the merge rule; core's pickJoboRecord unless a test injects one.
 * @param {object} [deps.retry]  backoff for a failed write: { baseMs, maxMs, schedule, cancel }.
 */
export function createLedger({ store, pick = pickJoboRecord, retry = {} }) {
  const { baseMs = 2000, maxMs = 60000, schedule = defaultSchedule, cancel = clearTimeout } = retry;
  let state = {
    records: undefined,
    loaded: false,
    writable: undefined,
    error: null,
    // These statuses describe the ledger boundary, rather than a view's
    // interpretation of a Do.  They are deliberately finite strings so a
    // caller can render a retry/read-only state without inspecting errors.
    loadState: 'idle',
    writeState: 'idle',
    pendingIds: [],
    pendingCount: 0,
  };
  // Records not yet on disk: applies that arrived before the load, and any
  // batch whose write failed. Kept merged by id so a row re-delivered every
  // cycle by a sync tier's own retry never grows the queue.
  let held = [];
  // Every accepted mutation stays visible here until a committed winner covers
  // it.  `held` is only the next write batch and is emptied while update() is
  // in flight, so it cannot be the source of truth for detector reads.
  let pending = [];
  let retryHandle = null;
  // All callers share one drain. Without this gate, a second commit/apply
  // could take a newer held batch while the first update is still in flight,
  // then publish the older caller's snapshot last.
  let flushInFlight = null;
  let restoreInFlight = false;
  let attempts = 0;
  const listeners = new Set();

  const set = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const mergeInto = (incoming) => (current) => mergeRecordsById(current, incoming, pick);
  const pendingPatch = () => ({
    pendingIds: pending.map((record) => String(record.id)).sort(),
    pendingCount: pending.length,
  });
  const hold = (records) => {
    held = mergeRecordsById(held, records, pick);
    pending = mergeRecordsById(pending, records, pick);
    set(pendingPatch());
  };

  // A successful update covers a mutation when the committed collection has a
  // winner for the same id.  The pending entry may already have been replaced
  // by a newer mutation while the write was in flight; in that case it stays
  // pending and is flushed by the next loop.  A newer remote/tombstone winner
  // is still a durable answer for the id, so it covers the older candidate.
  const clearCovered = (batch, committed) => {
    if (!Array.isArray(committed) || !batch.length || !pending.length) return;
    const committedById = new Map(committed.filter((r) => r && r.id != null).map((r) => [String(r.id), r]));
    const batchById = new Map(batch.filter((r) => r && r.id != null).map((r) => [String(r.id), r]));
    pending = pending.filter((candidate) => {
      const id = String(candidate.id);
      const accepted = batchById.get(id);
      if (!accepted || canonical(candidate) !== canonical(accepted)) return true;
      const winner = committedById.get(id);
      if (!winner) return true;
      try {
        return pick(accepted, winner) !== winner && canonical(accepted) !== canonical(winner);
      } catch {
        return true;
      }
    });
  };

  // A failed write is retried on its own, with backoff, until the queue
  // drains; a write that lands by any other path resets the backoff.
  const scheduleRetry = () => {
    if (restoreInFlight || retryHandle !== null || !held.length) return;
    const delay = Math.min(maxMs, baseMs * 2 ** attempts);
    attempts += 1;
    retryHandle = schedule(() => {
      retryHandle = null;
      // A cancelled browser timer may already be queued. The restore gate
      // keeps that callback from racing the replacement write.
      if (restoreInFlight) return { ok: true, records: state.records };
      return retryHeld();
    }, delay);
  };
  async function retryHeld() {
    if (!state.loaded || !state.writable || !held.length) return { ok: true, records: state.records };
    const flushed = await flushHeld(state.records);
    if (!flushed.ok) { set({ error: flushed.error, writeState: 'retrying' }); scheduleRetry(); return flushed; }
    attempts = 0;
    set({ records: flushed.records, error: null, writeState: 'idle' });
    return flushed;
  }

  // Write everything held, draining until nothing arrives mid-flight. Returns
  // the committed records, or the failure with the batch back on the queue.
  async function flushHeldNow(records) {
    while (held.length) {
      const batch = held;
      held = [];
      set({ writeState: 'writing' });
      const committed = await store.update(mergeInto(batch));
      if (!committed.ok) {
        hold(batch);
        set({ writeState: 'retrying' });
        return { ok: false, error: committed.error, records };
      }
      records = committed.value;
      clearCovered(batch, records);
      // Once loaded, make each successful batch visible atomically with the
      // pending projection. During initial load records must remain hidden
      // until the strict read/flush completes.
      if (state.loaded) set({ records, ...pendingPatch() });
    }
    return { ok: true, records };
  }

  function flushHeld(records) {
    if (flushInFlight) return flushInFlight;
    const run = flushHeldNow(records);
    const tracked = run.finally(() => {
      if (flushInFlight === tracked) flushInFlight = null;
    });
    flushInFlight = tracked;
    return tracked;
  }

  async function load() {
    const [result, writable] = await Promise.all([store.read(), store.writable()]);
    if (!result.ok) {
      // Unreadable: stay unloaded, keep anything held for a later retry, and
      // say why. Never publish [] in place of what could not be read.
      set({ loaded: false, writable, error: result.error ?? 'storageRead', loadState: 'error' });
      return state;
    }
    let records = Array.isArray(result.value) ? result.value : [];
    let error = null;
    if (held.length) {
      if (writable) {
        // State is the committed value: a flush that fails publishes what the
        // read returned, not the merge that never reached disk, and the batch
        // stays held for the next apply or load to retry.
        const flushed = await flushHeld(records);
        records = flushed.records;
        error = flushed.ok ? null : flushed.error;
        if (flushed.ok) attempts = 0;
      } else {
        records = mergeRecordsById(records, held, pick);
        held = [];
        // A read-only device can accept a remote apply into its in-memory
        // projection, but it has no write queue to retry after reload.
        pending = [];
      }
    }
    set({
      records,
      loaded: true,
      writable,
      error,
      loadState: 'ready',
      writeState: error ? 'retrying' : (writable ? 'idle' : 'readonly'),
      ...pendingPatch(),
    });
    if (error) scheduleRetry();
    return state;
  }

  /**
   * A local mutation: records core constructed, with their own timestamps.
   * Merged by id, never a replace, so a record another tab appended survives.
   * Refuses when not loaded (nothing to merge into) or read-only. A write
   * that fails is held and retried, and says so: the caller's edge is
   * consumed safely because the ledger now owns the record.
   */
  async function commit(records) {
    if (!state.loaded) return { ok: false, error: 'notLoaded' };
    if (!state.writable) { set({ writeState: 'readonly' }); return { ok: false, error: 'readOnly' }; }
    hold(records);
    const flushed = await flushHeld(state.records);
    if (!flushed.ok) { set({ error: flushed.error, writeState: 'retrying' }); scheduleRetry(); return { ok: false, error: flushed.error, held: true }; }
    attempts = 0;
    set({ records: flushed.records, error: null, writeState: 'idle' });
    return { ok: true, value: flushed.records };
  }

  /**
   * A remote apply from either sync tier. Held while loading; merged with
   * incoming timestamps untouched; written where the device can write, and
   * merged into state alone where it cannot.
   */
  async function applyRemote(records) {
    if (!state.loaded) { hold(records); return { ok: true, held: true }; }
    if (!state.writable) {
      set({ records: mergeRecordsById(state.records, records, pick) });
      return { ok: true, written: false };
    }
    // Anything still held from a failed write rides along with this batch.
    hold(records);
    const flushed = await flushHeld(state.records);
    if (!flushed.ok) { set({ error: flushed.error, writeState: 'retrying' }); scheduleRetry(); return { ok: false, error: flushed.error, held: true }; }
    attempts = 0;
    set({ records: flushed.records, error: null, writeState: 'idle' });
    return { ok: true, written: true };
  }

  /**
   * A restore from a backup: the collection is REPLACED by what the backup
   * holds, as every other collection is on restore, through the checked
   * write. The caller reloads only on ok, and must await this: the restore
   * paths reload the page next, and a write still in flight at reload is
   * exactly the loss the persistence design names.
   */
  async function restore(records) {
    if (!Array.isArray(records)) return { ok: false, error: 'notAList' };
    if (!(await store.writable())) { set({ writeState: 'readonly' }); return { ok: false, error: 'readOnly' }; }
    restoreInFlight = true;
    try {
      // A restore replaces the collection. Stop queued retries before waiting
      // for an active one; otherwise a timer can start an old write while the
      // replacement write is in flight. The second cancellation catches a
      // retry scheduled by the active flush's failure continuation.
      if (retryHandle !== null) { cancel(retryHandle); retryHandle = null; }
      if (flushInFlight) await flushInFlight;
      if (retryHandle !== null) { cancel(retryHandle); retryHandle = null; }
      const result = await store.write(mergeRecordsById([], records, pick));
      if (!result.ok) { set({ error: result.error, writeState: 'error' }); return result; }
      held = [];
      pending = [];
      attempts = 0;
      set({ records: result.value, loaded: true, writable: true, error: null, loadState: 'ready', writeState: 'idle', ...pendingPatch() });
      return result;
    } finally {
      restoreInFlight = false;
      // A failed restore leaves the accepted mutation queue intact. Restore
      // the retry contract after the gate opens instead of silently dropping
      // its timer when the replacement write fails.
      if (held.length) scheduleRetry();
    }
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    commit,
    applyRemote,
    restore,
    /** Retry whatever is held now, ahead of the backoff. */
    retryHeld,
    /** Stop the retry timer; the held queue stays for a later load. */
    dispose() { if (retryHandle !== null) { cancel(retryHandle); retryHandle = null; } },
    /** How many records are waiting to reach disk. Test seam. */
    heldCount: () => held.length,
    /**
     * Read projection for planners that must see accepted mutations while a
     * storage write is held or in flight. It is never published as state,
     * sync, or backup data.
     */
    getMutationRecords: () => !state.loaded
      ? undefined
      : mergeRecordsById(state.records, pending, pick),
    pendingIds: () => pending.map((record) => String(record.id)).sort(),
  };
}
