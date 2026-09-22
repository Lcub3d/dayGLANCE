import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoRecord, updateDoRecord, validateDoRecord } from '../src/jobo/core.js';
import {
  createCaptureSafeDoRecord as create,
  upgradeCaptureSafeDoRecord as upgrade,
  mergeCaptureSafeDoRecords as merge,
  updateCaptureSafeDoRecord as update,
  tombstoneCaptureSafeDoRecord as remove,
} from '../src/jobo/captureMerge.js';

const stamp = time => `2026-09-22T${time}:00.000Z`;
const input = (overrides = {}) => ({
  id: 'do:t1:completion-1', taskId: 't1', title: 'Original title',
  date: '2026-09-22', startTime: '09:00', endDate: '2026-09-22', endTime: '10:00',
  planSnapshot: { date: '2026-09-22', startTime: '09:00', duration: 60 },
  source: 'completion', progress: 'completed', deleted: false,
  createdAt: stamp('10:00'), updatedAt: stamp('10:00'), observedAt: stamp('10:01'),
  opaqueExtension: { nested: { sequence: [3, 2, 1], detail: 'keep' } },
  ...overrides,
});
const permutations = values => values.length <= 1 ? [values] : values.flatMap(
  (value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]),
);
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('offline later observer edit preserves earliest capture and latest correction', () => {
  const a = create(input());
  const b = create(input({ title: 'Renamed after completion', observedAt: stamp('12:00'),
    planSnapshot: { date: '2026-09-22', startTime: '14:00', duration: 30 } }));
  const edited = update(b, { endTime: '10:15', progress: 'mostly' }, stamp('13:00'));
  const result = merge(a, edited);
  assert.equal(result.title, a.title);
  assert.deepEqual(result.planSnapshot, a.planSnapshot);
  assert.equal(result.observedAt, a.observedAt);
  assert.equal(result.endTime, '10:15');
  assert.equal(result.progress, 'mostly');
  assert.equal(result.updatedAt, stamp('13:00'));
  assert.equal(result._joboMerge.revisionObservedAt, b.observedAt);
  assert.deepEqual(merge(edited, a), result);
  assert.equal(validateDoRecord(result).ok, true);
});

test('composite tie trap retains ORIGINAL revision observation in every grouping', () => {
  const a = create(input());
  const b = create(input({ observedAt: stamp('10:03'), updatedAt: stamp('13:00'), progress: 'mostly' }));
  const c = create(input({ observedAt: stamp('10:02'), updatedAt: stamp('13:00'), progress: 'partial' }));
  const expected = merge(merge(a, b), c);
  assert.equal(expected.progress, 'partial');
  assert.equal(expected.observedAt, a.observedAt);
  assert.equal(expected._joboMerge.revisionObservedAt, c.observedAt);
  for (const [x, y, z] of permutations([a, b, c])) {
    assert.deepEqual(merge(merge(x, y), z), expected);
    assert.deepEqual(merge(x, merge(y, z)), expected);
  }
});

test('complete tie uses independent capture/revision keys; all orders converge', () => {
  const rows = ['Zulu', 'Alpha', 'Beta'].map((title, i) => create(input({ title,
    progress: ['mostly', 'partial', 'started'][i], opaqueExtension: { value: i },
  })));
  const expected = rows.reduce(merge);
  for (const [a, b, c] of permutations(rows)) {
    assert.deepEqual(merge(merge(a, b), c), expected);
    assert.deepEqual(merge(a, merge(b, c)), expected);
  }
  assert.equal(expected.title, 'Alpha');
});

test('new local edit and tombstone after composite keep both lineages', () => {
  const a = create(input());
  const b = create(input({ observedAt: stamp('12:00'), title: 'Late title' }));
  const latest = update(b, { endTime: '10:15' }, stamp('13:00'));
  const composite = merge(a, latest);
  const changed = update(composite, { progress: 'partial' }, stamp('14:00'));
  assert.equal(changed.title, a.title);
  assert.equal(changed._joboMerge.revisionObservedAt, b.observedAt);
  assert.deepEqual(merge(changed, latest), changed);
  const tombstone = remove(changed, stamp('15:00'));
  assert.equal(merge(tombstone, latest).deleted, true);
  assert.equal(merge(tombstone, a).title, a.title);
  assert.throws(() => update(tombstone, { progress: 'started' }, stamp('16:00')), /deleted/);
  assert.deepEqual(remove(tombstone, stamp('16:00')), tombstone);
});

