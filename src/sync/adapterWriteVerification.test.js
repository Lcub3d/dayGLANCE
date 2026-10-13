import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The file tier's unbacked writers — App.jsx's debounced upload on data changes
// and the header/desktop sync button — called the engine with no payload and no
// ETag. The provider then PUT the whole local snapshot with no If-Match, so a
// device that had never read the remote (a wrong server address, a proxy pointed
// at the wrong host) replaced whatever the other devices had written. Both now
// run the full cycle (`utils/syncNowAction.js`); this suite holds the gate that
// catches any remaining bare `engine.upload()`, and the two 412 paths the guard
// must not re-wedge: an ETag-mangling server's last-resort unconditional PUT, and
// an edit that follows a cycle which wrote.
//
// This walks dayGLANCE's own engine factory, so the gate is asserted where the
// app actually builds it: an upload nothing read for is refused, and one the
// engine did not validate still carries the ETag of the last verified read.

const store = new Map();
const originalLocalStorage = globalThis.localStorage;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
afterAll(() => { globalThis.localStorage = originalLocalStorage; });

const { createDayGlanceEngine } = await import('./adapter.js');
const { VERIFIED_REMOTE_KEY } = await import('./verifiedRemote.js');
const { runSyncAfterEdit } = await import('../utils/syncNowAction.js');

const CONFIG_KEY = 'day-planner-cloud-sync-config';
const LAST_SYNCED_KEY = 'day-planner-cloud-sync-last-synced';
const SYNCED_BEFORE = '2026-10-10T00:00:00.000Z';
const LOCAL_TASKS = [{ id: 't1', title: 'mine', lastModified: '2026-10-09T00:00:00.000Z' }];

const serverA = () => ({
  enabled: true, provider: 'webdav', webdavUrl: 'https://dav-a.example.com',
  username: 'me', appPassword: 'p', syncFolder: 'GLANCE/dayglance',
});
const serverB = () => ({ ...serverA(), webdavUrl: 'https://dav-b.example.com' });

function build({ download = null, upload = null, localTasks = LOCAL_TASKS } = {}) {
  const calls = { status: [], lastSynced: [], errors: [] };
  let nextDownload = download;
  let local = localTasks;
  // The guards replace the provider methods with wrappers, so call assertions
  // read the spies the wrappers call through.
  const downloadSpy = vi.fn(async () => (typeof nextDownload === 'function' ? nextDownload() : nextDownload));
  const uploadSpy = vi.fn(async (cfg, envelope, etag) => upload?.(cfg, envelope, etag));
  const provider = {
    name: 'fake', configFields: [],
    download: downloadSpy,
    upload: uploadSpy,
    test: vi.fn(),
  };
  const engine = createDayGlanceEngine({
    buildPayload: async () => ({
      data: { tasks: local, unscheduledTasks: [] },
      lastModified: '2026-10-09T00:00:00.000Z',
    }),
    buildBackupPayload: async () => ({}),
    applyPayload: async () => {},
    onStatusChange: (s) => calls.status.push(s),
    onError: (msg, code) => { if (msg) calls.errors.push(code); },
    onLastSyncedChange: (iso) => calls.lastSynced.push(iso),
    onConflict: () => {},
    onPassphraseRequired: () => {},
    onFirstSyncReload: () => {},
    getSyncRetentionDays: () => 90,
  }, { appFolderName: 'GLANCE/dayglance', providers: { webdav: provider } });

  // The guards are installed on the map the engine reads.
  expect(provider.download.absentRemoteSeedGuarded).toBe(true);
  expect(provider.upload.verifiedWriteGuarded).toBe(true);

  localStorage.setItem(CONFIG_KEY, JSON.stringify(serverA()));
  localStorage.setItem('day-planner-tasks', JSON.stringify(LOCAL_TASKS));
  return {
    engine, provider, uploadSpy, calls,
    setDownload: (value) => { nextDownload = value; },
    setLocalTasks: (tasks) => { local = tasks; },
  };
}

const remoteFile = (etag, { taskId = 'remote-1' } = {}) => ({
  payload: { data: { tasks: [{ id: taskId, title: 'theirs', lastModified: '2026-10-11T00:00:00.000Z' }], unscheduledTasks: [] } },
  etag,
});

async function settle(promise) {
  await vi.advanceTimersByTimeAsync(3000);
  await promise;
}

