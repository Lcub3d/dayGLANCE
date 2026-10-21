// How fast local storage is filling, and roughly when it will be full (#2141).
//
// localStorage has a hard ceiling (~5 MiB; see utils/storage.js) and, once the
// daily notes moved out, it grows mostly with the task count. Nothing used to
// say so until a write failed. A small daily sample of the total gives a trend:
// a straight-line fit over the last 90 days, reported as the time left at that
// rate, plus a warning shown at most once a week when it gets close.
//
// The samples are device-local and excluded from backups (deviceSettings),
// where a value that changes every day would also defeat backup dedupe.

export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024; // the gauge's own denominator
export const STORAGE_SAMPLES_KEY = 'day-planner-storage-samples';
export const STORAGE_WARNED_KEY = 'day-planner-storage-projection-warned';
const WINDOW_DAYS = 90;
const MIN_SPAN_DAYS = 7;
const KEEP = 120;
const DAY = 86400000;
// Warn when full within this many days, or when this full already.
export const WARN_DAYS = 60;
export const WARN_FRACTION = 0.8;
const WARN_EVERY_DAYS = 7;

const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);

/** localStorage total in the gauge's accounting: (key + value) × 2 bytes. */
export function storageTotalBytes(storage = localStorage) {
  let total = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      total += ((key?.length || 0) + (storage.getItem(key)?.length || 0)) * 2;
    }
  } catch { /* a partial total is still a sample */ }
  return total;
}

/** Samples with today's replacing any earlier one for the same day, oldest first, bounded. */
export function addSample(samples, date, bytes) {
  const rest = (Array.isArray(samples) ? samples : []).filter((s) => s && s.date !== date && Number.isFinite(s.bytes));
  return [...rest, { date, bytes }].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP);
}

/**
 * The forecast from the samples within the last 90 days of `today`:
 *   { status: 'pending' }                 under a week of history;
 *   { status: 'flat', bytesPerDay }       not growing;
 *   { status: 'growing', bytesPerDay, daysLeft }.
 * `current` is the latest total, so a fresh measurement can be passed in.
 */
export function projectStorage(samples, { today, current, limit = STORAGE_LIMIT_BYTES } = {}) {
  const end = dayNumber(today);
  const recent = (Array.isArray(samples) ? samples : [])
    .map((s) => ({ x: dayNumber(s.date), y: s.bytes }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x <= end && end - p.x <= WINDOW_DAYS);
  if (recent.length < 2 || Math.max(...recent.map(p => p.x)) - Math.min(...recent.map(p => p.x)) < MIN_SPAN_DAYS) {
    return { status: 'pending' };
  }
  const n = recent.length;
  const mx = recent.reduce((s, p) => s + p.x, 0) / n;
  const my = recent.reduce((s, p) => s + p.y, 0) / n;
  const sxx = recent.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const sxy = recent.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const bytesPerDay = sxx > 0 ? sxy / sxx : 0;
  // Under ~100 bytes a day is noise: a year of it is under 1% of the budget.
  if (bytesPerDay < 100) return { status: 'flat', bytesPerDay: Math.max(0, bytesPerDay) };
  const now = Number.isFinite(current) ? current : recent[recent.length - 1].y;
  const daysLeft = Math.max(0, Math.floor((limit - now) / bytesPerDay));
  return { status: 'growing', bytesPerDay, daysLeft };
}

/** Whether to show the warning now, given the forecast and when it was last shown. */
export function shouldWarn(projection, { current, today, lastWarned, limit = STORAGE_LIMIT_BYTES }) {
  const close = (projection?.status === 'growing' && projection.daysLeft <= WARN_DAYS)
    || (Number.isFinite(current) && current >= limit * WARN_FRACTION);
  if (!close) return false;
  if (!lastWarned) return true;
  return dayNumber(today) - dayNumber(lastWarned) >= WARN_EVERY_DAYS;
}

/** The time left, as the unit a person would say: days under two months, months after. */
export function describeTimeLeft(daysLeft) {
  if (daysLeft < 60) return { unit: 'days', count: Math.max(1, daysLeft) };
  return { unit: 'months', count: Math.round(daysLeft / 30) };
}

export function readSamples(storage = localStorage) {
  try { return JSON.parse(storage.getItem(STORAGE_SAMPLES_KEY) || '[]') || []; } catch { return []; }
}
