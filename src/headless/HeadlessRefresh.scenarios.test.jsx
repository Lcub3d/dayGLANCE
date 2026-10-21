// The headless refresh root, end to end under a fake native bridge: storage →
// the payload both tiers receive → the apply → storage and state → the
// launcher snapshot and heartbeat pushed → the outcome reported. The engines
// are scripted at the seams the root takes (sync/adapter.js's and
// sync/dbEngine.js's factories); their transports have their own tests.
//
// Two rules are held here that nothing else can see:
//   - the root boots only the allowlist: every bridge method it looks up is
//     in HEADLESS_BRIDGE_METHODS, so a feature that initialised here would
//     show up as a lookup outside it;
//   - the payload it builds from storage carries the slices App would load
//     through its own hooks (use24HourClock, users, …), because a slice read
//     differently here would be pushed to every device as an edit.

import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADLESS_BRIDGE_METHODS } from './headlessMode.js';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));
// The vault's root key lives in the Android Keystore; the "cached key" case
// is a resolved restore. The uncached case is the file tier's encrypted
// scenario below, which runs the real restore against the empty bridge.
vi.mock('../sync/dbEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  restoreDbRootKey: async () => true,
}));

const { default: HeadlessRefresh } = await import('./HeadlessRefresh.jsx');
const { IDBFactory } = await import('fake-indexeddb');
const notesStore = await import('../utils/dailyNotesStore.js');
const { openDatabase } = await import('../utils/idbKeyValue.js');
const { missingSyncEngineDeps } = await import('../hooks/useSyncEngineData.js');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
}

/** A bridge that answers only the allowlist and records every name looked up. */
function fakeBridge({ abort = false } = {}) {
  const lookups = new Set();
  const calls = { updateLauncherSnapshot: [], touchLauncherHeartbeat: [], recordLauncherRefresh: [], headlessDone: [] };
  const impl = {
    httpRequest: () => JSON.stringify({ status: 0, ok: false, error: 'no network in tests' }),
    supportsAsyncHttp: () => false,
    getSyncKey: () => '',
    getSyncKeyForSlot: () => '',
    storeSyncKey: () => {},
    storeSyncKeyForSlot: () => {},
    isVaultSseSupported: () => false,
    updateLauncherSnapshot: (json) => calls.updateLauncherSnapshot.push(JSON.parse(json)),
    touchLauncherHeartbeat: (json) => calls.touchLauncherHeartbeat.push(JSON.parse(json)),
    recordLauncherRefresh: (json) => calls.recordLauncherRefresh.push(JSON.parse(json)),
    headlessShouldAbort: () => abort,
    headlessDone: (json) => calls.headlessDone.push(JSON.parse(json)),
  };
  const proxy = new Proxy(impl, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      lookups.add(prop);
      return target[prop];
    },
    has(target, prop) { lookups.add(prop); return prop in target; },
  });
  return { bridge: proxy, lookups, calls };
}

const T = (id, title, extra = {}) => ({ id, title, date: '2026-10-19', startTime: '09:00', duration: 60, completed: false, notes: '', subtasks: [], lastModified: '2026-10-19T08:00:00.000Z', ...extra });

