// JOBO Plan/Do comparison, policy classification and compact summaries.
// Interval mathematics lives in intervals.js; public consumers import through core.js.

import { own, plain, nonempty, copy } from './internal/json.js';
import {
  civilMinute,
  planBounds,
  comparisonAllenRelation,
  comparisonPlanOverlap,
  measureExecutionIntervals,
} from './intervals.js';
import {
  DO_TIMING,
  COMPLETION_STATUS,
  assertRecord,
} from './record.js';

export const TIMING = Object.freeze({
  WITHIN_PLAN: 'withinPlan', DELAYED: 'delayed', OVERRUN: 'overrun',
  INTERRUPTED: 'interrupted', NOT_STARTED: 'notStarted', UNPLANNED: 'unplanned',
});

export const PLAN_CONTEXT = Object.freeze({
  PLANNED: 'planned',
  NO_PLAN: 'no_plan',
  UNKNOWN: 'unknown',
});

export const RELATIVE_TIMING = Object.freeze({
  EARLY: 'early',
  ON_TIME: 'on_time',
  LATE: 'late',
});

export const DURATION_COMPARISON = Object.freeze({
  SHORTER: 'shorter',
  ON_ESTIMATE: 'on_estimate',
  LONGER: 'longer',
});

export const EXECUTION_PATTERN = Object.freeze({
  SINGLE_SESSION: 'single_session',
  SPLIT_SESSIONS: 'split_sessions',
});

export const TIMING_SUMMARY = Object.freeze({
  WITHIN_PLAN: 'within_plan',
  LATE: 'late',
  LONGER: 'longer',
  SPLIT: 'split',
  NOT_STARTED: 'not_started',
  UNPLANNED: 'unplanned',
});

export function classifyAgainstPlan(plan, records, options = {}) {
  const comparison = compareExecutionToPlan(plan, records, options);
  const legacyMap = {
    [TIMING_SUMMARY.WITHIN_PLAN]: TIMING.WITHIN_PLAN,
    [TIMING_SUMMARY.LATE]: TIMING.DELAYED,
    [TIMING_SUMMARY.LONGER]: TIMING.OVERRUN,
    [TIMING_SUMMARY.SPLIT]: TIMING.INTERRUPTED,
    [TIMING_SUMMARY.NOT_STARTED]: TIMING.NOT_STARTED,
    [TIMING_SUMMARY.UNPLANNED]: TIMING.UNPLANNED,
  };
  return {
    timing: summarizeTiming(comparison).map(label => legacyMap[label]),
    comparable: comparison.comparable,
    recordedMinutes: comparison.metrics.recordedMinutes,
    attemptCount: comparison.metrics.attemptCount,
  };
}

