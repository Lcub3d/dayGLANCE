import { describe, it, expect, vi } from 'vitest';
import { runSnapshotFileCycle, classifySnapshotText, LOCAL_MODIFIED_KEY } from './snapshotFileSync.js';
import { MISSING_GRACE_MS } from '../utils/icloudSeedGuard.js';

// Every guard the App.jsx iCloud loop carried, asserted at the one place a
// second transport will now share it. Each test names the guard it protects;
// removing that guard from runSnapshotFileCycle makes the test fail.

const T0 = 1_700_000_000_000;

const makeStorage = (initial = {}) => {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => ({ ...m }),
  };
};

const task = (id, extra = {}) => ({ id, title: id, date: '2026-10-01', lastModified: '2026-10-01T00:00:00.000Z', ...extra });
const data = (tasks = [], unscheduledTasks = []) => ({ tasks, unscheduledTasks });
const envelope = (d, lastModified = '2026-10-02T00:00:00.000Z') => JSON.stringify({ version: 2, lastModified, data: d });

const makeTransport = (over = {}) => ({
  id: 'fake',
  read: vi.fn(async () => null),
  write: vi.fn(async () => true),
  lastSyncedKey: 'fake-last-synced',
  firstRunDecided: () => true,
  writeThrottleMs: 5000,
  allowsPlaintextReseed: true,
  ...over,
});

const makeIo = (over = {}) => ({
  buildSyncPayload: () => ({ version: 2, data: data() }),
  applyEngineData: vi.fn(),
  // Default merge: take the remote copy whole and report it as a local change.
  mergeSyncData: vi.fn((local, remote) => ({ data: remote, localChanged: true, remoteChanged: false })),
  stripHealthSourcedLogs: vi.fn((payload) => payload),
  habits: [],
  syncRetentionDays: 90,
  isEncryptedEnvelope: (e) => !!e?.__encrypted,
  decryptData: vi.fn(async () => { throw new Error('no key'); }),
  storage: makeStorage(),
  now: () => T0,
  log: { warn: vi.fn(), error: vi.fn() },
  ...over,
});

const fresh = { missingSince: 0, lastWriteAt: 0 };
const written = (transport, n = 0) => JSON.parse(transport.write.mock.calls[n][0]);

describe('classifySnapshotText', () => {
  it('distinguishes absent, placeholder, error, garbage and a snapshot', () => {
    expect(classifySnapshotText(null)).toEqual({ kind: 'absent' });
    expect(classifySnapshotText('')).toEqual({ kind: 'absent' });
    expect(classifySnapshotText('null')).toEqual({ kind: 'absent' });
    expect(classifySnapshotText('{"downloading":true}')).toEqual({ kind: 'downloading' });
    expect(classifySnapshotText('{"error":"iCloud not available"}')).toEqual({ kind: 'error', error: 'iCloud not available' });
    expect(classifySnapshotText('{"version":2,"da')).toEqual({ kind: 'unparseable' });
    expect(classifySnapshotText(envelope(data())).kind).toBe('snapshot');
  });
});

