// JOBO Do-record schema and lifecycle. Public access is via core.js.

import { own, plain, nonempty, canonicalJson, copy } from './internal/json.js';
import { validDate, validStamp, civilMinute, planBounds } from './internal/civilTime.js';

export const DO_SOURCES = Object.freeze(['completion', 'manual', 'focus']);
export const DO_TIMING = Object.freeze({
  TIMED: 'timed',
  UNTIMED: 'untimed',
});
export const DO_PROGRESS = Object.freeze({
  STARTED: 'started',
  PARTIAL: 'partial',
  MOSTLY: 'mostly',
  COMPLETED: 'completed',
});
const taskIdValid = id => id === null || nonempty(id) || (typeof id === 'number' && Number.isSafeInteger(id));
const progressValues = Object.values(DO_PROGRESS);
const editable = new Set(['timing', 'date', 'startTime', 'endDate', 'endTime']);

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
  if (!validDate(record.date)) errors.push('date must be a real Gregorian YYYY-MM-DD');
  if (!Object.values(DO_TIMING).includes(record.timing)) {
    errors.push('timing must be timed or untimed');
  } else if (record.timing === DO_TIMING.TIMED) {
    try {
      const duration = civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
      if (duration <= 0) errors.push('timed interval must be positive');
    } catch { errors.push('invalid timed interval date/time'); }
  } else {
    if (record.startTime !== null || record.endDate !== null || record.endTime !== null) {
      errors.push('untimed Do must use null startTime/endDate/endTime');
    }
  }
  if (!own(record, 'planSnapshot')) errors.push('planSnapshot must be supplied (or explicit null)');
  else if (record.planSnapshot !== null) {
    try { planBounds(record.planSnapshot); } catch { errors.push('invalid planSnapshot'); }
  }
  try { canonicalJson(record); } catch { errors.push('record must be acyclic JSON data'); }
  return { ok: errors.length === 0, errors };
}
export function assertRecord(record) {
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
 * An explicit local interval correction. Capture-once fields cannot be
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
  const attempt = createDoRecord({
    ...input,
    source: 'completion',
    progress: DO_PROGRESS.COMPLETED,
    deleted: false,
  });
  return [...records, attempt];
}

/**
 * Reassess one existing Do attempt without changing its interval or captured
 * history. Completed is created by completeDoAttempt; reassessment uses the
 * other three progress values.
 */
export function reassessDoProgress(record, progress, updatedAt) {
  assertRecord(record);
  if (record.deleted) throw new TypeError('Cannot reassess a deleted Do record');
  if (![DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY].includes(progress)) {
    throw new TypeError('Progress reassessment must be started, partial, or mostly');
  }
  if (record.progress === progress) return record;
  assertLater(record, updatedAt);
  return createDoRecord({ ...record, progress, updatedAt });
}

/** Civil minutes of one timed execution interval; null means deliberately untimed. */
export function doDurationMinutes(record) {
  assertRecord(record);
  if (record.timing === DO_TIMING.UNTIMED) return null;
  return civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
}

