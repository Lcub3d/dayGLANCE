import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  DO_PROGRESS, DO_SOURCES, TIMING, createDoRecord, validateDoRecord,
  updateDoRecord, tombstoneDoRecord, completeDoAttempt, reopenDoAttempt,
  doDurationMinutes, classifyAgainstPlan, pickJoboRecord,
} from './core.js';

const T0 = '2026-09-19T15:10:02.000Z';
const T1 = '2026-09-19T15:11:02.000Z';
const T2 = '2026-09-19T16:10:02.000Z';
const plan = (patch = {}) => ({ date: '2026-09-19', startTime: '14:30', duration: 60, ...patch });
const input = (patch = {}) => ({
  id: 'do:t1:2026-09-19T15:10:02.000Z', taskId: 't1',
  date: '2026-09-19', startTime: '14:30', endDate: '2026-09-19', endTime: '15:10',
  title: 'Draft the report', planSnapshot: plan(), source: 'completion',
  progress: DO_PROGRESS.COMPLETED, createdAt: T0, updatedAt: T0, observedAt: T1,
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
    for (const key of ['id', 'taskId', 'title', 'planSnapshot', 'source', 'progress', 'createdAt', 'updatedAt', 'observedAt', 'endDate']) {
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
  it('keeps explicit unlinked/untimed manual entries', () => {
    const r = record({ taskId: null, planSnapshot: null, source: 'manual', progress: DO_PROGRESS.STARTED });
    assert.equal(r.taskId, null);
    assert.equal(r.planSnapshot, null);
    assert.equal(r.progress, 'started');
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
  for (const progress of Object.values(DO_PROGRESS)) {
    it(`serializes ${progress} without inventing a task percentage`, () => {
      const r = record({ progress });
      assert.equal(r.progress, progress);
      assert.equal(ownKey(r, 'completionPercent'), false);
    });
  }
  for (const source of DO_SOURCES) it(`accepts the documented ${source} source`, () => assert.equal(record({ source }).source, source));
  const invalid = [
    ['empty id', { id: '' }], ['blank title', { title: '  ' }],
    ['missing task id', { taskId: undefined }], ['object task id', { taskId: {} }],
    ['unsafe numeric task id', { taskId: Number.MAX_SAFE_INTEGER + 1 }],
    ['unknown progress', { progress: 'notStarted' }], ['legacy progress not silently migrated', { progress: 'complete' }],
    ['unknown source', { source: 'automatic-magic' }], ['nonboolean deletion', { deleted: 1 }],
    ['bad day', { date: '2026-02-30' }], ['bad leap day', { date: '1900-02-29' }],
    ['zero year', { date: '0000-01-01' }], ['noncanonical date', { date: '2026-9-19' }],
    ['24:00 must use next endDate', { endTime: '24:00' }], ['un-padded clock', { startTime: '9:00' }],
    ['zero interval', { endTime: '14:30' }], ['backwards interval', { endTime: '14:00' }],
    ['bad endDate', { endDate: '2026-09-18' }],
    ['missing snapshot', { planSnapshot: undefined }], ['bad snapshot duration', { planSnapshot: plan({ duration: 0 }) }],
    ['string snapshot duration', { planSnapshot: plan({ duration: '60' }) }],
    ['invalid snapshot date', { planSnapshot: plan({ date: '2026-02-30' }) }],
    ['NaN snapshot', { planSnapshot: plan({ duration: NaN }) }],
    ['timezone-less stamp', { createdAt: '2026-09-19T15:10:02' }],
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

describe('local corrections and tombstones', () => {
  it('corrects interval and progress without refreshing captured history', () => {
    const original = freeze(record({ extra: { retained: true } }));
    const changed = updateDoRecord(original, { startTime: '14:40', endTime: '15:20', progress: DO_PROGRESS.PARTIAL }, T2);
    assert.equal(changed.startTime, '14:40');
    assert.equal(changed.progress, DO_PROGRESS.PARTIAL);
    for (const key of ['id', 'taskId', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt', 'extra']) {
      assert.deepEqual(changed[key], original[key], key);
    }
    assert.equal(original.progress, DO_PROGRESS.COMPLETED);
    assert.equal(changed.updatedAt, T2);
  });
  for (const key of ['id', 'taskId', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt', 'updatedAt', 'deleted', 'extra']) {
    it(`does not accept ${key} in an edit patch`, () => assert.throws(() => updateDoRecord(record(), { [key]: input()[key] }, T2), TypeError));
  }
  for (const stamp of [undefined, T0, '2020-01-01T00:00:00.000Z', 'bad']) {
    it(`requires a strictly newer supplied edit version (${stamp})`, () => {
      assert.throws(() => updateDoRecord(record(), { progress: DO_PROGRESS.PARTIAL }, stamp), RangeError);
      assert.throws(() => tombstoneDoRecord(record(), stamp), RangeError);
    });
  }
  it('keeps no-op identity and does not bump timestamps', () => {
    const r = record();
    assert.equal(updateDoRecord(r, {}, undefined), r);
    assert.equal(updateDoRecord(r, { progress: DO_PROGRESS.COMPLETED }, T2), r);
  });
  it('validates the whole corrected interval, including a moved endDate', () => {
    const r = record();
    assert.throws(() => updateDoRecord(r, { endTime: '00:10' }, T2), TypeError);
    const changed = updateDoRecord(r, { startTime: '23:50', endDate: '2026-09-20', endTime: '00:10' }, T2);
    assert.equal(doDurationMinutes(changed), 20);
  });
  it('never turns a deletion into removal or a subsequent edit into revival', () => {
    const r = record();
    const deleted = tombstoneDoRecord(r, T2);
    assert.deepEqual(deleted, { ...r, deleted: true, updatedAt: T2 });
    assert.equal(tombstoneDoRecord(deleted, 'bad'), deleted);
    assert.throws(() => updateDoRecord(deleted, { progress: DO_PROGRESS.STARTED }, T2), TypeError);
  });
});

describe('explicit attempt transitions (not a task detector)', () => {
  for (const kind of ['ordinary', 'recurring', 'legacy-recurring']) {
    it(`${kind}: complete, reopen, re-complete, late duplicate`, () => {
      const id1 = kind === 'ordinary' ? `do:t1:${T0}` : kind === 'recurring' ? `do:r1:2026-09-19:${T0}` : 'do:r1:2026-09-19';
      const id2 = kind === 'ordinary' ? `do:t1:${T2}` : `do:r1:2026-09-19:${T2}`;
      const firstInput = freeze(input({ id: id1 }));
      const first = freeze(completeDoAttempt([], firstInput));
      assert.equal(first.length, 1);
      assert.equal(first[0].progress, DO_PROGRESS.COMPLETED);
      const reopened = freeze(reopenDoAttempt(first, id1, T1));
      assert.equal(reopened[0].progress, DO_PROGRESS.PARTIAL);
      assert.deepEqual(reopened[0].planSnapshot, first[0].planSnapshot);
      assert.equal(reopened[0].startTime, first[0].startTime);
      const both = completeDoAttempt(reopened, input({ id: id2, createdAt: T2, updatedAt: T2, observedAt: T2 }));
      assert.equal(both.length, 2);
      assert.equal(both[0], reopened[0]);
      assert.equal(both[1].progress, DO_PROGRESS.COMPLETED);
      assert.equal(completeDoAttempt(both, { id: id1 }), both);
      assert.equal(pickJoboRecord(both[0], first[0]), both[0]);
      assert.equal(pickJoboRecord(first[0], both[0]), both[0]);
      assert.equal(first[0].progress, DO_PROGRESS.COMPLETED);
    });
  }
  it('a replay never refreshes snapshots or revives a deleted attempt', () => {
    const gone = tombstoneDoRecord(record(), T2);
    const records = freeze([gone]);
    assert.equal(completeDoAttempt(records, input({ title: 'New task title', planSnapshot: plan({ duration: 10 }), updatedAt: T2 })), records);
    assert.equal(reopenDoAttempt(records, gone.id, T2), records);
  });
  it('does not invent a missing previous attempt on uncomplete', () => {
    const records = [record()];
    assert.equal(reopenDoAttempt(records, 'missing', T2), records);
  });
  it('an already-partial uncomplete is a no-op', () => {
    const records = [record({ progress: DO_PROGRESS.PARTIAL })];
    assert.equal(reopenDoAttempt(records, records[0].id, undefined), records);
  });
  it('creation does not mutate the supplied task-like input or collection', () => {
    const r = freeze(input({ progress: DO_PROGRESS.STARTED }));
    const items = freeze([]);
    const created = completeDoAttempt(items, r);
    assert.equal(created[0].progress, DO_PROGRESS.COMPLETED);
    assert.equal(r.progress, DO_PROGRESS.STARTED);
    assert.equal(items.length, 0);
  });
});

describe('civil intervals and independent timing/progress', () => {
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
    assert.deepEqual(first.progress, [{ id: r.id, progress: DO_PROGRESS.COMPLETED }]);
  });
  for (const progress of Object.values(DO_PROGRESS)) it(`timing never implies progress (${progress})`, () => {
    const r = record({ progress });
    const result = classifyAgainstPlan(plan(), [r]);
    assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN]);
    assert.equal(result.progress[0].progress, progress);
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
    const a = record({ id: 'a', endTime: '15:00', progress: DO_PROGRESS.PARTIAL });
    const b = record({ id: 'b', startTime: '15:00', endTime: '15:10' });
    const result = classifyAgainstPlan(plan(), [a, b]);
    assert.deepEqual(result.timing, [TIMING.WITHIN_PLAN, TIMING.INTERRUPTED]);
    assert.deepEqual(result.progress, [{ id: 'a', progress: DO_PROGRESS.PARTIAL }, { id: 'b', progress: DO_PROGRESS.COMPLETED }]);
  });
  it('sums recorded intervals, excluding gaps but not deduplicating overlaps', () => {
    const a = record({ id: 'a', endTime: '15:10' });
    const b = record({ id: 'b', endTime: '15:10' });
    const overlap = classifyAgainstPlan(plan(), [a, b]);
    assert.equal(overlap.recordedMinutes, 80);
    assert.deepEqual(overlap.timing, [TIMING.OVERRUN, TIMING.INTERRUPTED]);
    const c = record({ id: 'c', startTime: '16:00', endTime: '16:10' });
    const gap = classifyAgainstPlan(plan(), [a, c]);
    assert.equal(gap.recordedMinutes, 50);
    assert.deepEqual(gap.timing, [TIMING.DELAYED, TIMING.INTERRUPTED]);
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
      assert.deepEqual(result.progress, []);
    });
  }
  it('does not use an old baseline to mark a rescheduled future task Not Started', () => {
    const result = classifyAgainstPlan(plan({ startTime: '09:00' }), [], { displayedPlan: plan({ startTime: '18:00' }), now: now('16:00') });
    assert.deepEqual(result.timing, []);
    assert.deepEqual(classifyAgainstPlan(plan(), []).timing, []); // no implicit now
  });
  it('unknown plan history is not silently Unplanned', () => {
    const r = record({ planSnapshot: null, taskId: null, source: 'manual' });
    const unknown = classifyAgainstPlan(null, [r]);
    assert.equal(unknown.comparable, false);
    assert.deepEqual(unknown.timing, []);
    assert.equal(unknown.recordedMinutes, 40);
    assert.deepEqual(classifyAgainstPlan(null, [r], { knownUnplanned: true }).timing, [TIMING.UNPLANNED]);
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
      record({ updatedAt: T1, progress: DO_PROGRESS.PARTIAL }),
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