describe('absent snapshot', () => {
  it('seeds the file from local data on a device that has never synced', async () => {
    const transport = makeTransport();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('a')]) }) });
    const { state, outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'seeded', wrote: true });
    expect(written(transport).data.tasks).toHaveLength(1);
    expect(state.missingSince).toBe(0);
  });

  it('guard: an absence on a device that HAS synced is treated as eviction until the grace window passes', async () => {
    const transport = makeTransport();
    const io = makeIo({ storage: makeStorage({ 'fake-last-synced': '2026-10-01T00:00:00.000Z' }) });

    const first = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(first.outcome).toEqual({ kind: 'skipped', reason: 'missing-grace' });
    expect(first.state.missingSince).toBe(T0);
    expect(transport.write).not.toHaveBeenCalled();

    // Still inside the window: keeps waiting, preserving the original sighting.
    io.now = () => T0 + MISSING_GRACE_MS - 1;
    const second = await runSnapshotFileCycle({ transport, io, state: first.state });
    expect(second.outcome.reason).toBe('missing-grace');
    expect(second.state.missingSince).toBe(T0);

    // Past it: really gone, so seed again and clear the streak.
    io.now = () => T0 + MISSING_GRACE_MS;
    const third = await runSnapshotFileCycle({ transport, io, state: second.state });
    expect(third.outcome.kind).toBe('seeded');
    expect(third.state.missingSince).toBe(0);
  });

  it('guard: never seeds an empty payload over a localStorage that holds tasks (state not hydrated)', async () => {
    const transport = makeTransport();
    const io = makeIo({
      storage: makeStorage({ 'day-planner-tasks': JSON.stringify([task('stored')]) }),
      buildSyncPayload: () => ({ version: 2, data: data() }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'empty-state-guard' });
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('counts inbox items in that guard too', async () => {
    const transport = makeTransport();
    const io = makeIo({
      storage: makeStorage({ 'day-planner-unscheduled': JSON.stringify([{ id: 'u' }]) }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.reason).toBe('empty-state-guard');
  });
});

describe('placeholder, garbage and error reads', () => {
  it('skips a downloading placeholder without writing or stamping', async () => {
    const transport = makeTransport({ read: async () => '{"downloading":true}' });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'downloading' });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.storage.getItem('fake-last-synced')).toBeNull();
  });

  it('skips a half-written file (daemon mid-write) rather than seeding over it', async () => {
    const transport = makeTransport({ read: async () => '{"version":2,"data":{"tas' });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'unparseable' });
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('surfaces an error object and touches nothing', async () => {
    const transport = makeTransport({ read: async () => '{"error":"iCloud not available"}' });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'error', reason: 'unavailable', error: 'iCloud not available' });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(io.storage.getItem('fake-last-synced')).toBeNull();
  });

  it('skips an envelope with no data', async () => {
    const transport = makeTransport({ read: async () => JSON.stringify({ version: 2 }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io: makeIo(), state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no-data' });
  });
});

describe('a real snapshot', () => {
  it('stamps the transport\'s own last-synced key and clears the eviction clock', async () => {
    const transport = makeTransport({ read: async () => envelope(data([task('r')])) });
    const io = makeIo();
    const { state } = await runSnapshotFileCycle({ transport, io, state: { missingSince: T0 - 1000, lastWriteAt: 0 } });
    expect(io.storage.getItem('fake-last-synced')).toBe(new Date(T0).toISOString());
    expect(state.missingSince).toBe(0);
  });

  it('applies the merged data locally when the merge changed local, and stamps local-modified', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    // The merged copy IS the file's copy, so there is nothing to write back.
    expect(outcome).toMatchObject({ kind: 'merged', localChanged: true, remoteChanged: false, applied: true, wrote: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.mergeSyncData).toHaveBeenCalledWith(data(), remote, 90);
    expect(io.applyEngineData).toHaveBeenCalledWith(remote, { allowEmpty: true });
    expect(io.storage.getItem(LOCAL_MODIFIED_KEY)).toBe(new Date(T0).toISOString());
  });

  it('allowEmpty follows the presence of a remote lastModified', async () => {
    const transport = makeTransport({ read: async () => JSON.stringify({ version: 2, data: data([task('r')]) }) });
    const io = makeIo();
    await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(io.applyEngineData).toHaveBeenCalledWith(expect.anything(), { allowEmpty: false });
  });

  it('writes a fresh version-2 envelope when either side changed, and nothing when neither did', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });

    const quiet = makeIo({ mergeSyncData: () => ({ data: remote, localChanged: false, remoteChanged: false }) });
    const a = await runSnapshotFileCycle({ transport, io: quiet, state: fresh });
    expect(a.outcome).toMatchObject({ kind: 'merged', wrote: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(quiet.applyEngineData).not.toHaveBeenCalled();

    const merged = data([task('r'), task('l')]);
    const remoteOnly = makeIo({ mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }) });
    const b = await runSnapshotFileCycle({ transport, io: remoteOnly, state: fresh });
    expect(b.outcome).toMatchObject({ wrote: true });
    expect(remoteOnly.applyEngineData).not.toHaveBeenCalled();
    expect(written(transport)).toEqual({ version: 2, lastModified: new Date(T0).toISOString(), data: merged });
  });

  it('guard: HealthKit-derived counts are stripped from every outgoing copy, never from the local apply', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });
    const habits = [{ id: 'h', source: 'health' }];
    const merged = data([task('r'), task('l')]);
    const io = makeIo({
      habits,
      mergeSyncData: () => ({ data: merged, localChanged: true, remoteChanged: true }),
      stripHealthSourcedLogs: vi.fn((p) => ({ ...p, stripped: true })),
    });
    await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(io.stripHealthSourcedLogs).toHaveBeenCalledWith(expect.objectContaining({ data: merged }), habits);
    expect(written(transport).stripped).toBe(true);
    expect(io.applyEngineData.mock.calls[0][0].stripped).toBeUndefined();

    // Seeding strips as well (a never-synced device, so a fresh storage).
    const seeding = makeTransport();
    const seedIo = makeIo({
      habits,
      buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }),
      stripHealthSourcedLogs: (p) => ({ ...p, stripped: true }),
    });
    await runSnapshotFileCycle({ transport: seeding, io: seedIo, state: fresh });
    expect(written(seeding).stripped).toBe(true);
  });
});

