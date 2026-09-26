// Synthetic diagnostic, not a regression test asserting a defect as desired behavior.
import { createLedger } from '../src/jobo/ledger.js';
import { snapshotJoboState, planJoboTransitions, buildJoboRecords } from '../src/jobo/detector.js';
import { completionTimestamp } from '../src/utils/taskUtils.js';
const original = { id: 't', title: 'Synthetic review task', date: '2026-09-27', startTime: '09:00', duration: 60, completed: false };
const snapshot = task => snapshotJoboState([task], [], []);
const build = (prev, next, records, observedAt) => buildJoboRecords(planJoboTransitions(snapshot(prev), snapshot(next), { tasks: [next], unscheduledTasks: [], recurringTasks: [] }).edges, records, { observedAt });
let rows = [], fail = true;
const store = { read: async () => ({ ok: true, value: rows }), writable: async () => true,
  update: async fn => fail ? { ok: false, error: 'storageWrite' } : { ok: true, value: (rows = fn(rows)) } };
const ledger = createLedger({ store, retry: { schedule: () => 1, cancel: () => {} } });
await ledger.load();
const done = { ...original, completed: true, completedAt: '2026-09-27T10:00:00Z' };
const created = build(original, done, ledger.get().records, '2026-09-27T10:00:01Z');
const held = await ledger.commit(created);
const reopened = { ...original, completedAt: null };
const reopenRows = build(done, reopened, ledger.get().records, '2026-09-27T10:00:02Z');
fail = false;
await ledger.retryHeld();
const failure1 = { name: 'held completion then immediate reopen', taskCompleted: reopened.completed, reopenRows: reopenRows.length, storedProgress: ledger.get().records[0].progress, expectedProgress: 'partial' };
// Repeat with a clean ledger and two valid native completion stamps in the same second.
rows = [];
const secondLedger = createLedger({ store }); await secondLedger.load();
const stamp1 = completionTimestamp(new Date('2026-09-27T11:00:00.100Z'));
const stamp2 = completionTimestamp(new Date('2026-09-27T11:00:00.900Z'));
const firstDone = { ...original, completed: true, completedAt: stamp1 };
await secondLedger.commit(build(original, firstDone, secondLedger.get().records, '2026-09-27T11:00:00.110Z'));
await secondLedger.commit(build(firstDone, reopened, secondLedger.get().records, '2026-09-27T11:00:00.500Z'));
const again = build(reopened, { ...firstDone, completedAt: stamp2 }, secondLedger.get().records, '2026-09-27T11:00:00.910Z');
const failure2 = { name: 'recomplete inside one second', stamp1, stamp2, newAttempts: again.length, recordCount: secondLedger.get().records.length, progress: secondLedger.get().records[0].progress, expectedRecordCount: 2 };
console.log(JSON.stringify({ upstream: '49b0a4b42c87a0be62970723c8bc869954bb4cd2', observations: [failure1, failure2] }, null, 2));
ledger.dispose(); secondLedger.dispose();
