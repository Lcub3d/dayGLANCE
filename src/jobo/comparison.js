
import { validateDoRecord, doDurationMinutes } from './core.js';

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

export const ALLEN_RELATION = Object.freeze({
  BEFORE: 'before',
  MEETS: 'meets',
  OVERLAPS: 'overlaps',
  STARTS: 'starts',
  DURING: 'during',
  FINISHES: 'finishes',
  EQUALS: 'equals',
  STARTED_BY: 'started_by',
  CONTAINS: 'contains',
  FINISHED_BY: 'finished_by',
  OVERLAPPED_BY: 'overlapped_by',
  MET_BY: 'met_by',
  AFTER: 'after',
});

export const TIMING_SUMMARY = Object.freeze({
  MATCHES_PLAN: 'matches_plan',
  EARLY_START: 'early_start',
  LATE_START: 'late_start',
  EARLY_FINISH: 'early_finish',
  LATE_FINISH: 'late_finish',
  SHORTER: 'shorter',
  LONGER: 'longer',
  SPLIT_SESSIONS: 'split_sessions',
  NO_PLAN: 'no_plan',
  PLAN_UNKNOWN: 'plan_unknown',
  NOT_STARTED: 'not_started',
});

const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function validTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function civilMinute(date, time) {
  if (!validDate(date) || !validTime(time)) throw new TypeError('Invalid civil date/time');
  const [hour, minute] = time.split(':').map(Number);
  return Date.parse(`${date}T00:00:00.000Z`) / 60000 + hour * 60 + minute;
}
function planBounds(plan) {
  if (!plain(plan) || !validDate(plan.date) || !validTime(plan.startTime)
    || typeof plan.duration !== 'number' || !Number.isFinite(plan.duration) || plan.duration <= 0) {
    throw new TypeError('Invalid timed plan');
  }
  const start = civilMinute(plan.date, plan.startTime);
  const end = start + plan.duration;
  if (!Number.isFinite(end) || end <= start) throw new TypeError('Invalid plan duration');
  return { start, end };
}
function recordBounds(record) {
  return {
    start: civilMinute(record.date, record.startTime),
    end: civilMinute(record.endDate, record.endTime),
  };
}
function assertRecord(record) {
  const result = validateDoRecord(record);
  if (!result.ok) throw new TypeError(`Invalid Do record: ${result.errors.join('; ')}`);
}
function toleranceValue(value, name) {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} tolerance must be a finite non-negative number`);
  }
  return value;
}
function normalizeTolerance(tolerance = {}) {
  if (!plain(tolerance)) throw new TypeError('tolerance must be a plain object');
  return {
    startMinutes: toleranceValue(tolerance.startMinutes, 'start'),
    finishMinutes: toleranceValue(tolerance.finishMinutes, 'finish'),
    durationMinutes: toleranceValue(tolerance.durationMinutes, 'duration'),
  };
}
function timingFromOffset(offset, tolerance) {
  if (offset < -tolerance) return RELATIVE_TIMING.EARLY;
  if (offset > tolerance) return RELATIVE_TIMING.LATE;
  return RELATIVE_TIMING.ON_TIME;
}
function durationFromDifference(difference, tolerance) {
  if (difference < -tolerance) return DURATION_COMPARISON.SHORTER;
  if (difference > tolerance) return DURATION_COMPARISON.LONGER;
  return DURATION_COMPARISON.ON_ESTIMATE;
}
function allenRelation(planStart, planEnd, actualStart, actualEnd) {
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
function intervalUnionMinutes(bounds) {
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
function overlapWithPlanMinutes(bounds, plan) {
  const clipped = bounds.map(({ start, end }) => ({
    start: Math.max(start, plan.start),
    end: Math.min(end, plan.end),
  })).filter(({ start, end }) => end > start);
  return intervalUnionMinutes(clipped);
}

/**
 * Theory-driven JOBO comparison.
 *
 * Historical facts stay in the records. This function derives measurements and
 * classifications without changing those records. Duration comparison uses the
 * sum of per-attempt recorded durations (effort attributed to the task), while
 * activeMinutes is the union of wall-clock coverage so overlaps are also visible.
 */
export function compareExecutionToPlan(
  plan,
  records,
  {
    displayedPlan = plan,
    now,
    knownUnplanned = false,
    tolerance = {},
  } = {},
) {
  if (!Array.isArray(records)) throw new TypeError('Expected an attempt array');
  if (typeof knownUnplanned !== 'boolean') throw new TypeError('knownUnplanned must be boolean');
  if (plan != null && knownUnplanned) throw new TypeError('A timed plan cannot be known-unplanned');

  const anchor = plan == null ? null : planBounds(plan);
  const current = displayedPlan == null ? null : planBounds(displayedPlan);
  const nowMinute = now === undefined ? null : civilMinute(now?.date, now?.time);
  const policy = normalizeTolerance(tolerance);

  const ids = new Set();
  const attempts = [];
  for (const record of records) {
    assertRecord(record);
    if (ids.has(String(record.id))) throw new TypeError('Merge duplicate record ids before comparison');
    ids.add(String(record.id));
    if (!record.deleted) attempts.push(record);
  }

  const planContext = anchor
    ? PLAN_CONTEXT.PLANNED
    : knownUnplanned ? PLAN_CONTEXT.NO_PLAN : PLAN_CONTEXT.UNKNOWN;

  const timedAttempts = attempts.filter(record => doDurationMinutes(record) > 0);
  const bounds = timedAttempts.map(recordBounds);
  const recordedMinutes = timedAttempts.reduce((sum, record) => sum + doDurationMinutes(record), 0);
  const activeMinutes = intervalUnionMinutes(bounds);
  const overlapMinutes = Math.max(0, recordedMinutes - activeMinutes);
  const firstStart = bounds.length ? Math.min(...bounds.map(item => item.start)) : null;
  const lastEnd = bounds.length ? Math.max(...bounds.map(item => item.end)) : null;
  const elapsedMinutes = bounds.length ? lastEnd - firstStart : null;
  const gapMinutes = bounds.length ? Math.max(0, elapsedMinutes - activeMinutes) : null;

  const executionPattern = attempts.length === 0
    ? null
    : attempts.length === 1 ? EXECUTION_PATTERN.SINGLE_SESSION : EXECUTION_PATTERN.SPLIT_SESSIONS;

  const notStarted = attempts.length === 0
    && current !== null
    && nowMinute !== null
    && nowMinute >= current.end;

  const result = {
    planContext,
    comparable: false,
    notStarted,
    executionPattern,
    intervalRelation: null,
    startTiming: null,
    finishTiming: null,
    durationComparison: null,
    matchesPlan: false,
    metrics: {
      startOffsetMinutes: null,
      finishOffsetMinutes: null,
      durationDifferenceMinutes: null,
      durationRatio: null,
      planOverlapMinutes: null,
      recordedMinutes,
      activeMinutes,
      elapsedMinutes,
      gapMinutes,
      overlapMinutes,
      attemptCount: attempts.length,
      timedSessionCount: timedAttempts.length,
    },
    progress: attempts.map(({ id, progress }) => ({ id, progress })),
  };

  if (!anchor || !timedAttempts.length) return result;

  const startOffsetMinutes = firstStart - anchor.start;
  const finishOffsetMinutes = lastEnd - anchor.end;
  const durationDifferenceMinutes = recordedMinutes - plan.duration;
  const durationRatio = recordedMinutes / plan.duration;
  const startTiming = timingFromOffset(startOffsetMinutes, policy.startMinutes);
  const finishTiming = timingFromOffset(finishOffsetMinutes, policy.finishMinutes);
  const durationComparison = durationFromDifference(durationDifferenceMinutes, policy.durationMinutes);

  result.comparable = true;
  result.intervalRelation = allenRelation(anchor.start, anchor.end, firstStart, lastEnd);
  result.startTiming = startTiming;
  result.finishTiming = finishTiming;
  result.durationComparison = durationComparison;
  result.matchesPlan = startTiming === RELATIVE_TIMING.ON_TIME
    && finishTiming === RELATIVE_TIMING.ON_TIME
    && durationComparison === DURATION_COMPARISON.ON_ESTIMATE;
  result.metrics.startOffsetMinutes = startOffsetMinutes;
  result.metrics.finishOffsetMinutes = finishOffsetMinutes;
  result.metrics.durationDifferenceMinutes = durationDifferenceMinutes;
  result.metrics.durationRatio = durationRatio;
  result.metrics.planOverlapMinutes = overlapWithPlanMinutes(bounds, anchor);
  return result;
}

export function summarizeTiming(comparison) {
  if (!plain(comparison) || !plain(comparison.metrics)) {
    throw new TypeError('Expected a comparison result');
  }
  const labels = [];
  if (comparison.notStarted) labels.push(TIMING_SUMMARY.NOT_STARTED);
  if (comparison.planContext === PLAN_CONTEXT.NO_PLAN) labels.push(TIMING_SUMMARY.NO_PLAN);
  else if (comparison.planContext === PLAN_CONTEXT.UNKNOWN && comparison.metrics.attemptCount > 0) {
    labels.push(TIMING_SUMMARY.PLAN_UNKNOWN);
  }

  if (comparison.matchesPlan) {
    labels.push(TIMING_SUMMARY.MATCHES_PLAN);
  } else if (comparison.comparable) {
    if (comparison.startTiming === RELATIVE_TIMING.EARLY) labels.push(TIMING_SUMMARY.EARLY_START);
    else if (comparison.startTiming === RELATIVE_TIMING.LATE) labels.push(TIMING_SUMMARY.LATE_START);
    if (comparison.finishTiming === RELATIVE_TIMING.EARLY) labels.push(TIMING_SUMMARY.EARLY_FINISH);
    else if (comparison.finishTiming === RELATIVE_TIMING.LATE) labels.push(TIMING_SUMMARY.LATE_FINISH);
    if (comparison.durationComparison === DURATION_COMPARISON.SHORTER) labels.push(TIMING_SUMMARY.SHORTER);
    else if (comparison.durationComparison === DURATION_COMPARISON.LONGER) labels.push(TIMING_SUMMARY.LONGER);
  }

  if (comparison.executionPattern === EXECUTION_PATTERN.SPLIT_SESSIONS) {
    labels.push(TIMING_SUMMARY.SPLIT_SESSIONS);
  }
  return labels;
}