describe('first-run restore prompt', () => {
  const populated = () => makeTransport({
    read: async () => envelope(data([task('r1'), task('r2')], [task('i1')]), '2026-10-03T00:00:00.000Z'),
    firstRunDecided: () => false,
  });

  it('guard: a fresh device facing a populated snapshot is asked, not restored', async () => {
    const transport = populated();
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({
      kind: 'prompted',
      info: { taskCount: 2, inboxCount: 1, lastModified: '2026-10-03T00:00:00.000Z' },
    });
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(transport.write).not.toHaveBeenCalled();
    // The stamp lands before the prompt: reading the snapshot proved the transport.
    expect(io.storage.getItem('fake-last-synced')).toBe(new Date(T0).toISOString());
  });

  it('does not ask once a decision is recorded', async () => {
    const transport = populated();
    transport.firstRunDecided = () => true;
    const { outcome } = await runSnapshotFileCycle({ transport, io: makeIo(), state: fresh });
    expect(outcome.kind).toBe('merged');
  });

  it('does not ask a device that has data of its own (ordinary merge)', async () => {
    const transport = populated();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.kind).toBe('merged');
  });

  it('does not ask when the snapshot carries no tasks (nothing to restore)', async () => {
    const transport = makeTransport({ read: async () => envelope(data()), firstRunDecided: () => false });
    const { outcome } = await runSnapshotFileCycle({ transport, io: makeIo(), state: fresh });
    expect(outcome.kind).toBe('merged');
  });
});

describe('encrypted envelopes', () => {
  const sealed = () => makeTransport({
    read: async () => JSON.stringify({ __encrypted: true, blob: 'x' }),
  });

  it('decrypts with the cached key and merges the plaintext', async () => {
    const transport = sealed();
    const inner = { version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: data([task('r')]) };
    const io = makeIo({ decryptData: vi.fn(async () => inner) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.kind).toBe('merged');
    expect(io.mergeSyncData).toHaveBeenCalledWith(data(), inner.data, 90);
  });

  it('iCloud: an undecryptable legacy envelope is replaced by local plaintext', async () => {
    const transport = sealed();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'reseeded', wrote: true });
    expect(written(transport).data.tasks[0].id).toBe('mine');
    expect(io.log.warn).toHaveBeenCalled();
  });

  it('guard: a transport that forbids plaintext reseed never writes over a file it cannot read', async () => {
    const transport = sealed();
    transport.allowsPlaintextReseed = false;
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'encrypted-unreadable' });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
  });
});

describe('write throttle', () => {
  it('guard: skips writes inside the transport\'s window and resumes after it', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });
    const merged = data([task('r'), task('l')]);
    const io = makeIo({ mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }) });

    const a = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(a.outcome.wrote).toBe(true);
    expect(a.state.lastWriteAt).toBe(T0);

    io.now = () => T0 + 4999;
    const b = await runSnapshotFileCycle({ transport, io, state: a.state });
    expect(b.outcome).toMatchObject({ kind: 'merged', wrote: false });
    expect(b.state.lastWriteAt).toBe(T0);
    expect(transport.write).toHaveBeenCalledTimes(1);

    io.now = () => T0 + 5000;
    const c = await runSnapshotFileCycle({ transport, io, state: b.state });
    expect(c.outcome.wrote).toBe(true);
    expect(transport.write).toHaveBeenCalledTimes(2);
  });

  it('a failed write is logged and still counts against the window', async () => {
    const transport = makeTransport({ write: vi.fn(async () => false) });
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('a')]) }) });
    const { state, outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'seeded', wrote: false });
    expect(state.lastWriteAt).toBe(T0);
    expect(io.log.error).toHaveBeenCalled();
  });
});

