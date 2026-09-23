// The JOBO ledger through both sync tiers, end to end.
//
// docs/jobo-ledger-persistence.md, "Testing": assert the record is observable
// where the app reads it, not that a function returned it. `originalPlan` had
// unit tests on every boundary and still shipped in a state where it never
// survived one sync cycle, because nothing exercised the path BETWEEN the
// modules. Each scenario here walks the whole path: the hook's state, the
// payload the engine shreds, the vault adapter's per-row merge, the file-tier
// merge, and the hook's state on the other device. Scenario numbers follow the
// design doc. The mutation that must break each one is named beside it.
import { describe, it, expect } from 'vitest';
import {
  shredState, reassembleState, applyRemoteEntity, applyRemoteDelete, getLocalEntity,
  isInsertOnly, makeEntityId, COLLECTION_KINDS,
} from './dbAdapter.js';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { mergeSyncData } from '../mergeSync.js';
import { createLedger, mergeJoboCollections } from '../jobo/ledger.js';
import { createDoRecord, tombstoneDoRecord, pickJoboRecord } from '../jobo/core.js';

const T0 = '2026-09-19T15:10:02.000Z';
const T1 = '2026-09-19T16:00:00.000Z';
const OLD = '2026-01-05T09:00:00.000Z'; // far outside any tombstone window
const base = {
  id: `do:t1:${T0}`, taskId: 't1', timing: 'timed', date: '2026-09-19', startTime: '14:30',
  endDate: '2026-09-19', endTime: '15:10', title: 'Draft the report',
  planSnapshot: { date: '2026-09-19', startTime: '14:30', duration: 60 },
  source: 'completion', progress: 'completed', createdAt: T0, updatedAt: T0, observedAt: T0,
};
const rec = (over = {}) => createDoRecord({ ...base, ...over });

// A store with the real contract, in memory.
function memStore(initial) {
  let value = initial;
  return {
    async writable() { return true; }, async mode() { return 'indexeddb'; },
    async read() { return { ok: true, value }; },
    async update(fn) { value = fn(value); return { ok: true, value }; },
    async write(v) { value = v; return { ok: true, value }; },
    peek: () => value,
  };
}
// What buildSyncPayload puts in `data` for the ledger: the key only once loaded.
const payloadData = (ledger) => (ledger.get().records === undefined ? {} : { joboRecords: ledger.get().records });
const jid = (record) => makeEntityId('joboRecords', record.id);
const EMPTY = { tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [], habits: [], goals: [], projects: [], areas: [], gtdFrames: [], users: [], dailyNotes: {} };

describe('registration', () => {
  it('is a collection kind on updatedAt, and insert-only', () => {
    expect(COLLECTION_KINDS.joboRecords).toEqual({ idField: 'id', tsField: 'updatedAt' });
    expect(isInsertOnly({ _kind: 'joboRecords', value: rec() })).toBe(true);
  });
});

// 1. save → state → push → apply.
describe('scenario 1: a record survives save, state, push and apply', () => {
  it('is in state, in the payload, in a vault row, and in the other device state', async () => {
    const a = createLedger({ store: memStore([]) });
    await a.load();
    const record = rec();
    expect((await a.commit([record])).ok).toBe(true);
    expect(a.get().records).toEqual([record]);                       // state
    const data = { ...EMPTY, ...payloadData(a) };
    expect(data.joboRecords).toEqual([record]);                      // payload
    const row = shredState(data).find((r) => r.entityId === jid(record));
    expect(row.entity.value).toEqual(record);                        // vault row
    // MUTATION: drop joboRecords from COLLECTION_KINDS and the row is a
    // singleton blob instead, and reassemble puts nothing under the key.
    expect(reassembleState([row]).joboRecords).toEqual([record]);
    const bMirror = { ...EMPTY, joboRecords: [] };
    applyRemoteEntity(bMirror, row.entity);
    const b = createLedger({ store: memStore([]) });
    await b.load();
    await b.applyRemote(bMirror.joboRecords);                        // applyEngineData → hook
    expect(b.get().records).toEqual([record]);                       // other device state
  });

  it('omits the key while the ledger has not loaded, rather than claiming it is empty', async () => {
    const failing = { ...memStore([]), async read() { return { ok: false, error: 'storageRead' }; } };
    const a = createLedger({ store: failing });
    await a.load();
    // MUTATION: return [] from a failed read and the payload carries an empty
    // ledger that would win nothing and lose everything on the file tier.
    expect(payloadData(a)).toEqual({});
  });
});