function comparisonTolerance(value, name) {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} tolerance must be a finite non-negative number`);
  }
  return value;
}

function completionStatusValue(value) {
  if (value == null) return null;
  if (!Object.values(COMPLETION_STATUS).includes(value)) {
    throw new TypeError('completionStatus must be started, partly, mostly, completed, or null');
  }
  return value;
}

function planIdentityValue(plan) {
  if (plan == null || !own(plan, 'id')) return null;
  const value = plan.id;
  if (!(nonempty(value) || (typeof value === 'number' && Number.isSafeInteger(value)))) {
    throw new TypeError('Plan id must be a nonempty string or safe integer');
  }
  return String(value);
}

function planState(plan) {
  if (plan == null) return { id: null, completionStatus: null };
  const id = planIdentityValue(plan);
  const completionStatus = completionStatusValue(
    own(plan, 'completionStatus') ? plan.completionStatus : null,
  );
  if (completionStatus !== null && id === null) {
    throw new TypeError('A Plan completionStatus requires a stable Plan id');
  }
  return { id, completionStatus };
}

export function setPlanCompletionStatus(plan, completionStatus) {
  if (!plain(plan)) throw new TypeError('Plan must be a plain object');
  planBounds(plan);
  const id = planIdentityValue(plan);
  if (id === null) throw new TypeError('Plan completion requires a stable Plan id');
  const next = completionStatusValue(completionStatus);
  const current = own(plan, 'completionStatus')
    ? completionStatusValue(plan.completionStatus)
    : null;
  if (current === next && (own(plan, 'completionStatus') || next === null)) return plan;
  return copy({ ...plan, completionStatus: next });
}

export function comparePlanAnchors(originalPlan, finalPlan) {
  const original = planBounds(originalPlan);
  const final = planBounds(finalPlan);
  return {
    startShiftMinutes: final.start - original.start,
    finishShiftMinutes: final.end - original.end,
    durationDifferenceMinutes: finalPlan.duration - originalPlan.duration,
    durationRatio: finalPlan.duration / originalPlan.duration,
  };
}

function resolvePlanState(plan, displayedPlan) {
  const reference = planState(plan);
  const displayed = planState(displayedPlan);
  if (reference.id !== null && displayed.id !== null && reference.id !== displayed.id) {
    throw new TypeError('plan and displayedPlan must identify the same Plan');
  }
  if (reference.completionStatus !== null && displayed.completionStatus !== null
    && reference.completionStatus !== displayed.completionStatus) {
    throw new TypeError('Plan completionStatus must agree across plan revisions');
  }
  return {
    id: displayed.id ?? reference.id,
    completionStatus: displayed.completionStatus ?? reference.completionStatus,
  };
}

function comparisonPolicy(tolerance = {}) {
  if (!plain(tolerance)) throw new TypeError('tolerance must be a plain object');
  return {
    startMinutes: comparisonTolerance(tolerance.startMinutes, 'start'),
    finishMinutes: comparisonTolerance(tolerance.finishMinutes, 'finish'),
    durationMinutes: comparisonTolerance(tolerance.durationMinutes, 'duration'),
  };
}

function comparisonTiming(offset, tolerance) {
  if (offset < -tolerance) return RELATIVE_TIMING.EARLY;
  if (offset > tolerance) return RELATIVE_TIMING.LATE;
  return RELATIVE_TIMING.ON_TIME;
}

function comparisonDuration(difference, tolerance) {
  if (difference < -tolerance) return DURATION_COMPARISON.SHORTER;
  if (difference > tolerance) return DURATION_COMPARISON.LONGER;
  return DURATION_COMPARISON.ON_ESTIMATE;
}

function comparisonNotStarted({ attemptCount, completionStatus, currentPlanEnd, nowMinute }) {
  return attemptCount === 0
    && completionStatus === null
    && currentPlanEnd !== null
    && nowMinute !== null
    && nowMinute >= currentPlanEnd;
}

export function compareExecutionToPlan(plan, records, options = {}) {
  if (!plain(options)) throw new TypeError('Comparison options must be a plain object');
  if (own(options, 'completionStatus')) {
    throw new TypeError('completionStatus belongs to Plan, not comparison options');
  }
  const {
    displayedPlan = plan,
    now,
    knownUnplanned = false,
    tolerance = {},
  } = options;

  if (!Array.isArray(records)) throw new TypeError('Expected an attempt array');
  if (typeof knownUnplanned !== 'boolean') throw new TypeError('knownUnplanned must be boolean');
  if (plan != null && knownUnplanned) throw new TypeError('A timed plan cannot be known-unplanned');

  const anchor = plan == null ? null : planBounds(plan);
  const current = displayedPlan == null ? null : planBounds(displayedPlan);
  const nowMinute = now === undefined ? null : civilMinute(now?.date, now?.time);
  const policy = comparisonPolicy(tolerance);
  const resolvedPlan = resolvePlanState(plan, displayedPlan);
  if (knownUnplanned && resolvedPlan.completionStatus !== null) {
    throw new TypeError('Unplanned execution cannot carry Plan completion');
  }

  const ids = new Set();
  const attempts = [];
  for (const record of records) {
    assertRecord(record);
    const identity = String(record.id);
    if (ids.has(identity)) throw new TypeError('Merge duplicate record ids before comparison');
    ids.add(identity);
    if (!record.deleted) attempts.push(record);
  }

  const planContext = anchor
    ? PLAN_CONTEXT.PLANNED
    : knownUnplanned ? PLAN_CONTEXT.NO_PLAN : PLAN_CONTEXT.UNKNOWN;

  const timedAttempts = attempts.filter(record => record.timing === DO_TIMING.TIMED);
  const untimedAttemptCount = attempts.length - timedAttempts.length;
  const {
    bounds,
    attemptMinutes,
    activeMinutes,
    recordedMinutes,
    overlapMinutes,
    firstStart,
    lastEnd,
    elapsedMinutes,
    gapMinutes,
  } = measureExecutionIntervals(timedAttempts);

  const executionPattern = attempts.length === 0
    ? null
    : attempts.length === 1 ? EXECUTION_PATTERN.SINGLE_SESSION : EXECUTION_PATTERN.SPLIT_SESSIONS;

  // Canonical rule:
  // not_started = Plan fully elapsed AND no live Do AND no explicit Plan completion.
  const notStarted = comparisonNotStarted({
    attemptCount: attempts.length,
    completionStatus: resolvedPlan.completionStatus,
    currentPlanEnd: current?.end ?? null,
    nowMinute,
  });

  const result = {
    planId: resolvedPlan.id,
    planContext,
    comparable: false,
    notStarted,
    executionPattern,
    intervalRelation: null,
    startTiming: null,
    finishTiming: null,
    durationComparison: null,
    completionStatus: resolvedPlan.completionStatus,
    withinPlan: false,
    metrics: {
      startOffsetMinutes: null,
      finishOffsetMinutes: null,
      durationDifferenceMinutes: null,
      durationRatio: null,
      planOverlapMinutes: null,
      recordedMinutes,
      attemptMinutes,
      activeMinutes,
      elapsedMinutes,
      gapMinutes,
      overlapMinutes,
      attemptCount: attempts.length,
      timedSessionCount: timedAttempts.length,
      untimedAttemptCount,
    },
  };

  // Untimed execution proves activity, but cannot support interval/duration
  // comparison. Mixed timed+untimed history is intentionally non-comparable as
  // a whole because the unmeasured portion could change every time dimension.
  if (!anchor || !attempts.length || untimedAttemptCount > 0) return result;

  const startOffsetMinutes = firstStart - anchor.start;
  const finishOffsetMinutes = lastEnd - anchor.end;
  const durationDifferenceMinutes = recordedMinutes - plan.duration;
  const durationRatio = recordedMinutes / plan.duration;
  const startTiming = comparisonTiming(startOffsetMinutes, policy.startMinutes);
  const finishTiming = comparisonTiming(finishOffsetMinutes, policy.finishMinutes);
  const durationComparison = comparisonDuration(durationDifferenceMinutes, policy.durationMinutes);

  result.comparable = true;
  result.intervalRelation = comparisonAllenRelation(anchor.start, anchor.end, firstStart, lastEnd);
  result.startTiming = startTiming;
  result.finishTiming = finishTiming;
  result.durationComparison = durationComparison;
  result.withinPlan = startTiming !== RELATIVE_TIMING.LATE
    && finishTiming !== RELATIVE_TIMING.LATE
    && durationComparison !== DURATION_COMPARISON.LONGER;
  result.metrics.startOffsetMinutes = startOffsetMinutes;
  result.metrics.finishOffsetMinutes = finishOffsetMinutes;
  result.metrics.durationDifferenceMinutes = durationDifferenceMinutes;
  result.metrics.durationRatio = durationRatio;
  result.metrics.planOverlapMinutes = comparisonPlanOverlap(bounds, anchor);
  return result;
}

export function summarizeTiming(comparison) {
  if (!plain(comparison) || !plain(comparison.metrics)) {
    throw new TypeError('Expected a comparison result');
  }

  // Canonical product summary is intentionally small and multi-label.
  // Detailed start/finish/duration/Allen dimensions remain available above.
  const labels = [];

  if (comparison.notStarted) {
    labels.push(TIMING_SUMMARY.NOT_STARTED);
  } else if (comparison.planContext === PLAN_CONTEXT.NO_PLAN) {
    labels.push(TIMING_SUMMARY.UNPLANNED);
  } else if (comparison.comparable && comparison.metrics.attemptCount > 0) {
    const late = comparison.startTiming === RELATIVE_TIMING.LATE
      || comparison.finishTiming === RELATIVE_TIMING.LATE;
    const longer = comparison.durationComparison === DURATION_COMPARISON.LONGER;

    if (!late && !longer) labels.push(TIMING_SUMMARY.WITHIN_PLAN);
    if (late) labels.push(TIMING_SUMMARY.LATE);
    if (longer) labels.push(TIMING_SUMMARY.LONGER);
  }

  if (comparison.executionPattern === EXECUTION_PATTERN.SPLIT_SESSIONS) {
    labels.push(TIMING_SUMMARY.SPLIT);
  }

  return labels;
}
