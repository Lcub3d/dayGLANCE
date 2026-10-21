// Daily notes live in IndexedDB, one row per date (#2141).
//
// They were one localStorage key, rewritten whole on every note edit and the
// largest single term in the ~5 MB budget: a journal of a page a day fills it
// in a few years on its own. IndexedDB has room for decades of them.
//
// What moved is storage only. React state still holds the whole map, and both
// sync tiers still see it through buildSyncPayload. Four rules carry the
// weight:
//
// - NOT LOADED IS NOT EMPTY. The read is asynchronous, so until it finishes
//   (and for the rest of a session in which it failed) `dailyNotesSyncable()`
//   is false. Nothing is written, and the sync payload and backups leave the
//   notes out rather than publishing an empty map. The vault diff treats an
//   omitted map as "no information" (dbAdapter.absentCollectionKinds); the
//   file-tier merge already reads it as {} and keeps the remote's notes.
// - THE MIGRATION NEVER LOSES THE ONLY COPY. The localStorage copy is merged
//   into the database per date (newer lastModified wins, the sync rule), read
//   back, and removed only once every date it held is confirmed there. If
//   anything fails the notes stay in localStorage, and this session keeps
//   using it exactly as before.
// - NO DATABASE, NO MOVE. Where IndexedDB is unavailable the notes stay in
//   localStorage for good, with the #2138 load protection as before.
// - WRITES ARE PER DATE. Entries are replaced, never mutated, so a changed
//   date is one whose object differs from the last one written, and only
//   those rows are put or deleted.
//
// Module state on purpose: one app instance per page, shared by the app root,
// the headless root and the restore paths.

import { openDatabase, IDB_STORE_NAME } from './idbKeyValue.js';
import { mergeDailyNotes } from '@glance-apps/sync';
import { recordLoadFailure, isLoadProtected } from './loadFailures.js';
import { writeItem } from './storageWrites.js';

export const DAILY_NOTES_DB = 'dayglance-daily-notes';
export const LEGACY_NOTES_KEY = 'day-planner-daily-notes';

// 'loading' → 'idb' | 'localStorage' | 'failed'
let mode = 'loading';
let persisted = {}; // date → entry, as last written (or loaded)
let pending = Promise.resolve();

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

/** The IndexedDB rows, behind a small interface so tests can supply their own. */
export function createIdbNotesBackend(open = openDatabase, dbName = DAILY_NOTES_DB) {
  const run = async (mode_, work) => {
    const db = await open(dbName);
    if (!db) return fail(new Error('IndexedDB unavailable'));
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(IDB_STORE_NAME, mode_); } catch (error) { resolve(fail(error)); return; }
      const result = work(tx.objectStore(IDB_STORE_NAME));
      tx.oncomplete = () => resolve(ok(result?.collect ? result.collect() : undefined));
      tx.onerror = () => resolve(fail(tx.error));
      tx.onabort = () => resolve(fail(tx.error));
    });
  };
  return {
    async available() {
      return !!(await open(dbName));
    },
    // Strict: a failed read is a failure, never an empty map.
    readAll() {
      return run('readonly', (store) => {
        const keys = store.getAllKeys();
        const values = store.getAll();
        return {
          collect: () => Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]])),
        };
      });
    },
    write(puts, deletes) {
      return run('readwrite', (store) => {
        for (const [date, entry] of Object.entries(puts)) store.put(entry, date);
        for (const date of deletes) store.delete(date);
      });
    },
  };
}

let backend = createIdbNotesBackend();
let storage = () => globalThis.localStorage;

/**
 * Read the notes, migrating them out of localStorage on the first run. Always
 * resolves; `notes` is whatever could be read ({} when nothing could), and the
 * store's mode says whether it may be written and published.
 *
 * `readOnly` (the tray popup, which never writes) reads without migrating: a
 * localStorage copy is used as it is, and left for the main window to move.
 */
export async function loadDailyNotes({ readOnly = false } = {}) {
  let raw = null;
  let legacy = null;
  try { raw = storage()?.getItem(LEGACY_NOTES_KEY) ?? null; } catch { raw = null; }
  if (raw !== null) {
    try {
      legacy = JSON.parse(raw) || {};
    } catch (error) {
      // Unreadable is not empty (#2138): the banner offers it for download,
      // and nothing here writes over or removes it.
      recordLoadFailure(LEGACY_NOTES_KEY, error, raw);
    }
  }

  const keepInLocalStorage = (notes) => {
    mode = 'localStorage';
    persisted = notes;
    return { notes, mode };
  };

  if (!(await backend.available())) return keepInLocalStorage(legacy ?? {});

  const read = await backend.readAll();
  if (!read.ok) {
    // Not yet migrated: localStorage is still the copy of record.
    if (raw !== null) return keepInLocalStorage(legacy ?? {});
    console.error('[notes] could not read daily notes; they will not be saved or synced this session:', read.error);
    mode = 'failed';
    persisted = {};
    return { notes: {}, mode };
  }

  let notes = read.value || {};
  if (legacy && readOnly) return keepInLocalStorage(mergeDailyNotes(notes, legacy).merged);
  if (legacy) {
    const { merged } = mergeDailyNotes(notes, legacy);
    const puts = {};
    for (const [date, entry] of Object.entries(merged)) if (notes[date] !== entry) puts[date] = entry;
    const wrote = Object.keys(puts).length === 0 ? ok() : await backend.write(puts, []);
    const check = wrote.ok ? await backend.readAll() : wrote;
    const confirmed = check.ok && Object.keys(legacy).every((date) => check.value?.[date] !== undefined);
    if (!confirmed) {
      console.error('[notes] moving daily notes to IndexedDB did not complete; keeping them in localStorage:', check.error);
      return keepInLocalStorage(merged);
    }
    try { storage()?.removeItem(LEGACY_NOTES_KEY); } catch { /* removed next launch */ }
    notes = merged;
  }
  mode = 'idb';
  persisted = notes;
  return { notes, mode };
}