// The 412 chain (jitter → retry → unconditional fallback) needs more fake time
// than one cycle; the promise itself says when it is done.
async function settleWithRetries(promise, ms = 20000) {
  const done = promise.then(() => {}, () => {});
  await vi.advanceTimersByTimeAsync(ms);
  await done;
}

/**
 * A scripted WebDAV-ish server with ONE current ETag: `download` serves it,
 * `upload` refuses (the engine's PRECONDITION_FAILED) unless the If-Match it was
 * given matches, and every accepted PUT mints the next ETag. That is what makes
 * an ETag read before a write stale after it.
 *
 * `mangled: true` is the server whose GET ETag can never round-trip through
 * If-Match (Apache `mod_deflate`): every conditional PUT is refused, and only an
 * unconditional PUT can land — the case the engine's last-resort fallback after
 * two 412s exists for.
 */
function scriptedServer({ etag = '"s1"', payload = remoteFile('"s1"').payload, mangled = false } = {}) {
  const state = { etag, payload, accepted: 0, writes: [], reads: 0 };
  return {
    state,
    download: () => {
      state.reads += 1;
      return { payload: state.payload, etag: mangled ? `"read-${state.reads}"` : state.etag };
    },
    upload: (_cfg, envelope, etag) => {
      state.writes.push(etag);
      if (etag && (mangled || etag !== state.etag)) throw new Error('PRECONDITION_FAILED');
      state.accepted += 1;
      state.payload = { data: envelope.data, lastModified: envelope.lastModified };
      state.etag = `"s${state.accepted + 1}"`;
    },
  };
}

// App.jsx's status reducer (line ~950): a queued 'idle' must not overwrite an
// in-flight status, which is how a refused upload would leave the UI on
// "syncing…" forever.
const uiStatus = (statuses) => statuses.reduce(
  (prev, s) => (s === 'idle' && (prev === 'uploading' || prev === 'downloading') ? prev : s),
  'idle',
);