const seedStorage = (ls, { cloud = true, vault = false, encrypted = false } = {}) => {
  ls.setItem('day-planner-tasks', JSON.stringify([T('t1', 'Local task')]));
  ls.setItem('day-planner-unscheduled', JSON.stringify([{ id: 'u1', title: 'Inbox item', notes: '', subtasks: [], lastModified: '2026-10-19T08:00:00.000Z' }]));
  ls.setItem('day-planner-use-24h-clock', 'true');
  ls.setItem('dayglance-users', JSON.stringify([{ id: 'me', syncId: 'me', name: 'Me', updatedAt: '2026-10-01T00:00:00.000Z' }]));
  ls.setItem('day-planner-weather-temp-unit', 'celsius');
  ls.setItem('day-planner-gtd-frames', JSON.stringify([]));
  if (cloud) ls.setItem('day-planner-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'webdav', webdavUrl: 'https://dav.example', syncFolder: 'GLANCE/dayglance', encryptionEnabled: encrypted }));
  if (vault) ls.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acc' }));
};

/** A file-tier engine that merges one remote task into whatever payload it is given. */
function scriptedFileEngine({ remoteTasks = [T('t2', 'From the other device', { lastModified: '2026-10-19T09:30:00.000Z' })], remoteNotes = null, fail = null, lastSynced = '2026-10-19T10:00:00.000Z' } = {}) {
  const seen = { payloads: [], applies: 0 };
  const factory = vi.fn((callbacks) => ({
    sync: async () => {
      if (fail) throw fail;
      const payload = await callbacks.buildPayload();
      seen.payloads.push(payload);
      const merged = { ...payload.data, tasks: [...payload.data.tasks, ...remoteTasks] };
      if (remoteNotes) merged.dailyNotes = { ...(payload.data.dailyNotes || {}), ...remoteNotes };
      await callbacks.applyPayload(merged, { allowEmpty: true });
      seen.applies += 1;
    },
    getLastSynced: () => lastSynced,
  }));
  return { factory, seen };
}

async function until(predicate, { tries = 200 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  throw new Error('condition never held');
}

async function mount(props) {
  let root;
  await act(async () => { root = create(<HeadlessRefresh {...props} />); });
  return root;
}

describe('HeadlessRefresh', () => {
  let ls;
  let errors;
  beforeEach(() => {
    ls = memoryStorage();
    globalThis.localStorage = ls;
    globalThis.window = { location: { search: '?headless=refresh&clientId=rf-1' }, localStorage: ls };
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('runs the file tier from storage, applies the pull, pushes the snapshot and reports ran', async () => {
    seedStorage(ls);
    const { bridge, lookups, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    // The payload the tier received is what App would have sent: the stored
    // task lists AND the slices App loads through its own hooks.
    expect(engine.seen.payloads).toHaveLength(1);
    const data = engine.seen.payloads[0].data;
    expect(data.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(data.unscheduledTasks.map((t) => t.id)).toEqual(['u1']);
    expect(data.use24HourClock).toBe(true);
    expect(data.users).toEqual([expect.objectContaining({ syncId: 'me' })]);
    expect(data.weatherTempUnit).toBe('celsius');
    expect(data.tombstonePrunedBefore).toEqual(expect.any(String));

    // The apply landed in storage (the save pass wrote state back)…
    const stored = JSON.parse(ls.getItem('day-planner-tasks'));
    expect(stored.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    // …and the snapshot was built from the settled state, with the pulled task.
    expect(calls.updateLauncherSnapshot).toHaveLength(1);
    const snapshot = calls.updateLauncherSnapshot[0];
    expect(snapshot.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(['Local task', 'From the other device']));
    // The heartbeat carries the tier's completed cycle, and the outcome is logged.
    const heartbeat = calls.touchLauncherHeartbeat.at(-1);
    expect(heartbeat.syncedAt).toBe('2026-10-19T10:00:00.000Z');
    expect(heartbeat.checkedAt).toEqual(expect.any(Number));
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ clientId: 'rf-1', outcome: 'ran', durationMs: expect.any(Number) });
    expect(calls.headlessDone[0]).toMatchObject({ clientId: 'rf-1', outcome: 'ran' });

    // The allowlist: nothing the root booted reached for another native method.
    const outside = [...lookups].filter((name) => !HEADLESS_BRIDGE_METHODS.includes(name));
    expect(outside).toEqual([]);
    // The deps guard saw a complete wiring.
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('useSyncEngineData'))).toEqual([]);
    root.unmount();
  });

  it('runs the vault tier too, and the heartbeat takes the latest completed cycle', async () => {
    seedStorage(ls, { vault: true });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const file = scriptedFileEngine({ lastSynced: '2026-10-19T10:00:00.000Z' });
    const vaultApplies = [];
    const createVaultEngine = vi.fn((callbacks) => ({
      dbSyncCycle: async () => {
        const data = callbacks.getData();
        expect(data.tasks.map((t) => t.id)).toContain('t1');
        vaultApplies.push(data);
        callbacks.commitData({ ...data, tasks: [...data.tasks, T('t3', 'From the vault', { lastModified: '2026-10-19T09:45:00.000Z' })] });
      },
      getLastSynced: () => '2026-10-19T10:05:00.000Z',
      dispose: vi.fn(),
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: file.factory, createVaultEngine });
    await until(() => calls.headlessDone.length > 0);
    expect(createVaultEngine).toHaveBeenCalledTimes(1);
    expect(vaultApplies).toHaveLength(1);
    const stored = JSON.parse(ls.getItem('day-planner-tasks')).map((t) => t.id).sort();
    expect(stored).toEqual(['t1', 't2', 't3']);
    expect(calls.touchLauncherHeartbeat.at(-1).syncedAt).toBe('2026-10-19T10:05:00.000Z');
    expect(calls.headlessDone[0].outcome).toBe('ran');
    root.unmount();
  });

  it('aborts before running when the app has opened, and pushes nothing', async () => {
    seedStorage(ls);
    const { bridge, calls } = fakeBridge({ abort: true });
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(engine.seen.payloads).toHaveLength(0);
    expect(calls.updateLauncherSnapshot).toHaveLength(0);
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ clientId: 'rf-1', outcome: 'aborted', reason: 'app opened' });
    root.unmount();
  });

  it('an engine clearing its previous error is not a failure; a reported error is', async () => {
    seedStorage(ls, { vault: true });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const file = scriptedFileEngine();
    // The vault engine clears, as both engines do at the start of a cycle, then succeeds.
    const clearing = vi.fn((callbacks) => ({
      dbSyncCycle: async () => { callbacks.onError(null, null); callbacks.onStatusChange('success'); },
      getLastSynced: () => '2026-10-19T10:05:00.000Z',
      dispose: vi.fn(),
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: file.factory, createVaultEngine: clearing });
    await until(() => calls.headlessDone.length > 0);
    expect(calls.headlessDone[0].outcome).toBe('ran');
    root.unmount();

    // A real report, without a throw, is the failure's reason.
    const second = fakeBridge();
    globalThis.window.DayGlanceNative = second.bridge;
    const reporting = vi.fn((callbacks) => ({
      dbSyncCycle: async () => { callbacks.onError(null, null); callbacks.onError('vault unreachable', 'NETWORK'); },
      getLastSynced: () => null,
      dispose: vi.fn(),
    }));
    const root2 = await mount({ bridge: () => second.bridge, createFileEngine: scriptedFileEngine().factory, createVaultEngine: reporting });
    await until(() => second.calls.headlessDone.length > 0);
    expect(second.calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'vault: NETWORK vault unreachable' });
    expect(second.calls.updateLauncherSnapshot).toHaveLength(0);
    root2.unmount();
  });

  it('reports a throwing cycle as failed with its reason, still stamps the heartbeat, pushes no snapshot', async () => {
    seedStorage(ls);
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine({ fail: new Error('server unreachable') });
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'server unreachable' });
    expect(calls.touchLauncherHeartbeat.length).toBeGreaterThan(0);
    expect(calls.updateLauncherSnapshot).toHaveLength(0);
    // Storage untouched by a failed cycle.
    expect(JSON.parse(ls.getItem('day-planner-tasks')).map((t) => t.id)).toEqual(['t1']);
    root.unmount();
  });

  it('fails honestly when the file tier is encrypted and no key is cached', async () => {
    seedStorage(ls, { encrypted: true });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(engine.seen.payloads).toHaveLength(0);
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'passphrase required' });
    root.unmount();
  });

  it('fails when no sync tier is configured', async () => {
    seedStorage(ls, { cloud: false });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(engine.factory).not.toHaveBeenCalled();
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'no sync tier is configured' });
    root.unmount();
  });

  // #2141: daily notes live in IndexedDB. The root loads them the way App
  // does (loadData, which moves them out of localStorage on the first run),
  // publishes them only once loaded, and an applied note lands in the database.
  it('moves the notes to IndexedDB, publishes them once loaded, and applies a pulled note there', async () => {
    globalThis.indexedDB = new IDBFactory();
    const dbName = `headless-notes-${Math.random()}`;
    notesStore.resetDailyNotesStore({ backend: notesStore.createIdbNotesBackend(openDatabase, dbName), storage: ls });
    try {
      seedStorage(ls);
      const mine = { '2026-10-18': { text: 'written here', lastModified: '2026-10-18T20:00:00.000Z' } };
      const theirs = { '2026-10-19': { text: 'from the phone', lastModified: '2026-10-19T07:00:00.000Z' } };
      ls.setItem(notesStore.LEGACY_NOTES_KEY, JSON.stringify(mine));
      const { bridge, calls } = fakeBridge();
      globalThis.window.DayGlanceNative = bridge;
      const engine = scriptedFileEngine({ remoteNotes: theirs });
      const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
      await until(() => calls.headlessDone.length > 0);
      await notesStore.flushDailyNotes();

      // The payload carried the moved notes, not an empty map.
      expect(engine.seen.payloads[0].data.dailyNotes).toEqual(mine);
      // They left localStorage, and the database holds both, the pulled one included.
      expect(ls.getItem(notesStore.LEGACY_NOTES_KEY)).toBeNull();
      const rows = await notesStore.createIdbNotesBackend(openDatabase, dbName).readAll();
      expect(rows.value).toEqual({ ...mine, ...theirs });
      root.unmount();
    } finally {
      notesStore.resetDailyNotesStore();
      delete globalThis.indexedDB;
    }
  });

  it('the store supplies every dep the sync payload and apply read', () => {
    // A key the store does not carry is a slice the headless payload would
    // send as undefined with a fresh lastModified; the hook names it.
    expect(missingSyncEngineDeps({})).not.toEqual([]);
  });
});
