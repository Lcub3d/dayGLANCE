import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  DO_SOURCES, DO_TIMING, TIMING, COMPLETION_STATUS,
  createDoRecord, validateDoRecord, updateDoRecord, tombstoneDoRecord,
  completeDoAttempt, migrateLegacyDoRecord, setPlanCompletionStatus,
  doDurationMinutes, classifyAgainstPlan, pickJoboRecord,
} from './core.js';

const T0 = '2026-09-19T15:10:02.000Z';
const T1 = '2026-09-19T15:11:02.000Z';
const T2 = '2026-09-19T16:10:02.000Z';
const plan = (patch = {}) => ({ date: '2026-09-19', startTime: '14:30', duration: 60, ...patch });
const input = (patch = {}) => ({
  id: 'do:t1:2026-09-19T15:10:02.000Z', taskId: 't1',
  timing: DO_TIMING.TIMED,
  date: '2026-09-19', startTime: '14:30', endDate: '2026-09-19', endTime: '15:10',
  title: 'Draft the report', planSnapshot: plan(), source: 'completion',
  createdAt: T0, updatedAt: T0, observedAt: T1,
  deleted: false, ...patch,
});
const record = (patch = {}) => createDoRecord(input(patch));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const now = time => ({ date: '2026-09-19', time });

