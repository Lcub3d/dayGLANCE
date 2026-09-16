import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { sanitizeMergedRoutineCompletions, startOfTodayIso, resetRoutineCompletionsForToday } from '../hooks/useRoutines.js';
import { dateToString } from '../utils/taskUtils.js';

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
function createMemoryVault() {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  return {
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      const rows = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows, hasMore: false };
    },
    async device() { return { updated: true }; },
    async getRow(app, entityId) {
      const r = log.get(entityId);
      return r && !r.deleted ? { entityId: r.entityId, seq: r.seq, envelope: r.envelope, deleted: false } : null;
    },
    _seq() { return seq; },
  };
}

const FIXTURE_NOW = new Date('2026-07-10T12:00:00.000Z');
let logs;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  global.localStorage = memLocalStorage();
  global.localStorage.setItem('dayglance-debug-push', '1');
  setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
  setSyncPassphrase('correct horse battery staple');
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.map(String).join(' ')));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));
const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};
const IDS = ['a', 'b', 'c'];
const YESTERDAY = '2026-07-09';

// A device wired like the app for the routine bundle: getData = payload
// (completions + sibling timestamps), commitData = applyEngineData's routine
// section (the routinesDate gate + sanitizeMergedRoutineCompletions).
function makeDevice(name, vault, initial) {
  let data = clone(initial);
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    getData: () => clone(data),
    commitData: (d) => {
      const todayStr = dateToString(new Date());
      const sanitized = d.routineCompletions
        ? sanitizeMergedRoutineCompletions(d.routineCompletions, d.routineCompletionTimestamps || {}, todayStr, startOfTodayIso())
        : null;
      data = clone(d);
      if (d.routinesDate === todayStr && sanitized) {
        data.routineCompletions = sanitized.completions;
        data.routineCompletionTimestamps = sanitized.timestamps;
      }
    },
  });
  return { engine, get data() { return data; }, set data(d) { data = d; } };
}

describe('routineCompletions: stale prior-day completion tied at the midnight tombstone', () => {
  it('settles after two pushes instead of one write per cycle forever', async () => {
    const vault = createMemoryVault();
    const M = startOfTodayIso();
    const today = dateToString(new Date());
    // A peer holds yesterday's completions stamped at (this device's) midnight —
    // the field signature — and has pushed them to the vault.
    const peer = makeDevice('peer', vault, {
      ...EMPTY, routinesDate: today,
      routineCompletions: Object.fromEntries(IDS.map((id) => [id, YESTERDAY])),
      routineCompletionTimestamps: Object.fromEntries(IDS.map((id) => [id, M])),
    });
    await peer.engine.dbSyncCycle();
    // This device launches today: the load-time reset leaves the completions
    // absent with midnight tombstones.
    const reset = resetRoutineCompletionsForToday(
      Object.fromEntries(IDS.map((id) => [id, YESTERDAY])), Object.fromEntries(IDS.map((id) => [id, M])), today, M,
    );
    const mac = makeDevice('mac', vault, {
      ...EMPTY, routinesDate: today,
      routineCompletions: reset.completions, routineCompletionTimestamps: reset.timestamps,
    });
    const seqs = [];
    for (let i = 0; i < 6; i++) {
      logs.length = 0;
      await mac.engine.dbSyncCycle();
      const wrote = logs.find((l) => l.includes('[push] cycle →'));
      const diff = logs.filter((l) => l.includes('snapshot-diff'));
      seqs.push({ cycle: i + 1, seq: vault._seq(), wrote: wrote ?? '(silent)', diff });
    }
    for (const s of seqs) console.info(`cycle ${s.cycle} seq=${s.seq} ${s.wrote}\n   ${s.diff.join('\n   ')}`);
    // Converged: the vault seq stops advancing and the local state is clean.
    expect(seqs[5].seq).toBe(seqs[3].seq);
    expect(mac.data.routineCompletions).toEqual({});
    for (const id of IDS) expect(mac.data.routineCompletionTimestamps[id] > M).toBe(true);
  });
});
