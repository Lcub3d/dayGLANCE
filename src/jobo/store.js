// The JOBO ledger's own door to IndexedDB.
//
// WHY NOT createIdbKeyValue
// That helper is built for caches, where "no value" is always the safe answer:
// every method resolves, `get()` falls through to the localStorage fallback when
// the IndexedDB read fails (so a broken read can come back as a stale or absent
// fallback value and look clean), and `set()` returns false rather than
// throwing. The ledger is original user data, and for original data the safe
// answer is the dangerous one: AN UNREADABLE LEDGER MUST NEVER BECOME AN
// AUTHORITATIVE EMPTY LIST. docs/jobo-ledger-persistence.md, "Storage medium".
//
// So this shares the open-database plumbing and differs in three ways:
//
// - A STRICT READ. `read()` resolves { ok: true, value } or { ok: false }.
//   Absent is { ok: true, value: undefined }. A failed IndexedDB read is
//   ok: false, full stop; it never consults the fallback, because a fallback
//   value is not the ledger.
// - A CHECKED WRITE. `write()` resolves { ok, value }, and the caller
//   acknowledges a save only on ok: true.
// - AN ATOMIC UPDATE. `update(fn)` runs read → fn(current) → put inside ONE
//   readwrite transaction. IndexedDB serializes readwrite transactions on a
//   store, so two tabs that both append see each other's record. Separate get
//   and set calls do not give that: both read [A], one writes [A, B], the other
//   [A, C], and B is gone before sync could merge it.
//
// THE FALLBACK IS COORDINATED OR READ-ONLY
// Where IndexedDB will not open, the same key lives in localStorage, which has
// no cross-tab transaction. Writes there take a Web Lock (navigator.locks, the
// pattern useTodoistSync already uses for its outbox), which is cross-tab
// exclusive, so the append guarantee holds. Where neither IndexedDB nor Web
// Locks exists the ledger is READ-ONLY on that device: `write` and `update`
// resolve { ok: false, error: 'readOnly' }, reads still work, and the hook says
// so. The first draft of the design promised that a record lost in the
// lockless window would be "picked up on the next read"; it would not, because
// it exists only in the losing tab's memory. Nothing here may lose a record and
// call it recoverable.
//
// `fn` passed to update() MUST be synchronous. Awaiting inside an IndexedDB
// transaction lets the transaction auto-commit before the put, and inside the
// lock it would widen the window the lock exists to close.

import { openDatabase, IDB_STORE_NAME } from '../utils/idbKeyValue.js';

export const DB_NAME = 'dayglance-jobo';
export const RECORDS_KEY = 'records';
export const LOCK_NAME = 'dayglance-jobo';

const failure = (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error ?? 'unknown') });

/**
 * @param {object} [options]
 * @param {string} [options.dbName]    IndexedDB database; one object store, one key.
 * @param {string} [options.key]       the key the whole collection lives under.
 * @param {() => Storage|undefined} [options.storage]  the fallback; a thunk so a
 *   missing or throwing localStorage is a read failure, not a crash at construction.
 * @param {() => LockManager|undefined} [options.locks] Web Locks for the fallback.
 * @param {(name: string) => Promise<IDBDatabase|null>} [options.open] the shared opener.
 */
export function createJoboStore({
  dbName = DB_NAME,
  key = RECORDS_KEY,
  storage = () => globalThis.localStorage,
  locks = () => globalThis.navigator?.locks,
  open = openDatabase,
} = {}) {
  const db = () => open(dbName);
  const hasLocks = () => { try { return typeof locks()?.request === 'function'; } catch { return false; } };

  // ── IndexedDB path ────────────────────────────────────────────────────────
  const idbRead = (database) => new Promise((resolve) => {
    let request;
    try {
      const tx = database.transaction(IDB_STORE_NAME, 'readonly');
      request = tx.objectStore(IDB_STORE_NAME).get(key);
      tx.oncomplete = () => resolve({ ok: true, value: request.result });
      tx.onerror = () => resolve(failure(tx.error));
      tx.onabort = () => resolve(failure(tx.error));
    } catch (err) { resolve(failure(err)); }
  });

  // read → fn → put in ONE transaction. The get's onsuccess runs while the
  // transaction is still active, so the put joins it; nothing else can commit
  // to this store in between.
  const idbUpdate = (database, fn) => new Promise((resolve) => {
    let next;
    let thrown;
    try {
      const tx = database.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const get = store.get(key);
      get.onsuccess = () => {
        try {
          next = fn(get.result);
          store.put(next, key);
        } catch (err) {
          thrown = err;
          try { tx.abort(); } catch { /* already aborting */ }
        }
      };
      tx.oncomplete = () => resolve({ ok: true, value: next });
      tx.onerror = () => resolve(failure(thrown ?? tx.error));
      tx.onabort = () => resolve(failure(thrown ?? tx.error));
    } catch (err) { resolve(failure(err)); }
  });

  // ── localStorage fallback ─────────────────────────────────────────────────
  const fallbackRead = () => {
    try {
      const raw = storage().getItem(key);
      return { ok: true, value: raw == null ? undefined : JSON.parse(raw) };
    } catch (err) { return failure(err); }
  };

  const fallbackUpdate = (fn) => {
    // Everything inside the lock is synchronous: read, fn, write, one turn.
    const current = fallbackRead();
    if (!current.ok) return current;
    try {
      const next = fn(current.value);
      storage().setItem(key, JSON.stringify(next));
      return { ok: true, value: next };
    } catch (err) { return failure(err); }
  };

  const underLock = (work) => locks().request(LOCK_NAME, async () => work());

  return {
    /** 'indexeddb' | 'fallback' (localStorage under a Web Lock) | 'readonly'. */
    async mode() {
      if (await db()) return 'indexeddb';
      return hasLocks() ? 'fallback' : 'readonly';
    },

    async writable() {
      return (await this.mode()) !== 'readonly';
    },

    /** { ok: true, value } with value undefined when nothing is stored; { ok: false } on failure. */
    async read() {
      const database = await db();
      if (database) return idbRead(database);
      return fallbackRead();
    },

    /** Replace the stored collection. { ok, value }. */
    async write(value) {
      return this.update(() => value);
    },

    /**
     * Atomically replace the stored collection with fn(current). fn must be
     * synchronous and is expected to MERGE, never blindly replace, so a record
     * another tab appended a moment ago survives. Resolves with the COMMITTED
     * value; the caller refreshes its state from that, not from what it meant
     * to write.
     */
    async update(fn) {
      const database = await db();
      if (database) return idbUpdate(database, fn);
      if (!hasLocks()) return { ok: false, error: 'readOnly' };
      try {
        return await underLock(() => fallbackUpdate(fn));
      } catch (err) { return failure(err); }
    },
  };
}
