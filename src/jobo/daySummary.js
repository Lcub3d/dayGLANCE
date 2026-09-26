import { buildJoboDayModel, planFromTask } from './viewModel.js';
import { clockMinute, validCivilDate } from './viewDates.js';

// Day time is a clipped union. It is NOT the sum of complete record lengths,
// nor planned durations of tasks whose native checkbox happens to be checked.
export function coveredMinutes(intervals) {
  let coveredEnd = -Infinity, total = 0;
  for (const { startMinute, endMinute } of [...intervals].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)) {
    total += Math.max(0, endMinute - Math.max(startMinute, coveredEnd));
    coveredEnd = Math.max(coveredEnd, endMinute);
  }
  return total;
}

/**
 * Read-only projections for the selected civil day, independent of UI zoom,
 * historical-card visibility, drag previews, and pending/uncommitted writes.
 *
 * Two scopes, deliberately not divided into a misleading actual/plan ratio:
 * - Time/attempts: committed Do coverage intersecting this civil day.
 * - Comparison: captured Plans dated this day, with their full attempt group
 *   (even when an attempt happens later). Only fully measured groups qualify.
 * Native completion counts CURRENT, completable, timed tasks, never Do progress.
 */
export function buildJoboDaySummary({ date, tasks = [], records, loaded = false, taskLookup = tasks, recurringTasks = [], isVisibleForUser } = {}) {
  if (!validCivilDate(date)) return null;
  const taskMap = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (task?.id == null || task.archived || task.isJoboSyntheticOccurrence
      || (task.imported && !task.isTaskCalendar)
      || (isVisibleForUser && !isVisibleForUser(task))) continue;
    const plan = planFromTask(task);
    if (plan?.date === date) taskMap.set(String(task.id), { task, plan });
  }
  const current = [...taskMap.values()];
  const plannedMinutes = current.reduce((sum, { plan }) => sum + Math.min(plan.duration, 1440 - clockMinute(plan.startTime)), 0);
  const completed = current.filter(({ task }) => task.completed === true).length;
  const native = { total: current.length, completed, percent: current.length ? completed / current.length * 100 : null, plannedMinutes };
  // A failed/unperformed ledger read is not an empty day.
  if (!loaded || !Array.isArray(records)) return { date, native, available: false, evidence: null, comparison: null };

  const model = buildJoboDayModel({ date, tasks, taskLookup, recurringTasks, records, isVisibleForUser });
  const timed = model.timedRecords.filter(item => item.record.timingBasis !== 'planDuration');
  const estimated = model.timedRecords.filter(item => item.record.timingBasis === 'planDuration');
  const untimed = model.untimedRecords;
  const visible = [...timed, ...untimed, ...estimated];
  const recordedMinutes = timed.length ? coveredMinutes(timed) : null;
  const summedMinutes = timed.reduce((sum, item) => sum + item.durationMinutes, 0);
  const progress = { started: 0, partial: 0, mostly: 0, completed: 0 };
  for (const { record } of visible) progress[record.progress] += 1;
  const evidence = {
    recordCount: visible.length,
    inferredCount: estimated.length,
    timedCount: timed.length,
    untimedCount: untimed.length,
    recordedMinutes,
    summedMinutes: timed.length ? summedMinutes : null,
    overlapMinutes: timed.length ? summedMinutes - recordedMinutes : null,
    noTimedPlanCount: visible.filter(item => item.record.planSnapshot === null).length,
    invalidCount: model.invalidRecordCount,
    progress,
  };
  const captured = new Map();
  for (const item of model.plans) {
    if (item.id.startsWith('captured::') && item.attempts.length) captured.set(item.groupKey, item);
  }
  const groups = [...captured.values()];
  const comparable = groups.filter(item => item.comparison?.comparable === true);
  const start = { early: 0, onTime: 0, late: 0 };
  const finish = { early: 0, onTime: 0, late: 0 };
  const duration = { shorter: 0, onEstimate: 0, longer: 0 };
  const clean = evidence.invalidCount === 0;
  if (clean) for (const { comparison } of comparable) {
    start[comparison.startTiming] += 1;
    finish[comparison.finishTiming] += 1;
    duration[comparison.durationComparison] += 1;
  }
  const comparison = {
    clean,
    groupCount: groups.length,
    comparableCount: clean ? comparable.length : null,
    untimedGroupCount: groups.filter(item => item.comparisonMeta?.hasUntimedAttempts).length,
    multipleRecordGroups: groups.filter(item => item.attempts.length > 1).length,
    start, finish, duration,
    groups: clean ? comparable.map(item => ({
      id: item.groupKey, title: item.task.title, plan: item.plan,
      startOffset: item.comparison.metrics.startOffsetMinutes,
      finishOffset: item.comparison.metrics.finishOffsetMinutes,
      durationDifference: item.comparison.metrics.durationDifferenceMinutes,
      recordedMinutes: item.comparison.metrics.recordedMinutes,
      attemptCount: item.attempts.length,
    })) : [],
  };
  return { date, native, available: true, evidence, comparison };
}