describe('guard: the merge flags are necessary, not sufficient', () => {
  const remote = data([task('r')]);
  const flagsOnly = () => makeIo({
    // The merge says both sides changed, and hands back exactly the file's data.
    mergeSyncData: () => ({ data: remote, localChanged: true, remoteChanged: true }),
    buildSyncPayload: () => ({ version: 2, data: remote }),
  });

  it('a write flag with nothing differing from the file writes nothing', async () => {
    const transport = makeTransport({ read: async () => envelope(remote) });
    const io = flagsOnly();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', remoteChanged: true, wrote: false, applied: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
  });

  it('the 2026-10-05 case: health counts the file never carries do not cause a rewrite', async () => {
    // A Mac holds HealthKit-derived counts (arrived through GLANCEvault); the
    // iCloud file is kept free of them by the strip. The merge keeps the counts
    // in its result and flags a write; the stripped copy equals the file.
    const habits = [{ id: 'steps', source: 'healthKit' }];
    const fileData = { tasks: [task('r')], unscheduledTasks: [], habits, habitLogs: { '2026-10-01': { water: 3 } } };
    const localData = { ...fileData, habitLogs: { '2026-10-01': { water: 3, steps: 8000 } } };
    const strip = (payload) => ({
      ...payload,
      data: { ...payload.data, habitLogs: Object.fromEntries(Object.entries(payload.data.habitLogs).map(([d, e]) => [d, Object.fromEntries(Object.entries(e).filter(([h]) => h !== 'steps'))])) },
    });
    const transport = makeTransport({ read: async () => envelope(fileData) });
    const io = makeIo({
      habits,
      buildSyncPayload: () => ({ version: 2, data: localData }),
      mergeSyncData: () => ({ data: localData, localChanged: false, remoteChanged: true }),
      stripHealthSourcedLogs: strip,
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', remoteChanged: true, wrote: false });
    expect(transport.write).not.toHaveBeenCalled();

    // A real local change alongside the health counts still writes, stripped.
    const edited = { ...localData, tasks: [task('r', { title: 'renamed' })] };
    const io2 = makeIo({
      habits,
      buildSyncPayload: () => ({ version: 2, data: edited }),
      mergeSyncData: () => ({ data: edited, localChanged: false, remoteChanged: true }),
      stripHealthSourcedLogs: strip,
    });
    const t2 = makeTransport({ read: async () => envelope(fileData) });
    const r2 = await runSnapshotFileCycle({ transport: t2, io: io2, state: fresh });
    expect(r2.outcome.wrote).toBe(true);
    expect(written(t2).data.habitLogs['2026-10-01']).toEqual({ water: 3 });
    expect(written(t2).data.tasks[0].title).toBe('renamed');
  });

  it('guard: an order-only difference from the file writes nothing', async () => {
    const fileData = data([task('a'), task('b')]);
    const localData = data([task('b'), task('a')]);
    const transport = makeTransport({ read: async () => envelope(fileData) });
    const io = makeIo({
      buildSyncPayload: () => ({ version: 2, data: localData }),
      mergeSyncData: () => ({ data: localData, localChanged: false, remoteChanged: true }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.wrote).toBe(false);
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('an apply flag with nothing differing from local state applies nothing', async () => {
    const transport = makeTransport({ read: async () => envelope(remote) });
    const io = makeIo({
      buildSyncPayload: () => ({ version: 2, data: remote }),
      mergeSyncData: () => ({ data: remote, localChanged: true, remoteChanged: false }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.applied).toBe(false);
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(io.storage.getItem(LOCAL_MODIFIED_KEY)).toBeNull();
  });
});
