import { DO_TIMING, updateDoRecord, validateDoRecord } from './core.js';

// Use the completing device's civil clock, not the observer's timezone.
// Checkbox-created intervals are editable estimates, matching the Jobo prototype.
export function completionInterval(stamp, duration = 30) {
  if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)/.exec(stamp);
  if (!match) return null;
  const minutes = Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.min(1440, Math.round(duration))) : 30;
  const end = Date.parse(`${match[1]}T${match[2]}:00Z`);
  const start = new Date(end - minutes * 60000).toISOString();
  return { timing: DO_TIMING.TIMED, date: start.slice(0, 10), startTime: start.slice(11, 16), endDate: match[1], endTime: match[2] };
}

// Upgrade only automatic, still-untimed completions. Keep identity, captured
// history and progress; never rewrite a timed correction or revive a deletion.
// A deterministic next version also makes two-device upgrades converge.
export function expandLegacyCompletions(records) {
  return (records || []).flatMap(record => {
    if (record?.source !== 'completion' || record.timing !== DO_TIMING.UNTIMED
      || record.deleted || !validateDoRecord(record).ok) return [];
    const interval = completionInterval(record.createdAt, record.planSnapshot?.duration);
    if (!interval) return [];
    return [updateDoRecord(record, interval, new Date(Date.parse(record.updatedAt) + 1).toISOString())];
  });
}