test('opaque revision fields remain atomic and inputs remain untouched', () => {
  const a = deepFreeze(create(input()));
  const b = deepFreeze(create(input({ observedAt: stamp('12:00'), updatedAt: stamp('13:00'),
    title: 'Late', opaqueExtension: { nested: { chosen: true } }, extra: [1, { two: 2 }] })));
  const aBefore = JSON.stringify(a), bBefore = JSON.stringify(b);
  const result = merge(a, b);
  assert.deepEqual(result.opaqueExtension, b.opaqueExtension);
  assert.deepEqual(result.extra, b.extra);
  result.planSnapshot.duration = 20;
  result.opaqueExtension.nested.chosen = false;
  assert.equal(JSON.stringify(a), aBefore);
  assert.equal(JSON.stringify(b), bBefore);
});

test('opaque own __proto__ key survives split, merge and edits as JSON data', () => {
  const extra = JSON.parse('{"__proto__":{"ordinary":"extension"}}');
  const a = create({ ...input(), ...extra });
  const b = create(input({ observedAt: stamp('12:00') }));
  const result = update(merge(a, b), { progress: 'partial' }, stamp('13:00'));
  assert.equal(Object.prototype.hasOwnProperty.call(result, '__proto__'), true);
  assert.deepEqual(result.__proto__, { ordinary: 'extension' });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

test('unwrapped edits or malformed metadata are rejected, never silently re-ranked', () => {
  const a = create(input());
  const stale = updateDoRecord(a, { progress: 'partial' }, stamp('13:00'));
  assert.throws(() => merge(a, stale), /stale/);
  assert.throws(() => upgrade({ ...a, _joboMerge: { ...a._joboMerge, revisionObservedAt: 'local time' } }), /metadata/);
  assert.throws(() => upgrade({ ...a, _joboMerge: { ...a._joboMerge, version: 3 } }), /metadata/);
  assert.throws(() => upgrade({ ...a, _joboMerge: { ...a._joboMerge, extra: true } }), /metadata/);
  assert.throws(() => create({ ...input(), _joboMerge: {} }), /reserved/);
});

test('full legacy rows upgrade deterministically; partial transports are rejected', () => {
  const legacy = createDoRecord(input());
  const upgraded = upgrade(legacy);
  assert.deepEqual(upgrade(upgraded), upgraded);
  assert.deepEqual(merge(legacy, legacy), upgraded);
  assert.deepEqual(merge(null, legacy), upgraded);
  assert.equal(merge(null, null), null);
  assert.throws(() => merge({ id: legacy.id }, legacy), /Invalid Do record/);
  assert.throws(() => merge(upgraded, create(input({ id: 'other' }))), /same Do id/);
  assert.equal(legacy._joboMerge, undefined);
});

test('different createdAt values cannot produce invalid chronology', () => {
  const earliestCapture = create(input({ createdAt: stamp('12:00'), updatedAt: stamp('12:00'), observedAt: stamp('09:00') }));
  const newestRevision = create(input({ createdAt: stamp('10:00'), updatedAt: stamp('13:00'), observedAt: stamp('10:00') }));
  const result = merge(earliestCapture, newestRevision);
  assert.equal(result.createdAt, stamp('12:00'));
  assert.equal(result.updatedAt, stamp('13:00'));
  assert.equal(validateDoRecord(result).ok, true);
});

test('equivalent ISO offsets and nested insertion orders have stable ties', () => {
  const a = create(input({ observedAt: '2026-09-22T18:01:00+08:00', opaqueExtension: { b: 2, a: { d: 4, c: 3 } } }));
  const b = create(input({ opaqueExtension: { a: { c: 3, d: 4 }, b: 2 } }));
  const c = create(input({ observedAt: '2026-09-22T10:01:00Z' }));
  const expected = [a, b, c].reduce(merge);
  for (const [x, y, z] of permutations([a, b, c])) {
    assert.deepEqual(merge(merge(x, y), z), expected);
    assert.deepEqual(merge(x, merge(y, z)), expected);
  }
});

test('finite matrix checks commutativity, associativity and normalized idempotence', () => {
  const rows = [0, 1, 2, 3].flatMap(i => [false, true].map(deleted => create(input({
    title: `Capture ${3 - i}`, observedAt: stamp(`10:0${i + 1}`),
    updatedAt: stamp(i < 2 ? '12:00' : '13:00'), progress: i % 2 ? 'partial' : 'mostly',
    deleted, opaqueExtension: { i },
  }))));
  for (const a of rows) {
    assert.deepEqual(merge(a, a), a);
    for (const b of rows) {
      assert.deepEqual(merge(a, b), merge(b, a));
      for (const c of rows) assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)));
    }
  }
});
