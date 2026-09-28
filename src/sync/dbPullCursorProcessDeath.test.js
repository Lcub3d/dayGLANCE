import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS DEATH MID-CYCLE — the half dbPullPagination.test.js cannot reach.
//
// That suite pins the THROWN mid-pagination failure: the catch in dbSyncCycle
// rewinds the pull cursor, because our applyRemoteEntity writes into a per-cycle
// mirror the catch discards. This suite pins the case where no catch runs at all.
//
// @glance-apps/sync persists the pull cursor PER PAGE. When the process is killed
// mid-cycle — Android does this on backgrounding and under memory pressure,
// mid-network-callback, where desktop and Electron do not — the cursor stays
// advanced past pages whose rows only ever reached the discarded mirror. Those
// rows then sit BELOW the cursor forever: never re-listed by an incremental pull,
// and invisible to the glitch heal, which only re-fetches rows that were in the
// snapshot and vanished locally. These were never in either.
//
// The symptom in the field is a device permanently missing a handful of rows
// while every LATER change syncs normally, because the cursor keeps advancing and
// only the stranded window is unreachable. Diagnosed from exactly that: GTD frame
// edits that reached five other devices and neither Android one, on a fleet where
// everything else synced.
//
// A killed process cannot be simulated in-process — that is the whole point of
// it — so `strandCursor` below constructs the state a kill leaves behind: cursor
// advanced, mirror never committed, and (with the fix) the pre-cycle mark still
// in storage because neither exit ran. The control test proves the strand is
// permanent without the mark.
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function createPagedVault({ pageSize = 2 } = {}) {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  let failListCall = 0;
  let listCalls = 0;
  return {
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      listCalls += 1;
      if (failListCall && listCalls === failListCall) throw new Error('list failed: network blip');
      const all = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows: all.slice(0, pageSize), hasMore: all.length > pageSize };
    },
    async device() { return { updated: true }; },
    armFailure(n) { failListCall = n; listCalls = 0; },
    disarm() { failListCall = 0; listCalls = 0; },
  };
}

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// A GTD frame, because frames are what exposed this: a small, rarely-edited row
// whose disappearance is noticed, where a stranded task row gets overwritten by
// the next edit and hides the bug.
const frame = (id, lastModified, days) => ({
  id, label: `frame ${id}`, start: '18:00', end: '20:00', days,
  enabled: true, bufferMinutes: 5, lastModified,
});

const PREFIX = 'dev-a';
const HWM_KEY = `${PREFIX}-db-sync-hwm`;
const MARK_KEY = `${PREFIX}-db-sync-pull-mark`;

// A relaunch: a NEW engine over the SAME storage, which is when
// recoverStrandedPullCursor runs.
function launch(vault, data) {
  let live = clone(data);
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: PREFIX,
    deviceId: 'device-a',
    nativeGetSyncKey: () => null,
    nativeStoreSyncKey: () => {},
    getData: () => clone(live),
    commitData: (d) => { live = d; },
    cycleBreaker: { beforeCycle: () => ({ allowed: true }), onSuccess() {}, onFailure() { return 0; } },
  });
  return { engine, get data() { return live; } };
}

const frameIds = (device) => device.data.gtdFrames.map((f) => f.id).sort();
const hwm = () => Number(global.localStorage.getItem(HWM_KEY) ?? 0);

// The state a killed process leaves: the cursor advanced past pages whose rows
// were applied only to the mirror, and local data without them.
function strandCursor({ toSeq, markAt }) {
  global.localStorage.setItem(HWM_KEY, String(toSeq));
  if (markAt == null) global.localStorage.removeItem(MARK_KEY);
  else global.localStorage.setItem(MARK_KEY, String(markAt));
}

