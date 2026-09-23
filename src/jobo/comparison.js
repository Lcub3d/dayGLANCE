// JOBO Plan/Do comparison, classification, and compact summaries.
// Public access is via core.js; internal module layout is not API.

import { plain } from './internal/json.js';
import { civilMinute, planBounds } from './internal/civilTime.js';
import { DO_TIMING, assertRecord, doDurationMinutes } from './record.js';

export const TIMING = Object.freeze({
  WITHIN_PLAN: 'withinPlan', DELAYED: 'delayed', OVERRUN: 'overrun',
  INTERRUPTED: 'interrupted', NOT_STARTED: 'notStarted', UNPLANNED: 'unplanned',
});
/*
 * Theory-driven comparison model.
 *
 * These dimensions are canonical for new Slice 2 consumers. The older TIMING /
 * classifyAgainstPlan API remains as a compatibility surface while this model
 * is reviewed; it must not become a second persisted source of truth.
 */
export const PLAN_CONTEXT = Object.freeze({
  PLANNED: 'planned',
  NO_PLAN: 'noPlan',
  UNKNOWN: 'unknown',
});

export const RELATIVE_TIMING = Object.freeze({
  EARLY: 'early',
  ON_TIME: 'onTime',
  LATE: 'late',
});

export const DURATION_COMPARISON = Object.freeze({
  SHORTER: 'shorter',
  ON_ESTIMATE: 'onEstimate',
  LONGER: 'longer',
});

export const EXECUTION_PATTERN = Object.freeze({
  SINGLE_SESSION: 'singleSession',
  SPLIT_SESSIONS: 'splitSessions',
});

export const ALLEN_RELATION = Object.freeze({
  BEFORE: 'before',
  MEETS: 'meets',
  OVERLAPS: 'overlaps',
  STARTS: 'starts',
  DURING: 'during',
  FINISHES: 'finishes',
  EQUALS: 'equals',
  STARTED_BY: 'startedBy',
  CONTAINS: 'contains',
  FINISHED_BY: 'finishedBy',
  OVERLAPPED_BY: 'overlappedBy',
  MET_BY: 'metBy',
  AFTER: 'after',
});

export const TIMING_SUMMARY = Object.freeze({
  WITHIN_PLAN: 'withinPlan',
  LATE: 'late',
  LONGER: 'longer',
  SPLIT: 'split',
  NOT_STARTED: 'notStarted',
  UNPLANNED: 'unplanned',
});

// Count covered civil minutes once for TIMED rows. Gaps add nothing; adjacent,
 // nested and overlapping attempts remain separate records for history.
function unionDurationMinutes(records) {
  const intervals = records.map(record => [
    civilMinute(record.date, record.startTime), civilMinute(record.endDate, record.endTime),
  ]).sort(([startA, endA], [startB, endB]) => startA - startB || endA - endB);
  let minutes = 0;
  let coveredEnd = -Infinity;
  for (const [start, end] of intervals) {
    minutes += Math.max(0, end - Math.max(start, coveredEnd));
    coveredEnd = Math.max(coveredEnd, end);
  }
  return minutes;
}

/**
 * Legacy compatibility adapter. All timing decisions come from
 * compareExecutionToPlan(); this wrapper only translates canonical labels into
 * the prototype vocabulary.
 */
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

function comparisonAllenRelation(planStart, planEnd, actualStart, actualEnd) {
  if (actualEnd < planStart) return ALLEN_RELATION.BEFORE;
  if (actualEnd === planStart) return ALLEN_RELATION.MEETS;
  if (actualStart < planStart && actualEnd > planStart && actualEnd < planEnd) return ALLEN_RELATION.OVERLAPS;
  if (actualStart === planStart && actualEnd < planEnd) return ALLEN_RELATION.STARTS;
  if (actualStart > planStart && actualEnd < planEnd) return ALLEN_RELATION.DURING;
  if (actualStart > planStart && actualEnd === planEnd) return ALLEN_RELATION.FINISHES;
  if (actualStart === planStart && actualEnd === planEnd) return ALLEN_RELATION.EQUALS;
  if (actualStart === planStart && actualEnd > planEnd) return ALLEN_RELATION.STARTED_BY;
  if (actualStart < planStart && actualEnd > planEnd) return ALLEN_RELATION.CONTAINS;
  if (actualStart < planStart && actualEnd === planEnd) return ALLEN_RELATION.FINISHED_BY;
  if (actualStart > planStart && actualStart < planEnd && actualEnd > planEnd) return ALLEN_RELATION.OVERLAPPED_BY;
  if (actualStart === planEnd) return ALLEN_RELATION.MET_BY;
  if (actualStart > planEnd) return ALLEN_RELATION.AFTER;
  throw new RangeError('Unable to classify interval relation');
}