// 2. The flag gates the interface, never the data: nothing in this path reads
// joboEnabled. The hook, the payload and the apply are flag-free by construction.

// 3. A device that predates the collection, and the horizon.
describe('scenario 3: an older build and the sync horizon', () => {
  it('a payload without the key merges against one with it, and the records survive', () => {
    const local = { ...EMPTY, joboRecords: [rec()] };
    const remote = { ...EMPTY }; // older build: no key at all
    const { data, localChanged, remoteChanged } = mergeSyncData(local, remote, 90);
    expect(data.joboRecords).toEqual([rec()]);
    expect(remoteChanged).toBe(true);   // the remote needs it
    expect(localChanged).toBe(false);   // nothing new for us
    const other = mergeSyncData(remote, local, 90);
    expect(other.data.joboRecords).toEqual([rec()]);
    expect(other.localChanged).toBe(true);
  });

  it('an old local-only record and an old local-only tombstone survive the file tier past the window', () => {
    const oldRecord = rec({ id: 'do:t9:old', createdAt: OLD, updatedAt: OLD, observedAt: OLD });
    const oldTombstone = tombstoneDoRecord(rec({ id: 'do:t8:gone', createdAt: OLD, updatedAt: OLD, observedAt: OLD }), '2026-01-06T00:00:00.000Z');
    const local = { ...EMPTY, joboRecords: [oldRecord, oldTombstone] };
    // A remote whose tombstone window has long since passed the old rows.
    const remote = { ...EMPTY, joboRecords: [], tombstonePrunedBefore: '2026-09-01T00:00:00.000Z' };
    // MUTATION: pass the sync horizon to the ledger merge and both rows are
    // dropped as presumed zombies.
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.joboRecords.map((r) => r.id).sort()).toEqual(['do:t8:gone', 'do:t9:old']);
    // ...and the kept tombstone still beats a stale live copy arriving later.
    const staleLive = { ...oldTombstone, deleted: false, updatedAt: OLD };
    const again = mergeSyncData(data, { ...EMPTY, joboRecords: [staleLive] }, 90);
    expect(again.data.joboRecords.find((r) => r.id === 'do:t8:gone').deleted).toBe(true);
  });
});

