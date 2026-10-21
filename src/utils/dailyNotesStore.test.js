import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  loadDailyNotes, writeDailyNotes, flushDailyNotes, dailyNotesSyncable, getStoredDailyNotes,
  restoreDailyNotesFromBackup, resetDailyNotesStore, createMemoryNotesBackend, createIdbNotesBackend,
  LEGACY_NOTES_KEY,
} from './dailyNotesStore.js';
import { getLoadFailures, resetLoadFailures } from './loadFailures.js';

const note = (text, lastModified) => ({ text, lastModified });

const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: vi.fn((k, v) => map.set(k, String(v))),
    removeItem: vi.fn((k) => map.delete(k)),
  };
};

describe('dailyNotesStore', () => {
  let storage;
  let backend;
  const setup = (legacy, rows = {}, options) => {
    storage = memoryStorage(legacy === undefined ? {} : { [LEGACY_NOTES_KEY]: typeof legacy === 'string' ? legacy : JSON.stringify(legacy) });
    backend = createMemoryNotesBackend(rows, options);
    resetDailyNotesStore({ backend, storage });
    // writeItem / loadFailures read the global
    globalThis.localStorage = storage;
  };
  beforeEach(() => {
    resetLoadFailures();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks(); });

  it('is not syncable before it has loaded, and writes nothing', async () => {
    setup({ '2026-10-01': note('a', '1') });
    expect(dailyNotesSyncable()).toBe(false);
    expect(getStoredDailyNotes()).toBeUndefined();
    expect(await writeDailyNotes({})).toBe(false);
    expect(backend.rows).toEqual({});
  });

  describe('the move out of localStorage', () => {
    it('moves the notes into the database and removes the old key once confirmed', async () => {
      const legacy = { '2026-10-01': note('a', '2026-10-01T00:00:00Z') };
      setup(legacy);
      const { notes, mode } = await loadDailyNotes();
      expect(mode).toBe('idb');
      expect(notes).toEqual(legacy);
      expect(backend.rows).toEqual(legacy);
      expect(storage.map.has(LEGACY_NOTES_KEY)).toBe(false);
      expect(dailyNotesSyncable()).toBe(true);
    });

    it('merges with rows already in the database, newer lastModified winning per date', async () => {
      setup(
        { d1: note('ls newer', '2026-10-02'), d2: note('ls older', '2026-10-01') },
        { d2: note('db newer', '2026-10-05'), d3: note('db only', '2026-10-03') },
      );
      const { notes } = await loadDailyNotes();
      expect(notes).toEqual({ d1: note('ls newer', '2026-10-02'), d2: note('db newer', '2026-10-05'), d3: note('db only', '2026-10-03') });
      expect(backend.rows).toEqual(notes);
    });

    it('keeps the notes in localStorage when the move cannot be written', async () => {
      setup({ d1: note('a', '1') });
      backend.failWrites = 1;
      const { mode, notes } = await loadDailyNotes();
      expect(mode).toBe('localStorage');
      expect(notes).toEqual({ d1: note('a', '1') });
      expect(storage.map.has(LEGACY_NOTES_KEY)).toBe(true);
      // and this session keeps writing there
      await writeDailyNotes({ d1: note('a', '1'), d2: note('b', '2') });
      expect(JSON.parse(storage.map.get(LEGACY_NOTES_KEY))).toHaveProperty('d2');
    });

    it('keeps the notes in localStorage when the read-back does not confirm them', async () => {
      setup({ d1: note('a', '1') });
      backend.failReads = 0;
      const realRead = backend.readAll;
      let reads = 0;
      backend.readAll = async () => (++reads === 2 ? { ok: true, value: {} } : realRead());
      const { mode } = await loadDailyNotes();
      expect(mode).toBe('localStorage');
      expect(storage.map.has(LEGACY_NOTES_KEY)).toBe(true);
    });

    it('the tray reads without moving anything', async () => {
      setup({ d1: note('ls', '2') }, { d2: note('db', '1') });
      const { notes } = await loadDailyNotes({ readOnly: true });
      expect(notes).toEqual({ d1: note('ls', '2'), d2: note('db', '1') });
      expect(backend.rows).toEqual({ d2: note('db', '1') });
      expect(storage.map.has(LEGACY_NOTES_KEY)).toBe(true);
    });

    it('stays in localStorage for good where there is no database', async () => {
      setup({ d1: note('a', '1') }, {}, { available: false });
      const { mode, notes } = await loadDailyNotes();
      expect(mode).toBe('localStorage');
      expect(notes).toEqual({ d1: note('a', '1') });
      expect(storage.map.has(LEGACY_NOTES_KEY)).toBe(true);
    });

    it('never removes or overwrites unreadable notes, and still loads the database', async () => {
      setup('{"d1": {"text": "half', { d9: note('db', '9') });
      const { mode, notes } = await loadDailyNotes();
      expect(mode).toBe('idb');
      expect(notes).toEqual({ d9: note('db', '9') });
      expect(storage.map.get(LEGACY_NOTES_KEY)).toBe('{"d1": {"text": "half');
      expect(getLoadFailures().map(f => f.key)).toEqual([LEGACY_NOTES_KEY]);
    });
  });

  describe('a database that cannot be read', () => {
    it('after the move: not syncable, nothing written, nothing published', async () => {
      setup(undefined, { d1: note('a', '1') });
      backend.failReads = 1;
      const { mode, notes } = await loadDailyNotes();
      expect(mode).toBe('failed');
      expect(notes).toEqual({});
      expect(dailyNotesSyncable()).toBe(false);
      expect(getStoredDailyNotes()).toBeUndefined();
      expect(await writeDailyNotes({})).toBe(false);
      expect(backend.rows).toEqual({ d1: note('a', '1') });
    });

    it('before the move: localStorage is still the copy of record', async () => {
      setup({ d1: note('a', '1') });
      backend.failReads = 1;
      const { mode, notes } = await loadDailyNotes();
      expect(mode).toBe('localStorage');
      expect(notes).toEqual({ d1: note('a', '1') });
    });
  });

  describe('writes', () => {
    it('writes only the dates that changed, and deletes the ones removed', async () => {
      const d1 = note('a', '1');
      const d2 = note('b', '2');
      setup(undefined, { d1, d2 });
      await loadDailyNotes();
      const write = vi.spyOn(backend, 'write');
      const d3 = note('c', '3');
      expect(await writeDailyNotes({ d1, d3 })).toBe(true);
      expect(write).toHaveBeenCalledWith({ d3 }, ['d2']);
      expect(backend.rows).toEqual({ d1, d3 });
      write.mockClear();
      expect(await writeDailyNotes({ d1, d3 })).toBe(true);
      expect(write).not.toHaveBeenCalled();
    });

    it('a failed write is retried by the next one', async () => {
      setup(undefined, {});
      await loadDailyNotes();
      backend.failWrites = 1;
      const d1 = note('a', '1');
      expect(await writeDailyNotes({ d1 })).toBe(false);
      expect(backend.rows).toEqual({});
      const d2 = note('b', '2');
      expect(await writeDailyNotes({ d1, d2 })).toBe(true);
      expect(backend.rows).toEqual({ d1, d2 });
    });
  });

  describe('restore', () => {
    it('replaces the notes with the backup field, and waits for the write', async () => {
      setup(undefined, { old: note('gone', '1') });
      await loadDailyNotes();
      await restoreDailyNotesFromBackup({ dailyNotes: { kept: note('b', '2') } });
      expect(backend.rows).toEqual({ kept: note('b', '2') });
    });

    it('reads an older backup from its deviceSettings key', async () => {
      setup(undefined, { old: note('gone', '1') });
      await loadDailyNotes();
      // applyDeviceSettings would have written the key; the restore takes it over.
      storage.setItem(LEGACY_NOTES_KEY, '{"d1":{"text":"from backup","lastModified":"5"}}');
      await restoreDailyNotesFromBackup({ deviceSettings: { [LEGACY_NOTES_KEY]: '{"d1":{"text":"from backup","lastModified":"5"}}' } });
      expect(backend.rows).toEqual({ d1: note('from backup', '5') });
      expect(storage.map.has(LEGACY_NOTES_KEY)).toBe(false);
    });

    it('leaves the notes alone when the backup carries none', async () => {
      setup(undefined, { d1: note('a', '1') });
      await loadDailyNotes();
      expect(await restoreDailyNotesFromBackup({ tasks: [] })).toBe(false);
      expect(backend.rows).toEqual({ d1: note('a', '1') });
    });
  });

  it('round-trips through a real IndexedDB', async () => {
    globalThis.indexedDB = new IDBFactory();
    const { openDatabase } = await import('./idbKeyValue.js');
    storage = memoryStorage({ [LEGACY_NOTES_KEY]: JSON.stringify({ d1: note('a', '1') }) });
    globalThis.localStorage = storage;
    const dbName = `notes-${Math.random()}`;
    resetDailyNotesStore({ backend: createIdbNotesBackend(openDatabase, dbName), storage });
    expect((await loadDailyNotes()).mode).toBe('idb');
    const d2 = note('b', '2');
    await writeDailyNotes({ d1: note('a', '1'), d2 });
    await flushDailyNotes();

    // A fresh load (the next launch) reads both rows back.
    resetDailyNotesStore({ backend: createIdbNotesBackend(openDatabase, dbName), storage });
    expect((await loadDailyNotes()).notes).toEqual({ d1: note('a', '1'), d2 });
    delete globalThis.indexedDB;
  });
});
