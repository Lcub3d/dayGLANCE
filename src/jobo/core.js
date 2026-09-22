// JOBO slice 2: pure record rules. No React, storage, clock or task mutation.
// The caller owns identities, event/observation timestamps and task lookup.
// See docs/jobo-ledger-persistence.md and docs/jobo-core.md.

export const DO_PROGRESS = Object.freeze({
  STARTED: 'started', PARTIAL: 'partial', MOSTLY: 'mostly', COMPLETED: 'completed',
});
export const DO_SOURCES = Object.freeze(['completion', 'manual', 'focus']);
export const TIMING = Object.freeze({
  WITHIN_PLAN: 'withinPlan', DELAYED: 'delayed', OVERRUN: 'overrun',
  INTERRUPTED: 'interrupted', NOT_STARTED: 'notStarted', UNPLANNED: 'unplanned',
});
const progressValues = Object.values(DO_PROGRESS);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const taskIdValid = id => id === null || nonempty(id) || (typeof id === 'number' && Number.isSafeInteger(id));
const editable = new Set(['date', 'startTime', 'endDate', 'endTime', 'progress']);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function validTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function validStamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d):[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return !!match && validDate(match[1]) && Number.isFinite(Date.parse(value));
}

// Civil minutes are coordinates on the planner, NOT measured UTC elapsed time.
// Supplying a Z here avoids the executing device's timezone changing the result.
function civilMinute(date, time) {
  if (!validDate(date) || !validTime(time)) throw new TypeError('Invalid civil date/time');
  const [hour, minute] = time.split(':').map(Number);
  return Date.parse(`${date}T00:00:00.000Z`) / 60000 + hour * 60 + minute;
}
function planBounds(plan) {
  if (!plain(plan) || !validDate(plan.date) || !validTime(plan.startTime)
    || typeof plan.duration !== 'number' || !Number.isFinite(plan.duration) || plan.duration <= 0) {
    throw new TypeError('Invalid timed plan');
  }
  const start = civilMinute(plan.date, plan.startTime);
  const end = start + plan.duration;
  if (!Number.isFinite(end) || end <= start || Math.abs(end) > Number.MAX_SAFE_INTEGER) {
    throw new TypeError('Invalid plan duration');
  }
  return { start, end };
}

/**
 * Canonical JSON for the final tie-break, including ALL nested keys. Arrays
 * retain their order. No localeCompare, top-level replacer whitelist, coercion
 * of undefined/NaN to null, or dependence on property insertion order.
 */