function comparisonBounds(record) {
  return {
    start: civilMinute(record.date, record.startTime),
    end: civilMinute(record.endDate, record.endTime),
  };
}

function unionBoundsMinutes(bounds) {
  if (!bounds.length) return 0;
  const ordered = [...bounds].sort((a, b) => a.start - b.start || a.end - b.end);
  let minutes = 0;
  let coveredEnd = -Infinity;
  for (const { start, end } of ordered) {
    minutes += Math.max(0, end - Math.max(start, coveredEnd));
    coveredEnd = Math.max(coveredEnd, end);
  }
  return minutes;
}

function comparisonPlanOverlap(bounds, anchor) {
  const clipped = bounds.map(({ start, end }) => ({
    start: Math.max(start, anchor.start),
    end: Math.min(end, anchor.end),
  })).filter(({ start, end }) => end > start);
  return unionBoundsMinutes(clipped);
}

function comparisonNotStarted({ attemptCount, currentPlanEnd, nowMinute }) {
  return attemptCount === 0
    && currentPlanEnd !== null
    && nowMinute !== null
    && nowMinute >= currentPlanEnd;
}

/**
 * Measure execution against one explicit plan reference without mutating history.
 *
 * recordedMinutes / activeMinutes are unique measured wall-clock coverage.
 * Untimed Do proves execution without inventing minutes. If any live Do is
 * untimed, the overall execution is not interval-comparable to Plan. Timed
 * diagnostic metrics remain available for the measured subset.
 */
export function compareExecutionToPlan(plan, records, options = {}) {
  if (!plain(options)) throw new TypeError('Comparison options must be a plain object');
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
  const bounds = timedAttempts.map(comparisonBounds);
  const attemptMinutes = timedAttempts.length
    ? timedAttempts.reduce((sum, record) => sum + doDurationMinutes(record), 0)
    : null;
  const activeMinutes = timedAttempts.length ? unionDurationMinutes(timedAttempts) : null;
  const recordedMinutes = activeMinutes;
  const overlapMinutes = timedAttempts.length ? Math.max(0, attemptMinutes - activeMinutes) : null;
  const firstStart = bounds.length ? Math.min(...bounds.map(item => item.start)) : null;
  const lastEnd = bounds.length ? Math.max(...bounds.map(item => item.end)) : null;
  const elapsedMinutes = bounds.length ? lastEnd - firstStart : null;
  const gapMinutes = bounds.length ? Math.max(0, elapsedMinutes - activeMinutes) : null;

  const executionPattern = attempts.length === 0
    ? null
    : attempts.length === 1 ? EXECUTION_PATTERN.SINGLE_SESSION : EXECUTION_PATTERN.SPLIT_SESSIONS;

  // Canonical rule:
  // notStarted = Plan fully elapsed AND no live Do.
  const notStarted = comparisonNotStarted({
    attemptCount: attempts.length,
    currentPlanEnd: current?.end ?? null,
    nowMinute,
  });

  const result = {
    planContext,
    comparable: false,
    notStarted,
    executionPattern,
    intervalRelation: null,
    startTiming: null,
    finishTiming: null,
    durationComparison: null,
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

/**
 * Compact, multi-label convenience output. It never replaces the raw metrics or
 * independent dimensions above and intentionally avoids causal wording.
 */
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
