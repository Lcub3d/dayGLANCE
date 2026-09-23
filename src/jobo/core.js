// JOBO Slice 2 public facade.
// core.js is the supported import surface; the internal module layout is private.

export {
  DO_SOURCES,
  DO_TIMING,
  COMPLETION_STATUS,
  COMPLETION_STATUS_ORDER,
  createDoRecord,
  validateDoRecord,
  updateDoRecord,
  tombstoneDoRecord,
  completeDoAttempt,
  doDurationMinutes,
  migrateLegacyDoRecord,
} from './record.js';

export {
  pickJoboRecord,
} from './merge.js';

export {
  ALLEN_RELATION,
} from './intervals.js';

export {
  TIMING,
  PLAN_CONTEXT,
  RELATIVE_TIMING,
  DURATION_COMPARISON,
  EXECUTION_PATTERN,
  TIMING_SUMMARY,
  setPlanCompletionStatus,
  comparePlanAnchors,
  compareExecutionToPlan,
  classifyAgainstPlan,
  summarizeTiming,
} from './comparison.js';