describe('pull cursor stranded by process death mid-cycle', () => {
  let vault;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'acct' });
    setSyncPassphrase('process-death-test-passphrase');
    vault = createPagedVault({ pageSize: 2 });

    // Another device publishes four frames, so the backlog spans two pages.
    const seeder = createDbEngine({
      vaultClient: vault,
      storageKeyPrefix: 'dev-seeder',
      deviceId: 'device-seeder',
      nativeGetSyncKey: () => null,
      nativeStoreSyncKey: () => {},
      getData: () => clone({
        ...EMPTY,
        gtdFrames: [
          frame('f1', '2026-09-26T10:00:00.000Z', ['mon']),
          frame('f2', '2026-09-26T10:00:01.000Z', ['tue']),
          frame('f3', '2026-09-26T10:00:02.000Z', ['wed']),
          frame('f4', '2026-09-26T10:00:03.000Z', ['thu']),
        ],
      }),
      commitData: () => {},
      cycleBreaker: { beforeCycle: () => ({ allowed: true }), onSuccess() {}, onFailure() { return 0; } },
    });
    await seeder.dbSyncCycle();
  });

  afterEach(() => { vi.useRealTimers(); });
  afterAll(() => { delete global.localStorage; });

  it('recovers the stranded rows on the next launch', async () => {
    // Died after the cursor reached the end of the backlog but before any commit.
    strandCursor({ toSeq: 4, markAt: 0 });

    const device = launch(vault, EMPTY);
    // The recovery ran during construction, before any cycle.
    expect(hwm()).toBe(0);
    expect(global.localStorage.getItem(MARK_KEY)).toBeNull();

    await device.engine.dbSyncCycle();
    expect(frameIds(device)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('CONTROL: without the mark the rows are stranded permanently', async () => {
    // Identical strand, no mark — the behaviour before this fix. Nothing tells
    // the next launch that the cursor is ahead of committed state.
    strandCursor({ toSeq: 4, markAt: null });

    const device = launch(vault, EMPTY);
    expect(hwm()).toBe(4);

    await device.engine.dbSyncCycle();
    expect(frameIds(device)).toEqual([]);

    // And no later cycle brings them back: they are below the cursor forever.
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await device.engine.dbSyncCycle();
    expect(frameIds(device)).toEqual([]);
  });

  it('only ever rewinds: a mark at or above the cursor does not move it', async () => {
    // A corrupt or stale-forward mark must never raise the cursor — that would
    // skip rows outright, which is the loss this guards against.
    strandCursor({ toSeq: 2, markAt: 9 });
    launch(vault, EMPTY);
    expect(hwm()).toBe(2);

    strandCursor({ toSeq: 2, markAt: 2 });
    launch(vault, EMPTY);
    expect(hwm()).toBe(2);

    strandCursor({ toSeq: 2, markAt: 'not-a-number' });
    launch(vault, EMPTY);
    expect(hwm()).toBe(2);
  });

  it('a committed cycle leaves no mark behind', async () => {
    const device = launch(vault, EMPTY);
    await device.engine.dbSyncCycle();

    expect(frameIds(device)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(global.localStorage.getItem(MARK_KEY)).toBeNull();
    // Past the seeded backlog. Not pinned to exactly 4: this device's own
    // full-seed push advances the account seq as well, and how far is the
    // package's business, not this suite's.
    const committed = hwm();
    expect(committed).toBeGreaterThanOrEqual(4);

    // So a relaunch after a healthy cycle changes nothing.
    const relaunched = launch(vault, device.data);
    expect(hwm()).toBe(committed);
    expect(frameIds(relaunched)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('a thrown mid-pagination failure clears the mark after its own rollback', async () => {
    // The existing rollback already covers this path; the mark must not be left
    // behind to cause a second, redundant rewind on the next launch.
    vault.armFailure(2);
    const device = launch(vault, EMPTY);
    await device.engine.dbSyncCycle().catch(() => {});
    vault.disarm();

    expect(hwm()).toBe(0);
    expect(global.localStorage.getItem(MARK_KEY)).toBeNull();

    // The rows are still reachable, which is what the rollback exists for.
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await device.engine.dbSyncCycle();
    expect(frameIds(device)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });
});