function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if ((!plain(value) && !Array.isArray(value)) || ancestors.has(value)) {
    throw new TypeError('Record must contain only acyclic JSON data');
  }
  ancestors.add(value);
  let text;
  if (Array.isArray(value)) {
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, index)) throw new TypeError('Sparse arrays are not record data');
      entries.push(canonicalJson(value[index], ancestors));
    }
    text = `[${entries.join(',')}]`;
  } else {
    text = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(',')}}`;
  }
  ancestors.delete(value);
  return text;
}
const copy = value => JSON.parse(canonicalJson(value));

/** Validate a complete persisted record; never repair or invent history. */
export function validateDoRecord(record) {
  const errors = [];
  if (!plain(record)) return { ok: false, errors: ['record must be a plain object'] };
  if (!nonempty(record.id)) errors.push('id must be a nonempty string');
  if (!own(record, 'taskId') || !taskIdValid(record.taskId)) errors.push('taskId must be an id or explicit null');
  if (!nonempty(record.title)) errors.push('title must be a nonempty string');
  if (!DO_SOURCES.includes(record.source)) errors.push('invalid source');
  if (!progressValues.includes(record.progress)) errors.push('invalid progress');
  if (typeof record.deleted !== 'boolean') errors.push('deleted must be boolean');
  for (const key of ['createdAt', 'updatedAt', 'observedAt']) {
    if (!validStamp(record[key])) errors.push(`${key} must be an ISO timestamp with an offset`);
  }
  if (validStamp(record.createdAt) && validStamp(record.updatedAt)
    && Date.parse(record.updatedAt) < Date.parse(record.createdAt)) errors.push('updatedAt precedes createdAt');
  // observedAt is a device clock: do not assume it follows the source timestamp.
  try {
    const duration = civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
    // An untimed completion may acknowledge work without inventing its duration.
    // Its equal endpoints are a zero-minute placeholder, not a measured interval.
    const untimedCompletion = record.source === 'completion' && record.planSnapshot === null;
    if (duration < 0 || (duration === 0 && !untimedCompletion)) {
      errors.push('interval must be positive, or zero for an untimed completion');
    }
  } catch { errors.push('invalid interval date/time'); }
  if (!own(record, 'planSnapshot')) errors.push('planSnapshot must be supplied (or explicit null)');
  else if (record.planSnapshot !== null) {
    try { planBounds(record.planSnapshot); } catch { errors.push('invalid planSnapshot'); }
  }
  try { canonicalJson(record); } catch { errors.push('record must be acyclic JSON data'); }
  return { ok: errors.length === 0, errors };
}
function assertRecord(record) {
  const result = validateDoRecord(record);
  if (!result.ok) throw new TypeError(`Invalid Do record: ${result.errors.join('; ')}`);
}

/**
 * Construct the full record supplied by the caller. Only deleted defaults to
 * false. title/planSnapshot and opaque JSON extensions are defensively copied.
 * IDs, progress, event times and observation time must be explicit.
 */
export function createDoRecord(input) {
  if (!plain(input)) throw new TypeError('Record input must be a plain object');
  const record = { ...input, deleted: own(input, 'deleted') ? input.deleted : false };
  assertRecord(record);
  return copy(record);
}

function assertLater(record, updatedAt) {
  if (!validStamp(updatedAt) || Date.parse(updatedAt) <= Date.parse(record.updatedAt)) {
    throw new RangeError('A local edit requires updatedAt later than the previous version');
  }
}

/**
 * An explicit local interval/progress correction. Capture-once fields cannot be
 * patched, even by accident through a spread live task. Never revives tombstones.
 * No-op edits preserve identity and timestamps. The caller supplies edit time.
 */
export function updateDoRecord(record, patch, updatedAt) {
  assertRecord(record);
  if (!plain(patch)) throw new TypeError('Patch must be a plain object');
  for (const key of Object.keys(patch)) {
    if (!editable.has(key)) throw new TypeError(`Cannot edit captured field: ${key}`);
  }
  if (record.deleted) throw new TypeError('Cannot edit a deleted Do record');
  const next = { ...record, ...patch };
  assertRecord(next);
  if (Object.keys(patch).every(key => patch[key] === record[key])) return record;
  assertLater(record, updatedAt);
  return createDoRecord({ ...next, updatedAt });
}

/** An explicit deletion is a newer version, never removal from the collection. */
export function tombstoneDoRecord(record, updatedAt) {
  assertRecord(record);
  if (record.deleted) return record;
  assertLater(record, updatedAt);
  return createDoRecord({ ...record, deleted: true, updatedAt });
}

/**
 * Pure ensure-present for a completion candidate. The caller selects the stable
 * completion key; this is not a detector. Re-observation (including a tombstone)
 * returns the existing collection unchanged before reconstructing anything.
 */
export function completeDoAttempt(records, input) {
  if (!Array.isArray(records) || !plain(input) || !nonempty(input.id)) throw new TypeError('Invalid attempt input');
  if (records.some(record => record.id === input.id)) return records;
  const attempt = createDoRecord({ ...input, source: 'completion', progress: DO_PROGRESS.COMPLETED, deleted: false });
  return [...records, attempt];
}

/** Un-completion preserves an existing non-completed assessment and its version. */
export function reopenDoAttempt(records, previousId, updatedAt) {
  if (!Array.isArray(records) || !nonempty(previousId)) throw new TypeError('Invalid previous attempt key');
  const index = records.findIndex(record => record.id === previousId);
  if (index < 0 || records[index].deleted) return records;
  assertRecord(records[index]);
  if (records[index].progress !== DO_PROGRESS.COMPLETED) return records;
  const record = updateDoRecord(records[index], { progress: DO_PROGRESS.PARTIAL }, updatedAt);
  if (record === records[index]) return records;
  return records.map((item, i) => i === index ? record : item);
}

/** Civil minutes; an untimed completion placeholder contributes zero. */
export function doDurationMinutes(record) {
  assertRecord(record);
  return civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
}

// Count covered civil minutes once. Gaps add nothing; adjacent, nested and
// overlapping attempts remain separate records for the interaction history.
function unionDurationMinutes(records) {
  const intervals = records.map(record => [
    civilMinute(record.date, record.startTime), civilMinute(record.endDate, record.endTime),
  ]).sort(([startA, endA], [startB, endB]) => startA - startB || endA - endB);
  let minutes = 0;
  let coveredEnd = -Infinity;
  for (const [start, end] of intervals) {
    minutes += Math.max(0, end - Math.max(start, coveredEnd));
    coveredEnd = Math.max(coveredEnd, end);
  }
  return minutes;
}

/**
 * Compare a caller-selected set of distinct attempts to ONE explicit anchor.
 * Use separately for Original Plan and for a record's planSnapshot. Never
 * silently select today's task or the last attempt's snapshot for the whole set.
 *
 * No records: only an elapsed CURRENT displayedPlan can be Not Started; no
 * record is fabricated. now is an explicit {date, time} civil coordinate.
 * A missing comparison anchor is unknown unless the caller knows it was unplanned.
 * A persisted planSnapshot === null means there was no timed plan: when comparing
 * that Final Plan, pass knownUnplanned: true. A missing Original Plan is different.
 * Progress stays per attempt; there is no aggregate/native completion inference.
 */
export function classifyAgainstPlan(plan, records, { displayedPlan = plan, now, knownUnplanned = false } = {}) {
  if (!Array.isArray(records)) throw new TypeError('Expected an attempt array');
  if (typeof knownUnplanned !== 'boolean') throw new TypeError('knownUnplanned must be boolean');
  if (plan != null && knownUnplanned) throw new TypeError('A timed plan cannot be known-unplanned');
  const anchor = plan == null ? null : planBounds(plan);
  const current = displayedPlan == null ? null : planBounds(displayedPlan);
  const nowMinute = now === undefined ? null : civilMinute(now?.date, now?.time);
  const ids = new Set();
  const attempts = [];
  for (const record of records) {
    assertRecord(record);
    if (ids.has(record.id)) throw new TypeError('Merge duplicate record ids before classification');
    ids.add(record.id);
    if (!record.deleted) attempts.push(record);
  }
  const timing = [];
  const timedAttempts = attempts.filter(record => doDurationMinutes(record) > 0);
  const recordedMinutes = unionDurationMinutes(timedAttempts);
  if (!attempts.length) {
    if (current && nowMinute !== null && nowMinute >= current.end) timing.push(TIMING.NOT_STARTED);
  } else if (!anchor) {
    if (knownUnplanned) timing.push(TIMING.UNPLANNED);
  } else if (timedAttempts.length) {
    let firstStart = Infinity;
    let lastEnd = -Infinity;
    for (const record of timedAttempts) {
      firstStart = Math.min(firstStart, civilMinute(record.date, record.startTime));
      lastEnd = Math.max(lastEnd, civilMinute(record.endDate, record.endTime));
    }
    if (firstStart > anchor.start || lastEnd > anchor.end) timing.push(TIMING.DELAYED);
    if (recordedMinutes > plan.duration) timing.push(TIMING.OVERRUN);
    if (!timing.length) timing.push(TIMING.WITHIN_PLAN);
  }
  if (attempts.length >= 2) timing.push(TIMING.INTERRUPTED);
  return {
    timing, comparable: anchor !== null, recordedMinutes, attemptCount: attempts.length,
    progress: attempts.map(({ id, progress }) => ({ id, progress })),
  };
}

// Compatibility with #1762's opaque transport rows and timestamp-less legacy
// fixtures: a missing/invalid timestamp has the same epoch-zero rank as its
// stand-in. Accept explicit-offset ISO strings or numeric epoch milliseconds,
// never host-local date strings or coercible objects. Preserve the original row;
// this is a comparison rank, not history repair. NEW full records require ISO.
function versionTime(value) {
  const time = typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).getTime()
    : validStamp(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Drop-in pick for createLedger({ store, pick: pickJoboRecord }) and
 * useJoboLedger({ pickRecord: pickJoboRecord }). Return a whole original operand,
 * including opaque fields/tombstones, without mutation, restamping or pruning.
 */
export function pickJoboRecord(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  if (!plain(a) || !plain(b) || a.id == null || b.id == null || String(a.id) !== String(b.id)) {
    throw new TypeError('pickJoboRecord requires two copies of the same id');
  }
  const ua = versionTime(a.updatedAt), ub = versionTime(b.updatedAt);
  if (ua !== ub) return ua > ub ? a : b;
  const oa = versionTime(a.observedAt), ob = versionTime(b.observedAt);
  if (oa !== ob) return oa < ob ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}