/** True once the notes are loaded and may be written, synced and backed up. */
export function dailyNotesSyncable() {
  return mode === 'idb' || mode === 'localStorage';
}

/** The notes as last loaded or written, or undefined while not syncable. */
export function getStoredDailyNotes() {
  return dailyNotesSyncable() ? persisted : undefined;
}

/**
 * Persist `notes`, writing only the dates that changed since the last write.
 * Resolves to true when it landed (or nothing changed), false when it did not
 * or the store may not be written. Writes run one after another.
 */
export function writeDailyNotes(notes) {
  if (!dailyNotesSyncable() || !notes || typeof notes !== 'object') return Promise.resolve(false);
  if (mode === 'localStorage') {
    if (isLoadProtected(LEGACY_NOTES_KEY)) return Promise.resolve(false);
    const landed = writeItem(LEGACY_NOTES_KEY, JSON.stringify(notes));
    if (landed) persisted = notes;
    return Promise.resolve(landed);
  }
  const before = persisted;
  const puts = {};
  for (const [date, entry] of Object.entries(notes)) if (before[date] !== entry) puts[date] = entry;
  const deletes = Object.keys(before).filter((date) => !(date in notes));
  if (Object.keys(puts).length === 0 && deletes.length === 0) return Promise.resolve(true);
  // Count it written at once, so the next diff starts from here; a failure
  // restores the previous baseline for those dates so they are tried again.
  persisted = notes;
  const job = pending.then(async () => {
    const result = await backend.write(puts, deletes);
    if (!result.ok) {
      console.error('[notes] could not save daily notes:', result.error);
      // Put the failed dates back to what is really stored, so the next
      // write's diff includes them again. Later writes may have moved other
      // dates on; those are left as they are.
      const restored = { ...persisted };
      for (const [date, entry] of Object.entries(puts)) {
        if (restored[date] !== entry) continue;
        if (before[date] === undefined) delete restored[date];
        else restored[date] = before[date];
      }
      for (const date of deletes) if (!(date in restored)) restored[date] = before[date];
      persisted = restored;
      return false;
    }
    return true;
  });
  pending = job.catch(() => false);
  return job;
}

/** Resolves once every write started so far has finished. Await before a reload. */
export function flushDailyNotes() {
  return pending;
}

/** Test seam: swap the backend and storage, and forget all state. */
export function resetDailyNotesStore({ backend: nextBackend, storage: nextStorage } = {}) {
  backend = nextBackend ?? createIdbNotesBackend();
  storage = nextStorage ? () => nextStorage : () => globalThis.localStorage;
  mode = 'loading';
  persisted = {};
  pending = Promise.resolve();
}

/** A backend over a plain object, for tests. `failReads` / `failWrites` script failures. */
export function createMemoryNotesBackend(seed = {}, { available = true } = {}) {
  const rows = { ...seed };
  const backend_ = {
    rows,
    failReads: 0,
    failWrites: 0,
    async available() { return available; },
    async readAll() {
      if (backend_.failReads > 0) { backend_.failReads -= 1; return fail(new Error('read failed')); }
      return ok({ ...rows });
    },
    async write(puts, deletes) {
      if (backend_.failWrites > 0) { backend_.failWrites -= 1; return fail(new Error('write failed')); }
      Object.assign(rows, puts);
      for (const d of deletes) delete rows[d];
      return ok();
    },
  };
  return backend_;
}

/**
 * Restore the notes a backup carries, replacing the stored ones, and resolve
 * once they are written: the restore paths reload the page right after.
 * Newer backups carry `dailyNotes` as a field; older ones only have the
 * localStorage key inside `deviceSettings`. A backup with neither leaves the
 * notes alone.
 */
export async function restoreDailyNotesFromBackup(data) {
  let notes = data?.dailyNotes;
  const legacyRaw = data?.deviceSettings?.[LEGACY_NOTES_KEY];
  if ((!notes || typeof notes !== 'object') && typeof legacyRaw === 'string') {
    try { notes = JSON.parse(legacyRaw); } catch { notes = null; }
  }
  if (!notes || typeof notes !== 'object') return false;
  if (dailyNotesSyncable()) {
    await writeDailyNotes(notes);
    await flushDailyNotes();
    if (mode === 'idb') {
      try { storage()?.removeItem(LEGACY_NOTES_KEY); } catch { /* ignore */ }
    }
    return true;
  }
  // Not loaded (or unreadable) this session: leave them where the next load
  // will find and move them.
  return writeItem(LEGACY_NOTES_KEY, JSON.stringify(notes));
}