describe('a write with no read behind it', () => {
  beforeEach(() => { store.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('is refused, reported, and leaves the UI settled', async () => {
    const { engine, uploadSpy, calls } = build();

    await settle(engine.upload());   // a bare upload: no read of its own

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.errors).toContain('WRITE_UNVERIFIED');
    expect(calls.status).not.toContain('success');
    expect(uiStatus(calls.status)).toBe('idle');
    expect(calls.lastSynced).toEqual([]);
  });

  it('is allowed after a read of the same target, with the ETag of that read', async () => {
    localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
    const { engine, uploadSpy, setDownload } = build();
    setDownload(remoteFile('"e1"'));

    await settle(engine.download());                    // reads, merges, writes
    const cycleUploads = uploadSpy.mock.calls.length;
    expect(cycleUploads).toBeGreaterThan(0);
    expect(uploadSpy.mock.calls[0][2]).toBe('"e1"');

    await settle(engine.upload());                      // no read of its own
    expect(uploadSpy.mock.calls.length).toBe(cycleUploads + 1);
    // The server can now refuse a write built on stale knowledge.
    expect(uploadSpy.mock.calls[cycleUploads][2]).toBe('"e1"');
  });

  it('is refused after the sync target changes, until the new target is read', async () => {
    localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
    const { engine, uploadSpy, calls, setDownload } = build();
    setDownload(remoteFile('"a1"'));
    await settle(engine.download());
    const afterCycle = uploadSpy.mock.calls.length;
    expect(afterCycle).toBeGreaterThan(0);

    // The user fixes a wrong address: same device, different server.
    localStorage.setItem(CONFIG_KEY, JSON.stringify(serverB()));
    await settle(engine.upload());
    expect(uploadSpy.mock.calls.length).toBe(afterCycle);   // nothing written
    expect(calls.errors).toContain('WRITE_UNVERIFIED');

    // Reading the new target is what re-opens writing, against its ETag.
    setDownload(remoteFile('"b1"', { taskId: 'remote-b' }));
    await settle(engine.download());
    const afterBTarget = uploadSpy.mock.calls.length;
    expect(uploadSpy.mock.calls[afterBTarget - 1][2]).toBe('"b1"');
    await settle(engine.upload());
    expect(uploadSpy.mock.calls[afterBTarget][2]).toBe('"b1"');
  });

  it('records the verified read per target, so a later device does not inherit it', async () => {
    localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
    const { engine, setDownload } = build();
    setDownload(remoteFile('"a1"'));
    await settle(engine.download());

    const recorded = JSON.parse(localStorage.getItem(VERIFIED_REMOTE_KEY));
    expect(recorded.etag).toBe('"a1"');
    expect(recorded.targetKey).toContain('dav-a.example.com');

    localStorage.setItem(CONFIG_KEY, JSON.stringify(serverB()));
    setDownload(remoteFile('"b1"'));
    await settle(engine.download());
    const afterB = JSON.parse(localStorage.getItem(VERIFIED_REMOTE_KEY));
    expect(afterB.etag).toBe('"b1"');
    expect(afterB.targetKey).toContain('dav-b.example.com');
  });
});

describe('the seed branch', () => {
  beforeEach(() => { store.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('still seeds a first run, with no validator (the file is believed absent)', async () => {
    const { engine, uploadSpy, calls } = build();

    await settle(engine.download());

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy.mock.calls[0][2]).toBeNull();
    expect(calls.errors).not.toContain('WRITE_UNVERIFIED');
  });

  it('still holds an eviction on a device that has synced before', async () => {
    localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
    const { engine, uploadSpy, calls } = build();

    await settle(engine.download());

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.errors).toContain('ABSENT_REMOTE_HOLD');
  });
});

describe('the cycle the gate must not wedge', () => {
  beforeEach(() => { store.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('leaves the last-resort PUT after two 412s unconditional, so an ETag-mangling server still syncs', async () => {
    localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
    const server = scriptedServer({ mangled: true });
    const { engine, uploadSpy, calls } = build({
      download: () => server.download(),
      upload: (cfg, envelope, etag) => server.upload(cfg, envelope, etag),
    });

    await settleWithRetries(engine.download());

    // Cycle 1 and its retry are conditional on the ETag they just read; both are
    // refused. The third is the engine's `skipIfMatch` fallback, and its whole
    // point is a PUT with NO If-Match — the gate must not inject the ETag it
    // watched the server reject twice.
    expect(uploadSpy).toHaveBeenCalledTimes(3);
    expect(server.state.writes).toEqual(['"read-1"', '"read-2"', null]);
    expect(server.state.accepted).toBe(1);   // the unconditional PUT landed
    expect(calls.errors).not.toContain('WRITE_UNVERIFIED');
  });

  it('sends an edit made after a cycle that wrote, through the cycle the debounce runs', async () => {
    localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
    const server = scriptedServer();
    const { engine, uploadSpy, calls, setLocalTasks } = build({
      download: () => server.download(),
      upload: (cfg, envelope, etag) => server.upload(cfg, envelope, etag),
    });

    // A cycle that WRITES: the server mints a new ETag, while the validator this
    // device remembers is still the one it read.
    await settle(engine.download());
    expect(server.state.accepted).toBe(1);
    expect(uploadSpy.mock.calls[0][2]).toBe('"s1"');
    expect(server.state.etag).toBe('"s2"');

    // The user's next edit, sent the way App.jsx sends it.
    const edited = [...LOCAL_TASKS, { id: 't2', title: 'edit-after-write', lastModified: '2026-10-12T00:00:00.000Z' }];
    setLocalTasks(edited);
    let cycle;
    runSyncAfterEdit({ cloudSyncDownload: () => { cycle = engine.download(); } });
    await settle(cycle);

    const puts = uploadSpy.mock.calls.slice(1);
    expect(puts.length).toBeGreaterThan(0);
    // Fresh validator: the ETag the cycle just read, not the stale one.
    expect(puts[puts.length - 1][2]).toBe('"s2"');
    expect(server.state.accepted).toBe(2);
    expect(server.state.payload.data.tasks.map((t) => t.id)).toContain('t2');
    expect(calls.errors).not.toContain('WRITE_UNVERIFIED');

    // The bare upload the debounce used to make carries the ETag of the read
    // before the write: refused, and swallowed — the edit waits for the poll.
    setLocalTasks([...edited, { id: 't3', title: 'would-have-waited', lastModified: '2026-10-12T01:00:00.000Z' }]);
    await settle(engine.upload());
    const lastUpload = uploadSpy.mock.calls[uploadSpy.mock.calls.length - 1];
    expect(lastUpload[2]).toBe('"s2"');
    expect(server.state.accepted).toBe(2);
    expect(calls.errors).not.toContain('PRECONDITION_FAILED');
  });
});
