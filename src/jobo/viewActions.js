// JOBO view-side data adapters.
//
// The view owns gestures and form state; this module owns the translation from
// those gestures into canonical Slice 2 records.  It deliberately does not
// read a clock, task store, or a second persistence layer.  Callers supply
// `now` and commit the returned record through the JOBO ledger writer.

import {
  DO_PROGRESS,
  DO_TIMING,
  createDoRecord,
  doDurationMinutes,
  reassessDoProgress,
  tombstoneDoRecord,
  updateDoRecord,
} from './core.js';
import { resolveEditableDoRecord } from './viewModel.js';

const DAY_MINUTES = 24 * 60;
const MIN_INTERVAL_MINUTES = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EDITABLE_PROGRESS = Object.freeze([
  DO_PROGRESS.STARTED,
  DO_PROGRESS.PARTIAL,
  DO_PROGRESS.MOSTLY,
]);
const EDITABLE_FIELDS = new Set(['timing', 'date', 'startTime', 'endDate', 'endTime']);
const DROP_SNAP_MINUTES = 5;

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function validTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

function dayNumber(date) {
  if (!validDate(date)) throw new TypeError('Invalid civil date');
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time)) throw new RangeError('Civil date is outside the supported range');
  return time / 86400000;
}

function civilMinute(date, time) {
  if (!validDate(date) || !validTime(time)) throw new TypeError('Invalid civil date/time');
  const [hour, minute] = time.split(':').map(Number);
  return dayNumber(date) * DAY_MINUTES + hour * 60 + minute;
}

function asWholeMinutes(value, name, { minimum, allowNegative = false } = {}) {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)
    || (minimum !== undefined && value < minimum)) {
    throw new TypeError(`${name} must be a whole number of minutes`);
  }
  return value;
}