// Shape tests are strict for new records. Transport tests below intentionally
// use opaque/minimal rows too, matching #1762's existing controller fixtures.
describe('Do record contract', () => {
  it('returns a plain complete record, not a result envelope', () => {
    const source = input();
    const actual = createDoRecord(source);
    assert.deepEqual(actual, source);
    assert.deepEqual(validateDoRecord(actual), { ok: true, errors: [] });
    assert.notEqual(actual, source);
    assert.notEqual(actual.planSnapshot, source.planSnapshot);
  });
  it('defaults only deleted; missing historical inputs are not fabricated', () => {
    const source = input();
    delete source.deleted;
    assert.equal(createDoRecord(source).deleted, false);
    for (const key of ['id', 'taskId', 'timing', 'title', 'planSnapshot', 'source', 'createdAt', 'updatedAt', 'observedAt', 'endDate']) {
      const missing = input();
      delete missing[key];
      assert.throws(() => createDoRecord(missing), TypeError, key);
    }
  });
  it('defensively captures the plan and opaque nested data', () => {
    const source = input({ extra: { values: [{ x: 1 }] } });
    const actual = createDoRecord(source);
    source.title = 'renamed';
    source.planSnapshot.duration = 900;
    source.extra.values[0].x = 2;
    assert.equal(actual.title, 'Draft the report');
    assert.equal(actual.planSnapshot.duration, 60);
    assert.equal(actual.extra.values[0].x, 1);
  });
  it('accepts frozen input without mutating it', () => {
    const source = freeze(input());
    assert.deepEqual(createDoRecord(source), source);
  });
  it('keeps explicit unlinked manual execution entries', () => {
    const r = record({ taskId: null, planSnapshot: null, source: 'manual' });
    assert.equal(r.taskId, null);
    assert.equal(r.planSnapshot, null);
    assert.equal(ownKey(r, 'progress'), false);
  });
  it('represents unmeasured execution explicitly as Untimed Do', () => {
    const r = record({
      timing: DO_TIMING.UNTIMED,
      planSnapshot: null,
      startTime: null,
      endDate: null,
      endTime: null,
    });
    assert.equal(r.timing, DO_TIMING.UNTIMED);
    assert.equal(r.startTime, null);
    assert.equal(r.endDate, null);
    assert.equal(r.endTime, null);
    assert.equal(doDurationMinutes(r), null);
  });
  it('keeps numeric native task identities without rewriting them', () => {
    assert.equal(record({ taskId: 7 }).taskId, 7);
  });
  it('keeps orphan task links, offsets and historical dates', () => {
    const stamp = '2026-09-19T09:10:02-06:00';
    const r = record({ taskId: 'deleted-task', createdAt: stamp, updatedAt: stamp, date: '1999-12-31', endDate: '2000-01-01', startTime: '23:50', endTime: '00:10' });
    assert.equal(r.createdAt, stamp);
    assert.equal(doDurationMinutes(r), 20);
  });
  it('does not confuse observer clock skew with an invalid event version', () => {
    assert.equal(record({ observedAt: '2020-01-01T00:00:00.000Z' }).observedAt, '2020-01-01T00:00:00.000Z');
  });
  it('rejects progress on a Do record because completion belongs to Plan', () => {
    const candidate = input({ progress: 'started' });
    assert.equal(validateDoRecord(candidate).ok, false);
    assert.throws(() => createDoRecord(candidate), TypeError);
  });
  it('migrates legacy Do progress explicitly without retaining it on the record', () => {
    const migrated = migrateLegacyDoRecord(input({ progress: 'partial' }));
    assert.equal(migrated.legacyCompletionStatus, 'partly');
    assert.equal(ownKey(migrated.record, 'progress'), false);
    assert.equal(migrated.record.id, input().id);
    assert.equal(migrated.record.updatedAt, T0);
    assert.deepEqual(validateDoRecord(migrated.record), { ok: true, errors: [] });
  });
  it('maps legacy complete/completed spellings but rejects unknown legacy progress', () => {
    assert.equal(migrateLegacyDoRecord(input({ progress: 'complete' })).legacyCompletionStatus, 'completed');
    assert.equal(migrateLegacyDoRecord(input({ progress: 'completed' })).legacyCompletionStatus, 'completed');
    assert.throws(() => migrateLegacyDoRecord(input({ progress: 'almost' })), TypeError);
  });
  it('adds the timing discriminant at the legacy boundary before merge', () => {
    const oldTimed = input({ progress: 'partial' });
    delete oldTimed.timing;
    const migratedTimed = migrateLegacyDoRecord(oldTimed);
    assert.equal(migratedTimed.record.timing, DO_TIMING.TIMED);

    const oldZeroCompletion = input({ progress: 'completed', endTime: '14:30' });
    delete oldZeroCompletion.timing;
    const migratedUntimed = migrateLegacyDoRecord(oldZeroCompletion);
    assert.equal(migratedUntimed.record.timing, DO_TIMING.UNTIMED);
    assert.equal(migratedUntimed.record.startTime, null);
    assert.equal(migratedUntimed.record.endDate, null);
    assert.equal(migratedUntimed.record.endTime, null);
    assert.equal(doDurationMinutes(migratedUntimed.record), null);
  });
  for (const source of DO_SOURCES) it(`accepts the documented ${source} source`, () => assert.equal(record({ source }).source, source));
  const invalid = [
    ['empty id', { id: '' }], ['blank title', { title: '  ' }],
    ['missing task id', { taskId: undefined }], ['object task id', { taskId: {} }],
    ['unsafe numeric task id', { taskId: Number.MAX_SAFE_INTEGER + 1 }],
    ['unknown timing', { timing: 'clocked' }],
    ['untimed with a start', { timing: DO_TIMING.UNTIMED, startTime: '14:30', endDate: null, endTime: null }],
    ['untimed with an end date', { timing: DO_TIMING.UNTIMED, startTime: null, endDate: '2026-09-19', endTime: null }],
    ['untimed with an end time', { timing: DO_TIMING.UNTIMED, startTime: null, endDate: null, endTime: '15:10' }],
    ['unknown source', { source: 'automatic-magic' }], ['nonboolean deletion', { deleted: 1 }],
    ['bad day', { date: '2026-02-30' }], ['bad leap day', { date: '1900-02-29' }],
    ['zero year', { date: '0000-01-01' }], ['noncanonical date', { date: '2026-9-19' }],
    ['24:00 must use next endDate', { endTime: '24:00' }], ['un-padded clock', { startTime: '9:00' }],
    ['zero interval with a timed plan', { endTime: '14:30' }],
    ['zero completion interval without a plan', { source: 'completion', planSnapshot: null, endTime: '14:30' }],
    ['zero manual interval without a plan', { source: 'manual', planSnapshot: null, endTime: '14:30' }],
    ['zero focus interval without a plan', { source: 'focus', planSnapshot: null, endTime: '14:30' }],
    ['backwards interval', { endTime: '14:00' }],
    ['backwards unscheduled completion', { planSnapshot: null, endTime: '14:00' }],
    ['bad endDate', { endDate: '2026-09-18' }],
    ['missing snapshot', { planSnapshot: undefined }], ['bad snapshot duration', { planSnapshot: plan({ duration: 0 }) }],
    ['snapshot must not capture Plan completion', { planSnapshot: plan({ completionStatus: 'mostly' }) }],
    ['string snapshot duration', { planSnapshot: plan({ duration: '60' }) }],
    ['invalid snapshot date', { planSnapshot: plan({ date: '2026-02-30' }) }],
    ['NaN snapshot', { planSnapshot: plan({ duration: NaN }) }],
    ['timezone-less stamp', { createdAt: '2026-09-19T15:10:02' }],
    ['numeric epoch stamp', { createdAt: Date.parse(T0) }],
    ['normalized-invalid stamp', { updatedAt: '2026-02-30T00:00:00.000Z' }],
    ['old version', { updatedAt: '2026-09-18T00:00:00.000Z' }],
    ['missing observer', { observedAt: null }], ['nonfinite extension', { extra: Infinity }],
    ['undefined extension', { extra: undefined }], ['non-JSON object', { extra: new Date(T0) }],
  ];
  for (const [name, patch] of invalid) it(`rejects ${name}`, () => {
    assert.equal(validateDoRecord(input(patch)).ok, false);
    assert.throws(() => createDoRecord(input(patch)), TypeError);
  });
  it('rejects cycles and sparse arrays rather than losing fields on serialization', () => {
    const circular = input(); circular.self = circular;
    assert.equal(validateDoRecord(circular).ok, false);
    assert.throws(() => createDoRecord(circular), TypeError);
    assert.throws(() => record({ extra: new Array(1) }), TypeError);
  });
  for (const value of [null, undefined, [], 5, 'record']) it(`rejects non-object ${String(value)}`, () => {
    assert.equal(validateDoRecord(value).ok, false);
    assert.throws(() => createDoRecord(value), TypeError);
  });
});
function ownKey(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

describe('Plan completion assessment', () => {
  it('is a pure Plan-occurrence assessment, not a monotonic workflow', () => {
    const original = freeze(plan({ id: 'plan:t1:2026-09-19' }));
    const started = setPlanCompletionStatus(original, COMPLETION_STATUS.STARTED);
    const mostly = setPlanCompletionStatus(started, COMPLETION_STATUS.MOSTLY);
    const partly = setPlanCompletionStatus(mostly, COMPLETION_STATUS.PARTLY);
    const completed = setPlanCompletionStatus(partly, COMPLETION_STATUS.COMPLETED);
    const cleared = setPlanCompletionStatus(completed, null);

    assert.equal(original.completionStatus, undefined);
    assert.equal(started.completionStatus, COMPLETION_STATUS.STARTED);
    assert.equal(mostly.completionStatus, COMPLETION_STATUS.MOSTLY);
    assert.equal(partly.completionStatus, COMPLETION_STATUS.PARTLY);
    assert.equal(completed.completionStatus, COMPLETION_STATUS.COMPLETED);
    assert.equal(cleared.completionStatus, null);
    assert.equal(completed.id, original.id);
    assert.equal(completed.date, original.date);
    assert.equal(completed.startTime, original.startTime);
    assert.equal(completed.duration, original.duration);
  });

  it('requires a stable Plan id and rejects noncanonical assessments', () => {
    assert.throws(() => setPlanCompletionStatus(plan(), COMPLETION_STATUS.STARTED), TypeError);
    assert.throws(() => setPlanCompletionStatus(plan({ id: 'p1' }), 'partial'), TypeError);
    assert.throws(() => setPlanCompletionStatus({}, COMPLETION_STATUS.STARTED), TypeError);
  });

  it('keeps a no-op assessment referentially stable', () => {
    const p = plan({ id: 'p1', completionStatus: COMPLETION_STATUS.PARTLY });
    assert.equal(setPlanCompletionStatus(p, COMPLETION_STATUS.PARTLY), p);
  });
});

describe('local corrections and tombstones', () => {
  it('corrects intervals without refreshing captured history', () => {
    const original = freeze(record({ extra: { retained: true } }));
    const changed = updateDoRecord(original, { startTime: '14:40', endTime: '15:20' }, T2);
    assert.equal(changed.startTime, '14:40');
    assert.equal(changed.endTime, '15:20');
    for (const key of ['id', 'taskId', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt', 'extra']) {
      assert.deepEqual(changed[key], original[key], key);
    }
    assert.equal(changed.updatedAt, T2);
  });
  for (const key of ['id', 'taskId', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt', 'updatedAt', 'deleted', 'progress', 'extra']) {
    it(`does not accept ${key} in an edit patch`, () => assert.throws(() => updateDoRecord(record(), { [key]: input()[key] }, T2), TypeError));
  }
  for (const stamp of [undefined, T0, '2020-01-01T00:00:00.000Z', 'bad']) {
    it(`requires a strictly newer supplied edit version (${stamp})`, () => {
      assert.throws(() => updateDoRecord(record(), { startTime: '14:40' }, stamp), RangeError);
      assert.throws(() => tombstoneDoRecord(record(), stamp), RangeError);
    });
  }
  it('keeps no-op identity and does not bump timestamps', () => {
    const r = record();
    assert.equal(updateDoRecord(r, {}, undefined), r);
    assert.equal(updateDoRecord(r, { startTime: r.startTime }, T2), r);
  });
  it('validates the whole corrected interval, including a moved endDate', () => {
    const r = record();
    assert.throws(() => updateDoRecord(r, { endTime: '00:10' }, T2), TypeError);
    const changed = updateDoRecord(r, { startTime: '23:50', endDate: '2026-09-20', endTime: '00:10' }, T2);
    assert.equal(doDurationMinutes(changed), 20);
  });
  it('can correct between Timed and Untimed without using zero as unknown', () => {
    const timed = record();
    const untimed = updateDoRecord(timed, {
      timing: DO_TIMING.UNTIMED,
      startTime: null,
      endDate: null,
      endTime: null,
    }, T2);
    assert.equal(untimed.timing, DO_TIMING.UNTIMED);
    assert.equal(doDurationMinutes(untimed), null);

    const retimed = updateDoRecord(untimed, {
      timing: DO_TIMING.TIMED,
      startTime: '14:40',
      endDate: '2026-09-19',
      endTime: '15:00',
    }, '2026-09-19T17:10:02.000Z');
    assert.equal(retimed.timing, DO_TIMING.TIMED);
    assert.equal(doDurationMinutes(retimed), 20);
  });
  it('never turns a deletion into removal or a subsequent edit into revival', () => {
    const r = record();
    const deleted = tombstoneDoRecord(r, T2);
    assert.deepEqual(deleted, { ...r, deleted: true, updatedAt: T2 });
    assert.equal(tombstoneDoRecord(deleted, 'bad'), deleted);
    assert.throws(() => updateDoRecord(deleted, { startTime: '14:40' }, T2), TypeError);
  });
});

describe('explicit attempt identity (not a task detector)', () => {
  for (const kind of ['ordinary', 'recurring', 'legacy-recurring']) {
    it(`${kind}: complete, re-complete, late duplicate`, () => {
      const id1 = kind === 'ordinary' ? `do:t1:${T0}` : kind === 'recurring' ? `do:r1:2026-09-19:${T0}` : 'do:r1:2026-09-19';
      const id2 = kind === 'ordinary' ? `do:t1:${T2}` : `do:r1:2026-09-19:${T2}`;
      const firstInput = freeze(input({ id: id1 }));
      const first = freeze(completeDoAttempt([], firstInput));
      assert.equal(first.length, 1);
      assert.equal(ownKey(first[0], 'progress'), false);
      const both = completeDoAttempt(first, input({ id: id2, createdAt: T2, updatedAt: T2, observedAt: T2 }));
      assert.equal(both.length, 2);
      assert.equal(both[0], first[0]);
      assert.equal(ownKey(both[1], 'progress'), false);
      assert.equal(completeDoAttempt(both, { id: id1 }), both);
      assert.deepEqual(first[0].planSnapshot, both[0].planSnapshot);
    });
  }
  it('a replay never refreshes snapshots or revives a deleted attempt', () => {
    const gone = tombstoneDoRecord(record(), T2);
    const records = freeze([gone]);
    assert.equal(completeDoAttempt(records, input({ title: 'New task title', planSnapshot: plan({ duration: 10 }), updatedAt: T2 })), records);
  });
  it('keeps a re-completion as a second attempt without counting the same interval twice', () => {
    const first = completeDoAttempt([], input({ endTime: '15:30' }));
    const both = completeDoAttempt(first, input({ id: 'second', endTime: '15:30', createdAt: T2, updatedAt: T2, observedAt: T2 }));
    const result = classifyAgainstPlan(plan(), both);
    assert.equal(result.attemptCount, 2);
    assert.equal(result.recordedMinutes, 60);
    assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
  });
  it('creation does not mutate the supplied input or collection', () => {
    const r = freeze(input());
    const items = freeze([]);
    const created = completeDoAttempt(items, r);
    assert.equal(ownKey(created[0], 'progress'), false);
    assert.equal(items.length, 0);
  });
  it('can ensure-present an Untimed completion attempt without inventing minutes', () => {
    const untimedInput = input({
      timing: DO_TIMING.UNTIMED,
      startTime: null,
      endDate: null,
      endTime: null,
    });
    const created = completeDoAttempt([], untimedInput);
    assert.equal(created[0].timing, DO_TIMING.UNTIMED);
    assert.equal(doDurationMinutes(created[0]), null);
  });
});

describe('civil intervals and timing classification', () => {
  for (const [start, end, minutes] of [
    ['2026-09-19 23:40', '2026-09-20 00:20', 40],
    ['2026-12-31 23:40', '2027-01-01 00:20', 40],
    ['2024-02-28 23:40', '2024-02-29 00:20', 40],
    ['2000-02-29 23:40', '2000-03-01 00:20', 40],
    ['1900-02-28 23:40', '1900-03-01 00:20', 40],
    ['0099-12-31 23:40', '0100-01-01 00:20', 40],
    ['2026-09-19 14:30', '2026-09-21 15:10', 2920],
    ['2026-03-08 01:30', '2026-03-08 03:30', 120],
  ]) it(`keeps explicit civil duration ${start} to ${end}`, () => {
    const [date, startTime] = start.split(' '), [endDate, endTime] = end.split(' ');
    assert.equal(doDurationMinutes(record({ date, startTime, endDate, endTime })), minutes);
  });
  it('compares the same Do separately against Original and captured Final Plan', () => {
    const r = freeze(record());
    const original = freeze(plan({ startTime: '09:30', duration: 30 }));
    const first = classifyAgainstPlan(original, [r]);
    const final = classifyAgainstPlan(r.planSnapshot, [r]);
    assert.deepEqual(first.timing, [TIMING.DELAYED, TIMING.OVERRUN]);
    assert.deepEqual(final.timing, [TIMING.WITHIN_PLAN]);
    assert.equal(first.recordedMinutes, 40);
  });
  it('does not age a recorded short execution into delayed', () => {
    const r = freeze(record({ startTime: '09:00', endTime: '09:05' }));
    const anchor = plan({ startTime: '09:00' });
    const during = classifyAgainstPlan(anchor, [r], { now: now('09:05') });
    const after = classifyAgainstPlan(anchor, [r], { now: now('12:00') });
    assert.deepEqual(after, during);
    assert.deepEqual(after.timing, [TIMING.WITHIN_PLAN]);
    assert.equal(after.recordedMinutes, 5);
  });
  it('treats exact plan boundaries as within plan, not delayed/overrun', () => {
    assert.deepEqual(classifyAgainstPlan(plan({ duration: 40 }), [record()]).timing, [TIMING.WITHIN_PLAN]);
  });
  it('delayed means late start OR late end, not a reason for lateness', () => {
    const lateStart = record({ startTime: '14:40' });
    const lateEnd = record({ startTime: '14:00', endTime: '15:40' });
    assert.ok(classifyAgainstPlan(plan(), [lateStart]).timing.includes(TIMING.DELAYED));
    assert.ok(classifyAgainstPlan(plan(), [lateEnd]).timing.includes(TIMING.DELAYED));
  });
  it('overrun can occur with neither start nor end delayed', () => {
    assert.deepEqual(classifyAgainstPlan(plan(), [record({ startTime: '14:00', endTime: '15:10' })]).timing, [TIMING.OVERRUN]);
  });
  it('interrupted is record segmentation, even for adjacent attempts', () => {
    const a = record({ id: 'a', endTime: '15:00' });
    const b = record({ id: 'b', startTime: '15:00', endTime: '15:10' });
    const result = classifyAgainstPlan(plan(), [a, b]);
    assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
  });
  it('counts overlapping time once while excluding gaps', () => {
    const a = record({ id: 'a', endTime: '15:10' });
    const b = record({ id: 'b', endTime: '15:10' });
    const overlap = classifyAgainstPlan(plan(), [a, b]);
    assert.equal(overlap.recordedMinutes, 40);
    assert.deepEqual(overlap.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
    const c = record({ id: 'c', startTime: '16:00', endTime: '16:10' });
    const gap = classifyAgainstPlan(plan(), [a, c]);
    assert.equal(gap.recordedMinutes, 50);
    assert.deepEqual(gap.timing, [TIMING.DELAYED, TIMING.INTERRUPTED]);
  });
  it('unions partial and nested overlaps independently of record order without mutation', () => {
    const records = freeze([
      record({ id: 'a', startTime: '09:00', endTime: '09:40' }),
      record({ id: 'b', startTime: '09:20', endTime: '10:00' }),
      record({ id: 'nested', startTime: '09:25', endTime: '09:30' }),
    ]);
    for (const ordered of [records, [...records].reverse(), [records[1], records[0], records[2]]]) {
      const result = classifyAgainstPlan(plan({ startTime: '09:00' }), ordered);
      assert.equal(result.recordedMinutes, 60);
      assert.equal(result.attemptCount, 3);
      assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
    }
    assert.deepEqual(records.map(({ id }) => id), ['a', 'b', 'nested']);
  });
  it('counts only forty worked minutes when a one-hour span has a twenty-minute gap', () => {
    const records = [
      record({ id: 'a', startTime: '09:00', endTime: '09:20' }),
      record({ id: 'b', startTime: '09:40', endTime: '10:00' }),
    ];
    const result = classifyAgainstPlan(plan({ startTime: '09:00' }), records);
    assert.equal(result.recordedMinutes, 40);
    assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
  });
  it('unions overlaps across midnight using dates as well as clock times', () => {
    const records = [
      record({ id: 'after-midnight', date: '2026-09-20', startTime: '00:00', endDate: '2026-09-20', endTime: '00:30' }),
      record({ id: 'cross-midnight', startTime: '23:50', endDate: '2026-09-20', endTime: '00:10' }),
    ];
    const result = classifyAgainstPlan(plan({ startTime: '23:50', duration: 40 }), records);
    assert.equal(result.recordedMinutes, 40);
    assert.equal(result.attemptCount, 2);
    assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
  });
  it('all three independent deviations may coexist', () => {
    const a = record({ id: 'a', startTime: '14:40', endTime: '15:20' });
    const b = record({ id: 'b', startTime: '16:00', endTime: '16:40' });
    assert.deepEqual(classifyAgainstPlan(plan(), [a, b]).timing, [TIMING.DELAYED, TIMING.OVERRUN, TIMING.INTERRUPTED]);
  });
  it('does not choose the last attempt snapshot as a group baseline', () => {
    const a = record({ id: 'a' });
    const b = record({ id: 'b', startTime: '16:00', endTime: '16:20', planSnapshot: plan({ startTime: '16:00', duration: 30 }) });
    assert.deepEqual(classifyAgainstPlan(b.planSnapshot, [b]).timing, [TIMING.WITHIN_PLAN]);
    assert.deepEqual(classifyAgainstPlan(plan(), [a, b]).timing, [TIMING.DELAYED, TIMING.INTERRUPTED]);
  });
  it('ignores deleted attempts in analysis, not in the persisted collection', () => {
    const a = record(), b = tombstoneDoRecord(record({ id: 'b' }), T2);
    assert.equal(classifyAgainstPlan(plan(), [a, b]).attemptCount, 1);
    assert.equal(classifyAgainstPlan(plan(), [a, b]).recordedMinutes, 40);
    assert.equal(b.deleted, true);
  });
  it('requires duplicate versions to be merged before summing', () => {
    const a = record();
    assert.throws(() => classifyAgainstPlan(plan(), [a, a]), TypeError);
  });
  for (const [time, expected] of [['14:00', []], ['15:00', []], ['15:30', [TIMING.NOT_STARTED]], ['16:00', [TIMING.NOT_STARTED]]]) {
    it(`no-attempt status at ${time} is derived only after the whole plan`, () => {
      const result = classifyAgainstPlan(plan(), [], { now: now(time) });
      assert.deepEqual(result.timing, expected);
      assert.equal(result.attemptCount, 0);
    });
  }
  it('does not use an old baseline to mark a rescheduled future task Not Started', () => {
    const result = classifyAgainstPlan(plan({ startTime: '09:00' }), [], { displayedPlan: plan({ startTime: '18:00' }), now: now('16:00') });
    assert.deepEqual(result.timing, []);
    assert.deepEqual(classifyAgainstPlan(plan(), []).timing, []); // no implicit now
  });
  it('a missing Original Plan anchor is not silently Unplanned', () => {
    const r = record(); // Captured Final Plan is known; Original Plan is unavailable.
    const unknown = classifyAgainstPlan(null, [r]);
    assert.equal(unknown.comparable, false);
    assert.deepEqual(unknown.timing, []);
    assert.equal(unknown.recordedMinutes, 40);
    assert.deepEqual(classifyAgainstPlan(r.planSnapshot, [r]).timing, [TIMING.WITHIN_PLAN]);
  });
  it('an explicitly absent captured Final Plan is known Unplanned', () => {
    const r = record({ planSnapshot: null, taskId: null, source: 'manual' });
    const final = classifyAgainstPlan(r.planSnapshot, [r], { knownUnplanned: r.planSnapshot === null });
    assert.equal(final.comparable, false);
    assert.deepEqual(final.timing, [TIMING.UNPLANNED]);
    assert.equal(final.recordedMinutes, 40);
    assert.throws(() => classifyAgainstPlan(plan(), [r], { knownUnplanned: true }), TypeError);
  });
  it('rejects bad anchors/current plans/now instead of inventing a budget', () => {
    assert.throws(() => classifyAgainstPlan({}, [record()]), TypeError);
    assert.throws(() => classifyAgainstPlan(plan(), [], { displayedPlan: {}, now: now('16:00') }), TypeError);
    assert.throws(() => classifyAgainstPlan(plan(), [], { now: {} }), TypeError);
  });
});

describe('pickJoboRecord: drop-in #1762 callback', () => {
  it('returns an original whole operand, never a fabricated hybrid', () => {
    const a = freeze(record({ title: 'first' }));
    const b = freeze(record({ title: 'second', updatedAt: T2, extra: { keep: 42 } }));
    assert.equal(pickJoboRecord(a, b), b);
    assert.equal(pickJoboRecord(b, a), b);
    assert.equal(b.extra.keep, 42);
  });
  it('prefers newer updatedAt regardless of observedAt', () => {
    const a = record({ observedAt: T0 });
    const b = record({ updatedAt: T2, observedAt: '2030-01-01T00:00:00.000Z' });
    assert.equal(pickJoboRecord(a, b), b);
  });
  it('prefers lower observedAt on an equal version', () => {
    const a = record({ observedAt: T0, title: 'z' });
    const b = record({ observedAt: T2, title: 'a' });
    assert.equal(pickJoboRecord(a, b), a);
    assert.equal(pickJoboRecord(b, a), a);
  });
  it('keeps migration outside the merge rule', () => {
    const canonical = record();
    const legacy = { ...canonical, progress: 'partial' };
    const migrated = migrateLegacyDoRecord(legacy);
    assert.equal(migrated.legacyCompletionStatus, 'partly');
    assert.deepEqual(migrated.record, canonical);
    assert.deepEqual(pickJoboRecord(canonical, migrated.record), canonical);
    assert.deepEqual(pickJoboRecord(migrated.record, canonical), canonical);
  });
  it('compares the nested snapshot on an exact timestamp tie', () => {
    const a = record({ planSnapshot: plan({ duration: 30 }) });
    const b = record({ planSnapshot: plan({ duration: 60 }) });
    assert.equal(pickJoboRecord(a, b), a);
    assert.equal(pickJoboRecord(b, a), a);
  });
  it('canonicalizes nested keys, not only the root key order', () => {
    const a = record({ extra: { z: [{ b: 2, a: 1 }], a: 0 } });
    const b = { ...a, extra: { a: 0, z: [{ a: 1, b: 2 }] }, planSnapshot: { duration: 60, startTime: '14:30', date: '2026-09-19' } };
    assert.deepEqual(pickJoboRecord(a, b), pickJoboRecord(b, a));
    assert.equal(pickJoboRecord(b, b), b);
  });
  it('includes nested arrays and unknown JSON fields in the final tie-break', () => {
    const a = record({ extra: [{ x: 1 }, 2] });
    const b = record({ extra: [{ x: 2 }, 1] });
    assert.equal(pickJoboRecord(a, b), a);
    assert.equal(pickJoboRecord(b, a), a);
  });
  it('supports absent operands and opaque minimal transport rows', () => {
    const a = { id: 'a', updatedAt: T0 }, b = { id: 'a', updatedAt: T2, deleted: true };
    assert.equal(pickJoboRecord(null, a), a);
    assert.equal(pickJoboRecord(a, undefined), a);
    assert.equal(pickJoboRecord(undefined, undefined), undefined);
    assert.equal(pickJoboRecord(a, b), b);
    assert.equal(pickJoboRecord({ id: 'a', updatedAt: 'bad' }, a), a);
    assert.deepEqual(pickJoboRecord({ id: 7 }, { id: '7' }), pickJoboRecord({ id: '7' }, { id: 7 }));
  });
  it('interprets timestamp offsets as instants', () => {
    const a = record({ updatedAt: '2026-09-19T17:10:02+02:00', observedAt: T0 });
    const b = record({ updatedAt: T0, observedAt: T1 });
    assert.equal(pickJoboRecord(a, b), a);
  });
  for (const timezone of ['UTC', 'Asia/Shanghai']) {
    it(`uses timezone-independent legacy timestamp ranks (${timezone})`, () => {
      // A separate process gives each case a real host timezone without changing
      // the Vitest worker's global TZ or relying on the developer's environment.
      const script = `
        import assert from 'node:assert/strict';
        import { pickJoboRecord } from ${JSON.stringify(new URL('./core.js', import.meta.url).href)};
        assert.equal(new Date('2026-09-19T15:10:02').getTimezoneOffset(), ${timezone === 'UTC' ? 0 : -480});
        (${verifyLegacyTimestampRanks.toString()})(pickJoboRecord, assert);
      `;
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10000,
      });
    });
  }
  it('does not resurrect a tombstone on late duplicate observation, at any age', () => {
    const a = record({ createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' });
    const dead = tombstoneDoRecord(a, '2000-01-02T00:00:00.000Z');
    const late = { ...a, observedAt: T2 };
    assert.equal(pickJoboRecord(dead, late), dead);
    assert.equal(pickJoboRecord(late, dead), dead);
  });
  it('rejects unrelated ids rather than merging independent attempts', () => {
    assert.throws(() => pickJoboRecord(record({ id: 'a' }), record({ id: 'b' })), TypeError);
  });
  it('is commutative, associative and idempotent for competing copies', () => {
    const variants = [
      record(), record({ title: 'a' }), record({ observedAt: T0 }),
      record({ planSnapshot: plan({ duration: 30 }) }),
      record({ updatedAt: T1, startTime: '14:40' }),
      record({ updatedAt: T2, deleted: true }), record({ extra: { nested: ['x', 'y'] } }),
    ].map(freeze);
    for (const a of variants) {
      assert.equal(pickJoboRecord(a, a), a);
      for (const b of variants) {
        assert.deepEqual(pickJoboRecord(a, b), pickJoboRecord(b, a));
        for (const c of variants) {
          assert.deepEqual(pickJoboRecord(pickJoboRecord(a, b), c), pickJoboRecord(a, pickJoboRecord(b, c)));
        }
      }
    }
  });
});

// Runs entirely inside the timezone-specific child process above. Neighbours at
// rank - 1 and rank + 1 establish the exact rank without a JSON tie-break hiding
// an incorrectly parsed timestamp. Both operand orders must select the same row.
function verifyLegacyTimestampRanks(pick, assert) {
  const limit = 8640000000000000;
  function assertRank(field, value, rank, label) {
    const candidate = Object.freeze({ id: 'legacy', updatedAt: 100, observedAt: 100, [field]: value });
    for (const neighbourRank of [rank - 1, rank + 1].filter(value => Math.abs(value) <= limit)) {
      const neighbour = Object.freeze({ ...candidate, [field]: neighbourRank });
      const candidateWins = field === 'updatedAt' ? rank > neighbourRank : rank < neighbourRank;
      const expected = candidateWins ? candidate : neighbour;
      assert.equal(pick(candidate, neighbour), expected, `${field}: ${label}; forward`);
      assert.equal(pick(neighbour, candidate), expected, `${field}: ${label}; reversed`);
      assert.equal(candidate[field], value, `${field}: original timestamp retained`);
    }
  }
  const invalid = [
    ['missing', undefined], ['null', null], ['empty', ''], ['invalid text', 'bad'],
    ['offsetless seconds', '2026-09-19T15:10:02'],
    ['offsetless milliseconds', '2026-09-19T15:10:02.000'],
    ['numeric string', '12'], ['date only', '2026-09-19'],
    ['invalid calendar day', '2026-02-30T00:00:00.000Z'],
    ['invalid leap day', '1900-02-29T00:00:00+08:00'],
    ['boolean true', true], ['boolean false', false],
    ['object', Object.freeze({})], ['array', Object.freeze([2026])],
    ['NaN', NaN], ['infinity', Infinity], ['negative infinity', -Infinity],
    ['above Date range', limit + 1], ['below Date range', -limit - 1],
  ];
  const instant = Date.parse('2026-09-19T15:10:02.000Z');
  const valid = [
    ['UTC ISO', '2026-09-19T15:10:02.000Z', instant],
    ['positive offset ISO', '2026-09-19T23:10:02+08:00', instant],
    ['negative offset ISO', '2026-09-19T09:10:02-06:00', instant],
    ['numeric epoch milliseconds', instant, instant], ['zero', 0, 0],
    ['negative epoch milliseconds', -1000, -1000],
    ['fractional milliseconds', 0.75, 0],
    ['maximum Date epoch', limit, limit], ['minimum Date epoch', -limit, -limit],
  ];
  for (const field of ['updatedAt', 'observedAt']) {
    for (const [label, value] of invalid) assertRank(field, value, 0, label);
    for (const [label, value, rank] of valid) assertRank(field, value, rank, label);
  }
}
