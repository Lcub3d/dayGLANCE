// Shared validation and small value helpers for JOBO's native Plan group
// actions.  The stateful writer remains useTaskActions; this module keeps the
// batch boundary explicit so the adapter and the main task hook agree about
// which rows may be changed together.

const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const MINUTES_PER_DAY = 24 * 60;

/**
 * Group operations are deliberately narrower than a single Plan operation.
 * Imported/native-calendar, historical and synthetic rows have another owner
 * or are only a projection, so a group must be refused before any write.
 */
export function isPlanGroupReadonly(task, { historical = false } = {}) {
  if (!task || typeof task !== 'object') return true;
  return Boolean(
    historical
      || task.historical
      || task.readonly
      || task.readOnly
      || task.imported
      || task.nativeEventId
      || task.synthetic
      || task.isSynthetic
      || task.isJoboSyntheticOccurrence,
  );
}

export function canGroupTask(task, options = {}) {
  return Boolean(task && task.id != null && !isPlanGroupReadonly(task, options));
}

export function parsePlanTime(value) {
  if (typeof value !== 'string' || !CLOCK_RE.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function formatPlanTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Return the un-clamped target start.  Group callers validate the complete
 * batch first; clamping each row here would silently change the relative
 * spacing of the selected Plans.
 */
export function shiftedPlanStart(task, deltaMinutes) {
  const start = parsePlanTime(task?.startTime);
  if (start == null || !Number.isInteger(deltaMinutes)) return null;
  const duration = Number(task?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const next = start + deltaMinutes;
  if (next < 0 || next + duration > MINUTES_PER_DAY) return null;
  return formatPlanTime(next);
}

/**
 * Task collections use lastModified as their optimistic version.  A few test
 * and migration records also carry an explicit version/updatedAt; compare
 * those when either side exposes one so a stale view cannot partially move a
 * batch.  Rows with no version fields remain compatible with legacy data.
 */
export function samePlanVersion(current, requested) {
  if (!current || !requested || String(current.id) !== String(requested.id)) return false;
  for (const key of ['version', 'lastModified', 'updatedAt']) {
    if (Object.prototype.hasOwnProperty.call(current, key)
      || Object.prototype.hasOwnProperty.call(requested, key)) {
      if (current[key] !== requested[key]) return false;
    }
  }
  return true;
}

/** Stamp a deletion strictly after an existing task version. */
export function nextDeletionStamp(previous, now = Date.now()) {
  const prior = typeof previous === 'string' ? Date.parse(previous) : NaN;
  const base = Number.isFinite(prior) ? prior + 1000 : 0;
  return new Date(Math.max(Number.isFinite(now) ? now : Date.now(), base)).toISOString();
}
