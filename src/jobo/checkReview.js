import { DURATION_COMPARISON, RELATIVE_TIMING } from './core.js';

/**
 * A Plan is eligible for automatic note review while its captured group still
 * resolves to a current real task.  A historical captured Plan has no
 * currentTask of its own after a reschedule, so sourceTask is the live task
 * whose completion state must be used for review.
 */
function currentPlanTask(plan) {
  const task = plan?.sourceTask || plan?.currentTask;
  if (!task || task.deleted || task.isJoboSyntheticOccurrence) return null;
  return task;
}

function hasTimingProblem(comparison) {
  return comparison?.comparable === true && (
    comparison.durationComparison === DURATION_COMPARISON.LONGER
    || comparison.startTiming === RELATIVE_TIMING.LATE
    || comparison.finishTiming === RELATIVE_TIMING.LATE
  );
}

/**
 * Return the reasons a model Plan should be included by the automatic review
 * check.  The comparison is read from the existing model group, which has
 * already resolved captured Plan identity, recurring occurrence dates, and
 * live (non-deleted) attempts.
 */
export function problemReasons(plan) {
  const task = currentPlanTask(plan);
  if (!task || plan?.noteKey == null || plan.noteKey === '') return null;
  const incomplete = task.completed !== true;
  const timing = hasTimingProblem(plan.comparison);
  if (!incomplete && !timing) return null;
  return { incomplete, timing };
}

/**
 * Whether one existing model Plan needs an automatic note review.
 *
 * Manual note expansion remains a caller concern: this selector only supplies
 * the automatic candidates and never records or clears a user's choice.
 */
export function isProblemPlan(plan) {
  return problemReasons(plan) !== null;
}

/**
 * Select note keys for Plans backed by a current task that are incomplete or
 * whose captured Plan comparison shows a late start, late finish, or longer
 * execution. Historical and current groups for one task naturally collapse
 * to one note key in the returned Set.
 *
 * Accepting a model or its `plans` array keeps this selector read-only and
 * makes it difficult for callers to accidentally regroup raw Do records by
 * task id, which would mix recurring occurrences or historical captures.
 */
export function getProblemNoteKeys(modelOrPlans) {
  const plans = Array.isArray(modelOrPlans) ? modelOrPlans : modelOrPlans?.plans;
  const keys = new Set();
  for (const plan of Array.isArray(plans) ? plans : []) {
    if (isProblemPlan(plan)) keys.add(String(plan.noteKey));
  }
  return keys;
}