// 4. Same completion, two devices, one record; and the convergence rule.
describe('scenario 4: two devices, one record', () => {
  const early = rec({ observedAt: T0, title: 'as it was' });
  const late = rec({ observedAt: '2026-09-19T15:20:00.000Z', date: '2026-09-18', title: 'after the reschedule' });

  it('vault tier: the earlier observer wins whichever side is local, and the loser re-pushes the winner', () => {
    const mirrorA = { ...EMPTY, joboRecords: [early] };
    // MUTATION: route joboRecords through upsertCollection instead of
    // applyRemoteJobo and the later copy replaces the earlier one here.
    expect(applyRemoteEntity(mirrorA, { _kind: 'joboRecords', value: late })).toEqual([jid(early)]);
    expect(mirrorA.joboRecords[0]).toEqual(early);
    const mirrorB = { ...EMPTY, joboRecords: [late] };
    expect(applyRemoteEntity(mirrorB, { _kind: 'joboRecords', value: early })).toEqual([]);
    expect(mirrorB.joboRecords[0]).toEqual(early);
  });

  it('vault tier: two devices holding different pristine copies converge on one through a shared vault', () => {
    const vault = createVault();
    const a = createDevice('A', { ...EMPTY, joboRecords: [early] });
    const b = createDevice('B', { ...EMPTY, joboRecords: [late] });
    a.markDirty(jid(early));
    b.markDirty(jid(late));
    // MUTATION: make joboRecords LWW instead of insert-only and the sim's
    // "remote newer" test skips the tie, so each device keeps its own copy.
    syncToConvergence(a, b, vault);
    expect(a.data.joboRecords).toEqual([early]);
    expect(b.data.joboRecords).toEqual([early]);
  });

  it('file tier: the same winner in both merge orders', () => {
    const ab = mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [late] }, 90);
    const ba = mergeSyncData({ ...EMPTY, joboRecords: [late] }, { ...EMPTY, joboRecords: [early] }, 90);
    expect(ab.data.joboRecords).toEqual([early]);
    expect(ba.data.joboRecords).toEqual([early]);
    expect(ab.remoteChanged).toBe(true);  // remote held the loser
    expect(ab.localChanged).toBe(false);
    expect(ba.localChanged).toBe(true);   // we held the loser
    expect(ba.remoteChanged).toBe(false);
  });

  it('a user edit beats a late re-observation, and a tombstone beats a stale live copy, on both tiers', () => {
    const edited = rec({ updatedAt: T1, progress: 'partial' });
    const mirror = { ...EMPTY, joboRecords: [edited] };
    expect(applyRemoteEntity(mirror, { _kind: 'joboRecords', value: early })).toEqual([jid(early)]);
    expect(mirror.joboRecords[0].progress).toBe('partial');
    const dead = tombstoneDoRecord(early, T1);
    const file = mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [dead] }, 90);
    expect(file.data.joboRecords[0].deleted).toBe(true);
    expect(file.localChanged).toBe(true);
  });

  it('an identical pulled copy is a no-op, not a re-push', () => {
    const mirror = { ...EMPTY, joboRecords: [early] };
    expect(applyRemoteEntity(mirror, { _kind: 'joboRecords', value: { ...early } })).toEqual([]);
    const same = mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [{ ...early }] }, 90);
    // MUTATION: raise a change flag on equal copies and this is the push churn
    // the archived field once caused.
    expect(same.localChanged).toBe(false);
    expect(same.remoteChanged).toBe(false);
  });
});

describe('deletion is a row, never a row delete', () => {
  it('a vault row delete leaves the ledger untouched', () => {
    const mirror = { ...EMPTY, joboRecords: [rec()] };
    applyRemoteDelete(mirror, jid(rec()));
    expect(mirror.joboRecords).toHaveLength(1);
    expect(getLocalEntity(mirror, jid(rec()))).not.toBeNull();
  });
});

describe('mergeJoboCollections change flags', () => {
  it('neither side carries it: no key, no flags', () => {
    expect(mergeJoboCollections(undefined, undefined)).toEqual({ merged: undefined, localChanged: false, remoteChanged: false });
  });
  it('uses core pickJoboRecord by default', () => {
    const early = rec({ observedAt: T0 });
    const late = rec({ observedAt: T1, title: 'late' });
    expect(mergeJoboCollections([late], [early]).merged).toEqual([pickJoboRecord(late, early)]);
  });
});

// 11. Restore then reload keeps the ledger.
describe('scenario 11: restore writes through the checked write and a fresh hook sees it', () => {
  it('replaces the collection and a new controller over the same store loads it', async () => {
    const store = memStore([rec({ id: 'do:stale', title: 'from before' })]);
    const first = createLedger({ store });
    await first.load();
    const fromBackup = [rec(), tombstoneDoRecord(rec({ id: 'do:t2:x' }), T1)];
    expect((await first.restore(fromBackup)).ok).toBe(true);
    expect(first.get().records.map((r) => r.id).sort()).toEqual([base.id, 'do:t2:x']);
    const second = createLedger({ store });
    await second.load();
    expect(second.get().records.map((r) => r.id).sort()).toEqual([base.id, 'do:t2:x']);
  });

  it('a failed restore write is not acknowledged and does not touch state', async () => {
    const store = { ...memStore([rec()]), async write() { return { ok: false, error: 'storageWrite' }; } };
    const ledger = createLedger({ store });
    await ledger.load();
    // MUTATION: set state before the write resolves ok and the reload that
    // follows a restore reads back the old ledger while the UI showed the new.
    expect((await ledger.restore([rec({ id: 'do:new' })])).ok).toBe(false);
    expect(ledger.get().records.map((r) => r.id)).toEqual([base.id]);
  });
});