function snappedMinute(value, name = 'minute') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number of minutes`);
  }
  return Math.round(value / DROP_SNAP_MINUTES) * DROP_SNAP_MINUTES;
}

function clampedDayMinute(value) {
  return Math.max(0, Math.min(DAY_MINUTES - 1, value));
}

function dateTimeFromAbsolute(minute) {
  if (!Number.isSafeInteger(minute)) throw new RangeError('Interval is outside the supported date range');
  const day = Math.floor(minute / DAY_MINUTES);
  const minuteOfDay = minute - day * DAY_MINUTES;
  const date = new Date(day * 86400000);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Interval is outside the supported date range');
  const isoDate = date.toISOString().slice(0, 10);
  if (!validDate(isoDate)) throw new RangeError('Interval is outside the supported date range');
  return { date: isoDate, minute: minuteOfDay };
}

function timeFromMinute(minute) {
  if (!Number.isSafeInteger(minute) || minute < 0 || minute >= DAY_MINUTES) {
    throw new RangeError('Invalid minute of day');
  }
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function intervalPatchFromBounds(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
    throw new RangeError('Timed interval must be positive');
  }
  const startValue = dateTimeFromAbsolute(start);
  const endValue = dateTimeFromAbsolute(end);
  return {
    timing: DO_TIMING.TIMED,
    date: startValue.date,
    startTime: timeFromMinute(startValue.minute),
    endDate: endValue.date,
    endTime: timeFromMinute(endValue.minute),
  };
}

function visibleIntervalOnDate(interval, date) {
  if (!interval || !validDate(date)) return null;
  const start = civilMinute(interval.date, interval.startTime);
  const end = civilMinute(interval.endDate, interval.endTime);
  const dayStart = dayNumber(date) * DAY_MINUTES;
  const dayEnd = dayStart + DAY_MINUTES;
  const visibleStart = Math.max(start, dayStart);
  const visibleEnd = Math.min(end, dayEnd);
  if (visibleEnd <= visibleStart) return null;
  return {
    startMinute: visibleStart - dayStart,
    endMinute: visibleEnd - dayStart,
    durationMinutes: visibleEnd - visibleStart,
    clippedStart: start < dayStart,
    clippedEnd: end > dayEnd,
  };
}

function ensureTimedRecord(record) {
  if (!record || record.timing !== DO_TIMING.TIMED) {
    throw new TypeError('A timed Do record is required');
  }
  const duration = doDurationMinutes(record);
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new RangeError('Timed Do duration must be a positive whole number of minutes');
  }
  return {
    start: civilMinute(record.date, record.startTime),
    end: civilMinute(record.endDate, record.endTime),
    duration,
  };
}

function stampFromEpoch(now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('now must be an epoch millisecond number');
  }
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('now is outside the supported date range');
  return date.toISOString();
}

function monotonicEpoch(record, now) {
  const requested = new Date(stampFromEpoch(now)).getTime();
  const previous = Date.parse(record.updatedAt);
  if (!Number.isFinite(previous)) throw new TypeError('Record has an invalid updatedAt');
  const next = Math.max(requested, previous + 1);
  if (!Number.isSafeInteger(next)) throw new RangeError('Record version is outside the supported date range');
  return next;
}

function addMinutes(value, delta) {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(delta)) {
    throw new RangeError('Interval is outside the supported date range');
  }
  const result = value + delta;
  if (!Number.isSafeInteger(result)) throw new RangeError('Interval is outside the supported date range');
  return result;
}

/**
 * Convert a day plus a minute-of-day into a canonical timed interval patch.
 * Dates and times are civil values; UTC is used only as a timezone-neutral
 * arithmetic coordinate, so crossing midnight never depends on the device TZ.
 */
export function doIntervalAt(date, startMinute, duration = 30) {
  if (!validDate(date)) throw new TypeError('Invalid civil date');
  const start = asWholeMinutes(startMinute, 'startMinute');
  if (start >= DAY_MINUTES) throw new RangeError('startMinute must be within the day');
  const length = asWholeMinutes(duration, 'duration', { minimum: MIN_INTERVAL_MINUTES });
  const startAbsolute = dayNumber(date) * DAY_MINUTES + start;
  return intervalPatchFromBounds(startAbsolute, addMinutes(startAbsolute, length));
}

/**
 * Resolve a Plan drop to one canonical interval. Plans stay within the civil
 * day; an overlong or bottom-edge drop is clamped before the interval is
 * built. The returned `minute` is the final value used for both preview and
 * commit.
 */
export function resolvePlanDropTarget({ date, minute, duration } = {}) {
  if (!validDate(date)) throw new TypeError('Invalid civil date');
  const length = Math.max(MIN_INTERVAL_MINUTES, Math.min(DAY_MINUTES,
    asWholeMinutes(Math.round(Number(duration)), 'duration', { minimum: MIN_INTERVAL_MINUTES })));
  const requested = Math.max(0, snappedMinute(minute));
  const start = Math.min(Math.max(0, DAY_MINUTES - length), requested);
  const interval = doIntervalAt(date, start, length);
  return {
    minute: start,
    duration: length,
    visibleDuration: length,
    interval,
  };
}

/**
 * Resolve a timed Do drop. `minute` is the desired top edge after the caller
 * has removed the pointer grab offset. Moving the canonical record as a whole
 * preserves its true cross-midnight duration and identity.
 */
export function resolveDoDropTarget({ record, item, date, minute } = {}) {
  if (!record || record.timing !== DO_TIMING.TIMED) {
    throw new TypeError('A timed Do record is required');
  }
  if (!validDate(date)) throw new TypeError('Invalid civil date');
  const target = clampedDayMinute(snappedMinute(minute));
  const visibleStart = Number.isFinite(item?.startMinute) ? item.startMinute : target;
  const interval = moveDoInterval(record, target - visibleStart);
  const visible = visibleIntervalOnDate(interval, date);
  return {
    // The canonical move uses the displayed segment's delta. A clipped
    // cross-midnight row can therefore end up with a different visible top;
    // return that final top so the preview matches the committed interval.
    minute: visible?.startMinute ?? target,
    duration: doDurationMinutes(record),
    visibleDuration: visible?.durationMinutes ?? 0,
    visibleStartMinute: visible?.startMinute ?? null,
    visibleEndMinute: visible?.endMinute ?? null,
    interval,
  };
}

/**
 * Shared Plan/Do drop calculation for the view's preview and commit paths.
 * `minute` is the top edge after the drag code has subtracted the pointer's
 * grab offset. For a Plan dragged into Do, this returns a new canonical timed
 * interval; for an Untimed Do it supplies the same default 30-minute patch.
 */
export function resolveDropTarget({ lane, type, item, date, minute } = {}) {
  if (lane === 'plan' && type === 'plan') {
    return resolvePlanDropTarget({ date, minute, duration: item?.plan?.duration });
  }
  if (lane !== 'do') return null;
  if (type === 'plan') {
    return resolvePlanDropTarget({ date, minute, duration: item?.plan?.duration });
  }
  if (type === 'untimed') {
    const result = resolvePlanDropTarget({ date, minute, duration: 30 });
    return result;
  }
  if (type === 'do' || type === 'timed') {
    return resolveDoDropTarget({ record: item?.record, item, date, minute });
  }
  return null;
}

/** Move a timed Do as one interval, retaining its complete civil duration. */
export function moveDoInterval(record, deltaMinutes) {
  const { start, duration } = ensureTimedRecord(record);
  const delta = asWholeMinutes(deltaMinutes, 'deltaMinutes', { allowNegative: true });
  return intervalPatchFromBounds(addMinutes(start, delta), addMinutes(start, delta + duration));
}

/** Resize one edge while preserving the opposite edge and a five-minute minimum. */
export function resizeDoInterval(record, edge, deltaMinutes) {
  const { start, end } = ensureTimedRecord(record);
  if (edge !== 'start' && edge !== 'end') throw new TypeError("edge must be 'start' or 'end'");
  const delta = asWholeMinutes(deltaMinutes, 'deltaMinutes', { allowNegative: true });
  if (edge === 'start') {
    const requested = addMinutes(start, delta);
    return intervalPatchFromBounds(Math.min(requested, end - MIN_INTERVAL_MINUTES), end);
  }
  const requested = addMinutes(end, delta);
  return intervalPatchFromBounds(start, Math.max(requested, start + MIN_INTERVAL_MINUTES));
}

/** Build a linked or independent manual Do with all capture-once fields copied. */
export function createManualDo({
  id,
  title,
  task = null,
  planSnapshot = null,
  date,
  startMinute,
  duration = 30,
  progress = DO_PROGRESS.STARTED,
  now,
} = {}) {
  if (task !== null && (typeof task !== 'object' || Array.isArray(task))) {
    throw new TypeError('task must be an object or null');
  }
  if (!EDITABLE_PROGRESS.includes(progress)) {
    throw new TypeError('Manual Do progress must be started, partial, or mostly');
  }
  const stamp = stampFromEpoch(now);
  const interval = doIntervalAt(date, startMinute, duration);
  const taskId = task === null ? null : (task.recurringTemplateId ?? task.id ?? null);
  return createDoRecord({
    id,
    taskId,
    title: title ?? task?.title,
    ...interval,
    planSnapshot: planSnapshot === undefined ? null : planSnapshot,
    source: 'manual',
    progress,
    createdAt: stamp,
    updatedAt: stamp,
    observedAt: stamp,
  });
}

/**
 * Prepare an interval/progress edit against the current ledger version.
 * `null` means the dialog/gesture was stale or the row was deleted.  A
 * successful no-op returns the current object without changing its version.
 */
export function prepareDoEdit({ records, record, patch = {}, progress, now } = {}) {
  const current = resolveEditableDoRecord(records, record);
  if (!current) return null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('patch must be an object');
  }
  for (const key of Object.keys(patch)) {
    if (!EDITABLE_FIELDS.has(key)) throw new TypeError(`Cannot edit captured field: ${key}`);
  }
  if (progress !== undefined && !Object.values(DO_PROGRESS).includes(progress)) {
    throw new TypeError('Invalid Do progress');
  }
  if (progress === DO_PROGRESS.COMPLETED && current.progress !== DO_PROGRESS.COMPLETED) {
    throw new TypeError('Manual editing cannot restore completed progress');
  }
  const intervalChanged = Object.keys(patch).some((key) => patch[key] !== current[key]);
  const progressChanged = progress !== undefined && progress !== current.progress;
  if (!intervalChanged && !progressChanged) return current;

  let next = current;
  let version = monotonicEpoch(current, now);
  if (intervalChanged) next = updateDoRecord(next, patch, new Date(version).toISOString());
  if (progressChanged) {
    version = Math.max(version, Date.parse(next.updatedAt) + 1);
    next = reassessDoProgress(next, progress, new Date(version).toISOString());
  }
  return next;
}

/** Prepare a tombstone for the current version; stale/deleted rows return null. */
export function prepareDoDelete({ records, record, now } = {}) {
  const current = resolveEditableDoRecord(records, record);
  if (!current) return null;
  return tombstoneDoRecord(current, new Date(monotonicEpoch(current, now)).toISOString());
}

/**
 * Send exactly one prepared record to the ledger's sole writer. A held write
 * is accepted because ledger.js owns retry; a refused write is actionable and
 * is surfaced as an exception to the view.
 */
export async function commitDoEdit(recordJobo, record) {
  if (typeof recordJobo !== 'function') throw new TypeError('recordJobo must be a function');
  if (!record || typeof record !== 'object') throw new TypeError('A prepared Do record is required');
  const result = await recordJobo([record]);
  if (result?.ok === true || result?.held === true) return result;
  const error = result?.error instanceof Error
    ? result.error
    : new Error(String(result?.error || 'JOBO write rejected'));
  if (!error.code && typeof result?.error === 'string') error.code = result.error;
  if (!error.code && result?.error && typeof result.error.code === 'string') error.code = result.error.code;
  throw error;
}

export { DAY_MINUTES, MIN_INTERVAL_MINUTES };
