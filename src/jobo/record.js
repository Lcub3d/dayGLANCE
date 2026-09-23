// JOBO Do-record contract, lifecycle and legacy migration.
// Public consumers import through core.js.

import { own, plain, nonempty, canonicalJson, copy } from './internal/json.js';
import {
  validDate,
  validStamp,
  civilMinute,
  planBounds,
  timedRecordDurationMinutes,
} from './intervals.js';

export const DO_SOURCES = Object.freeze(['completion', 'manual', 'focus']);

export const DO_TIMING = Object.freeze({
  TIMED: 'timed',
  UNTIMED: 'untimed',
});

// Shared completion vocabulary used by the current Slice 2 proposal.
// Module placement does not settle persistence ownership.
export const COMPLETION_STATUS = Object.freeze({
  STARTED: 'started',
  PARTLY: 'partly',
  MOSTLY: 'mostly',
  COMPLETED: 'completed',
});

export const COMPLETION_STATUS_ORDER = Object.freeze([
  COMPLETION_STATUS.STARTED,
  COMPLETION_STATUS.PARTLY,
  COMPLETION_STATUS.MOSTLY,
  COMPLETION_STATUS.COMPLETED,
]);

const taskIdValid = id => id === null || nonempty(id) || (typeof id === 'number' && Number.isSafeInteger(id));
const editable = new Set(['timing', 'date', 'startTime', 'endDate', 'endTime']);

export function validateDoRecord(record) {
  const errors = [];
  if (!plain(record)) return { ok: false, errors: ['record must be a plain object'] };
  if (!nonempty(record.id)) errors.push('id must be a nonempty string');
  if (!own(record, 'taskId') || !taskIdValid(record.taskId)) errors.push('taskId must be an id or explicit null');
  if (!nonempty(record.title)) errors.push('title must be a nonempty string');
  if (!DO_SOURCES.includes(record.source)) errors.push('invalid source');
  if (own(record, 'progress')) errors.push('progress belongs to Plan completion, not Do record');
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
    if (plain(record.planSnapshot) && own(record.planSnapshot, 'completionStatus')) {
      errors.push('planSnapshot must not capture Plan completion');
    }
  }
  try { canonicalJson(record); } catch { errors.push('record must be acyclic JSON data'); }
  return { ok: errors.length === 0, errors };
}

export function assertRecord(record) {
  const result = validateDoRecord(record);
  if (!result.ok) throw new TypeError(`Invalid Do record: ${result.errors.join('; ')}`);
}

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

export function tombstoneDoRecord(record, updatedAt) {
  assertRecord(record);
  if (record.deleted) return record;
  assertLater(record, updatedAt);
  return createDoRecord({ ...record, deleted: true, updatedAt });
}

export function completeDoAttempt(records, input) {
  if (!Array.isArray(records) || !plain(input) || !nonempty(input.id)) throw new TypeError('Invalid attempt input');
  if (records.some(record => record.id === input.id)) return records;
  const attempt = createDoRecord({ ...input, source: 'completion', deleted: false });
  return [...records, attempt];
}

export function doDurationMinutes(record) {
  assertRecord(record);
  if (record.timing === DO_TIMING.UNTIMED) return null;
  return timedRecordDurationMinutes(record);
}

const LEGACY_PROGRESS_TO_COMPLETION = Object.freeze({
  started: COMPLETION_STATUS.STARTED,
  partial: COMPLETION_STATUS.PARTLY,
  partly: COMPLETION_STATUS.PARTLY,
  mostly: COMPLETION_STATUS.MOSTLY,
  completed: COMPLETION_STATUS.COMPLETED,
  complete: COMPLETION_STATUS.COMPLETED,
});

export function migrateLegacyDoRecord(record) {
  if (!plain(record)) throw new TypeError('Legacy Do record must be a plain object');
  const hasProgress = own(record, 'progress');
  let legacyCompletionStatus = null;
  if (hasProgress) {
    legacyCompletionStatus = LEGACY_PROGRESS_TO_COMPLETION[record.progress];
    if (!legacyCompletionStatus) throw new TypeError('Unknown legacy Do progress');
  }

  const migrated = { ...record };
  delete migrated.progress;

  // Pre-discriminant rows are normalized here, before canonical merge.
  if (!own(migrated, 'timing')) {
    try {
      const duration = civilMinute(migrated.endDate, migrated.endTime)
        - civilMinute(migrated.date, migrated.startTime);
      if (duration > 0) {
        migrated.timing = DO_TIMING.TIMED;
      } else if (duration === 0 && migrated.source === 'completion') {
        migrated.timing = DO_TIMING.UNTIMED;
        migrated.startTime = null;
        migrated.endDate = null;
        migrated.endTime = null;
      }
    } catch {
      // createDoRecord below remains the strict validation boundary.
    }
  }

  return {
    record: createDoRecord(migrated),
    legacyCompletionStatus,
  };
}
