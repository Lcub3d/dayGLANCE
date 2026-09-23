// JOBO Slice 2 public facade.
// Downstream slices should import only from this file.

export {
  DO_SOURCES,
  DO_TIMING,
  DO_PROGRESS,
  validateDoRecord,
  createDoRecord,
  updateDoRecord,
  tombstoneDoRecord,
  completeDoAttempt,
  reassessDoProgress,
  doDurationMinutes,
} from './record.js';

export { migrateLegacyDoRecord } from './migration.js';
export { pickJoboRecord } from './merge.js';
export { comparePlanAnchors } from './plan.js';

export {
  TIMING,
  PLAN_CONTEXT,
  RELATIVE_TIMING,
  DURATION_COMPARISON,
  EXECUTION_PATTERN,
  ALLEN_RELATION,
  TIMING_SUMMARY,
  classifyAgainstPlan,
  compareExecutionToPlan,
  summarizeTiming,
} from './comparison.js';
