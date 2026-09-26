// Explicit JOBO Plan checkbox completion. The caller supplies the clock and
// commits the returned row through recordJoboFromView([row], {completePlan:true}).
// Storage, the native checkbox and grouped history remain owned by that writer.
import { createDoRecord, DO_PROGRESS, DO_TIMING } from './core.js';
import { nativeDoCompletionState } from './completionBridge.js';
import { latestDoForTask } from './completionPolicy.js';
import { planSnapshotOf } from './detector.js';
import { dateToString } from '../utils/taskUtils.js';

const two = value => String(value).padStart(2, '0');
const civilMinute = (date, time) => Date.parse(`${date}T${time}:00.000Z`) / 60000;
const coordinate = minute => {
  const value = new Date(minute * 60000);
  if (!Number.isFinite(value.getTime())) throw new RangeError('Plan duration is outside the supported date range');
  return { date: value.toISOString().slice(0, 10), time: `${two(value.getUTCHours())}:${two(value.getUTCMinutes())}` };
};

/**
 * End the last Do for this native task instance at the local clock's minute.
 * A usable timed start is retained. Otherwise infer start from the explicit
 * Plan duration, including the prior day, and label timingBasis=planDuration.
 * An existing Untimed Do keeps its id/source/capture fields; only an absent Do
 * needs the caller's fresh id. completedAt retains the exact instant (seconds
 * and milliseconds) while the existing interval schema stays minute-precise.
 * null means ineligible/already checked/pending; invalid duration is rejected
 * only when inference needs it. No fallback invents a default duration.
 */
export function preparePlanCompletion({
  records, pendingIds = [], tasks = [], unscheduledTasks = [], recurringTasks = [],
  task, now, id,
} = {}) {
  if (!Array.isArray(records) || !Array.isArray(pendingIds)) throw new TypeError('records and pendingIds must be arrays');
  if (!task || task.id == null) throw new TypeError('A live Plan task is required');
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new TypeError('now must be a valid epoch millisecond number');
  }
  const clock = new Date(now);
  const date = dateToString(clock);
  const time = `${two(clock.getHours())}:${two(clock.getMinutes())}`;
  const completedAt = clock.toISOString();
  const context = { records, tasks, unscheduledTasks, recurringTasks };
  const probe = { id: '', source: 'manual', taskId: task.recurringTemplateId ?? task.id, planSnapshot: planSnapshotOf(task) };
  const state = nativeDoCompletionState(context, probe);
  if (!state || state.completed || task.isJoboSyntheticOccurrence) return null;
  // A pending correction to any Do for this instance can change which one is
  // last. Do not finalize an older committed projection while that is held.
  const pending = new Set(pendingIds.map(String));
  if (records.some(row => pending.has(String(row.id)) && nativeDoCompletionState(context, row)?.id === state.id)) return null;
  const current = latestDoForTask(context, probe);
  if (current) createDoRecord(current);
  else if (records.some(row => row.id === id)) throw new TypeError('A fresh Do identity is required');
  const end = civilMinute(date, time);
  let interval;
  let timingBasis;
  if (current?.timing === DO_TIMING.TIMED && end > civilMinute(current.date, current.startTime)) {
    interval = { timing: DO_TIMING.TIMED, date: current.date, startTime: current.startTime, endDate: date, endTime: time };
  } else {
    if (!Number.isSafeInteger(task.duration) || task.duration <= 0) {
      throw new RangeError('A positive whole-minute Plan duration is required to infer the Do start');
    }
    const start = coordinate(end - task.duration);
    interval = { timing: DO_TIMING.TIMED, date: start.date, startTime: start.time, endDate: date, endTime: time };
    timingBasis = 'planDuration';
  }
  const base = current || {
    id, taskId: probe.taskId, title: String(task.title || '').trim() || 'Untitled',
    source: 'manual', planSnapshot: probe.planSnapshot, createdAt: completedAt, observedAt: completedAt,
  };
  const updatedAt = new Date(current ? Math.max(now, Date.parse(current.updatedAt) + 1) : now).toISOString();
  return createDoRecord({ ...base, ...interval, progress: DO_PROGRESS.COMPLETED,
    completedAt, ...(timingBasis ? { timingBasis } : {}), updatedAt });
}
