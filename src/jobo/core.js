// JOBO slice 2: pure record rules. No React, storage, clock or task mutation.
// The caller owns identities, event/observation timestamps and task lookup.
// See docs/jobo-ledger-persistence.md and docs/jobo-core.md.

export const DO_SOURCES = Object.freeze(['completion', 'manual', 'focus']);
export const DO_TIMING = Object.freeze({
  TIMED: 'timed',
  UNTIMED: 'untimed',
});
export const TIMING = Object.freeze({
  WITHIN_PLAN: 'withinPlan', DELAYED: 'delayed', OVERRUN: 'overrun',
  INTERRUPTED: 'interrupted', NOT_STARTED: 'notStarted', UNPLANNED: 'unplanned',
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const taskIdValid = id => id === null || nonempty(id) || (typeof id === 'number' && Number.isSafeInteger(id));
const editable = new Set(['timing', 'date', 'startTime', 'endDate', 'endTime']);

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
function validStamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d):[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return !!match && validDate(match[1]) && Number.isFinite(Date.parse(value));
}

// Civil minutes are coordinates on the planner, NOT measured UTC elapsed time.
// Supplying a Z here avoids the executing device's timezone changing the result.
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
  if (!Number.isFinite(end) || end <= start || Math.abs(end) > Number.MAX_SAFE_INTEGER) {
    throw new TypeError('Invalid plan duration');
  }
  return { start, end };
}

/**
 * Canonical JSON for the final tie-break, including ALL nested keys. Arrays
 * retain their order. No localeCompare, top-level replacer whitelist, coercion
 * of undefined/NaN to null, or dependence on property insertion order.
 */
function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if ((!plain(value) && !Array.isArray(value)) || ancestors.has(value)) {
    throw new TypeError('Record must contain only acyclic JSON data');
  }
  ancestors.add(value);
  let text;
  if (Array.isArray(value)) {
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, index)) throw new TypeError('Sparse arrays are not record data');
      entries.push(canonicalJson(value[index], ancestors));
    }
    text = `[${entries.join(',')}]`;
  } else {
    text = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(',')}}`;
  }
  ancestors.delete(value);
  return text;
}
const copy = value => JSON.parse(canonicalJson(value));

/** Validate a complete persisted record; never repair or invent history. */
export function validateDoRecord(record) {
  const errors = [];
  if (!plain(record)) return { ok: false, errors: ['record must be a plain object'] };
  if (!nonempty(record.id)) errors.push('id must be a nonempty string');
  if (!own(record, 'taskId') || !taskIdValid(record.taskId)) errors.push('taskId must be an id or explicit null');
  if (!nonempty(record.title)) errors.push('title must be a nonempty string');
  if (!DO_SOURCES.includes(record.source)) errors.push('invalid source');
  if (own(record, 'progress')) errors.push('progress belongs to Plan completion, not Do record');
  if (typeof record.deleted !== 'boolean') errors.push('deleted must be boolean');
  for (const key of ['createdAt', 'updatedAt', 'observedAt']) {
    if (!validStamp(record[key])) errors.push(`${key} must be an ISO timestamp with an offset`);
  }
  if (validStamp(record.createdAt) && validStamp(record.updatedAt)
    && Date.parse(record.updatedAt) < Date.parse(record.createdAt)) errors.push('updatedAt precedes createdAt');
  // observedAt is a device clock: do not assume it follows the source timestamp.
  if (!validDate(record.date)) errors.push('date must be a real Gregorian YYYY-MM-DD');
  if (!Object.values(DO_TIMING).includes(record.timing)) {
    errors.push('timing must be timed or untimed');
  } else if (record.timing === DO_TIMING.TIMED) {
    try {
      const duration = civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
      if (duration <= 0) errors.push('timed interval must be positive');
    } catch { errors.push('invalid timed interval date/time'); }
  } else {
    if (record.startTime !== null || record.endDate !== null || record.endTime !== null) {
      errors.push('untimed Do must use null startTime/endDate/endTime');
    }
  }
  if (!own(record, 'planSnapshot')) errors.push('planSnapshot must be supplied (or explicit null)');
  else if (record.planSnapshot !== null) {
    try { planBounds(record.planSnapshot); } catch { errors.push('invalid planSnapshot'); }
    if (plain(record.planSnapshot) && own(record.planSnapshot, 'completionStatus')) {
      errors.push('planSnapshot must not capture Plan completion');
    }
  }
  try { canonicalJson(record); } catch { errors.push('record must be acyclic JSON data'); }
  return { ok: errors.length === 0, errors };
}
function assertRecord(record) {
  const result = validateDoRecord(record);
  if (!result.ok) throw new TypeError(`Invalid Do record: ${result.errors.join('; ')}`);
}

/**
 * Construct the full record supplied by the caller. Only deleted defaults to
 * false. title/planSnapshot and opaque JSON extensions are defensively copied.
 * IDs, event times and observation time must be explicit. Completion belongs to Plan.
 */
export function createDoRecord(input) {
  if (!plain(input)) throw new TypeError('Record input must be a plain object');
  const record = { ...input, deleted: own(input, 'deleted') ? input.deleted : false };
  assertRecord(record);
  return copy(record);
}

function assertLater(record, updatedAt) {
  if (!validStamp(updatedAt) || Date.parse(updatedAt) <= Date.parse(record.updatedAt)) {
    throw new RangeError('A local edit requires updatedAt later than the previous version');
  }
}

/**
 * An explicit local interval correction. Capture-once fields cannot be
 * patched, even by accident through a spread live task. Never revives tombstones.
 * No-op edits preserve identity and timestamps. The caller supplies edit time.
 */
export function updateDoRecord(record, patch, updatedAt) {
  assertRecord(record);
  if (!plain(patch)) throw new TypeError('Patch must be a plain object');
  for (const key of Object.keys(patch)) {
    if (!editable.has(key)) throw new TypeError(`Cannot edit captured field: ${key}`);
  }
  if (record.deleted) throw new TypeError('Cannot edit a deleted Do record');
  const next = { ...record, ...patch };
  assertRecord(next);
  if (Object.keys(patch).every(key => patch[key] === record[key])) return record;
  assertLater(record, updatedAt);
  return createDoRecord({ ...next, updatedAt });
}

/** An explicit deletion is a newer version, never removal from the collection. */
export function tombstoneDoRecord(record, updatedAt) {
  assertRecord(record);
  if (record.deleted) return record;
  assertLater(record, updatedAt);
  return createDoRecord({ ...record, deleted: true, updatedAt });
}

/**
 * Pure ensure-present for a completion candidate. The caller selects the stable
 * completion key; this is not a detector. Re-observation (including a tombstone)
 * returns the existing collection unchanged before reconstructing anything.
 */
export function completeDoAttempt(records, input) {
  if (!Array.isArray(records) || !plain(input) || !nonempty(input.id)) throw new TypeError('Invalid attempt input');
  if (records.some(record => record.id === input.id)) return records;
  const attempt = createDoRecord({ ...input, source: 'completion', deleted: false });
  return [...records, attempt];
}

/** Civil minutes of one timed execution interval; null means deliberately untimed. */
export function doDurationMinutes(record) {
  assertRecord(record);
  if (record.timing === DO_TIMING.UNTIMED) return null;
  return civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
}

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

// Compatibility with #1762's opaque transport rows and timestamp-less legacy
// fixtures: a missing/invalid timestamp has the same epoch-zero rank as its
// stand-in. Accept explicit-offset ISO strings or numeric epoch milliseconds,
// never host-local date strings or coercible objects. Preserve the original row;
// this is a comparison rank, not history repair. NEW full records require ISO.
function versionTime(value) {
  const time = typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).getTime()
    : validStamp(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Drop-in pick for createLedger({ store, pick: pickJoboRecord }) and
 * useJoboLedger({ pickRecord: pickJoboRecord }). Return a whole original operand,
 * including opaque fields/tombstones, without mutation, restamping or pruning.
 *
 * This rule is deliberately schema-agnostic. Legacy-schema migration must happen
 * before merge; the picker only resolves competing versions of one record.
 */
export function pickJoboRecord(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  if (!plain(a) || !plain(b) || a.id == null || b.id == null || String(a.id) !== String(b.id)) {
    throw new TypeError('pickJoboRecord requires two copies of the same id');
  }
  const ua = versionTime(a.updatedAt), ub = versionTime(b.updatedAt);
  if (ua !== ub) return ua > ub ? a : b;
  const oa = versionTime(a.observedAt), ob = versionTime(b.observedAt);
  if (oa !== ob) return oa < ob ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}


/*
 * Theory-driven comparison model.
 *
 * These dimensions are canonical for new Slice 2 consumers. The older TIMING /
 * classifyAgainstPlan API remains as a compatibility surface while this model
 * is reviewed; it must not become a second persisted source of truth.
 */
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

export const COMPLETION_STATUS = Object.freeze({
  STARTED: 'started',
  PARTLY: 'partly',
  MOSTLY: 'mostly',
  COMPLETED: 'completed',
});

export const COMPLETION_STATUS_ORDER = Object.freeze([
  COMPLETION_STATUS.STARTED,
  COMPLETION_STATUS.PARTLY,
  COMPLETION_STATUS.MOSTLY,
  COMPLETION_STATUS.COMPLETED,
]);

const LEGACY_PROGRESS_TO_COMPLETION = Object.freeze({
  started: COMPLETION_STATUS.STARTED,
  partial: COMPLETION_STATUS.PARTLY,
  partly: COMPLETION_STATUS.PARTLY,
  mostly: COMPLETION_STATUS.MOSTLY,
  completed: COMPLETION_STATUS.COMPLETED,
  complete: COMPLETION_STATUS.COMPLETED,
});

/**
 * Explicit boundary for prototype/#1744 rows that still contain Do progress.
 * The returned record is canonical and progress-free; the caller decides which
 * identified Plan, if any, receives legacyCompletionStatus.
 */
export function migrateLegacyDoRecord(record) {
  if (!plain(record)) throw new TypeError('Legacy Do record must be a plain object');
  const hasProgress = own(record, 'progress');
  let legacyCompletionStatus = null;
  if (hasProgress) {
    legacyCompletionStatus = LEGACY_PROGRESS_TO_COMPLETION[record.progress];
    if (!legacyCompletionStatus) throw new TypeError('Unknown legacy Do progress');
  }

  const migrated = { ...record };
  delete migrated.progress;

  // Pre-discriminant rows are normalized here, before canonical merge.
  if (!own(migrated, 'timing')) {
    try {
      const duration = civilMinute(migrated.endDate, migrated.endTime)
        - civilMinute(migrated.date, migrated.startTime);
      if (duration > 0) {
        migrated.timing = DO_TIMING.TIMED;
      } else if (duration === 0 && migrated.source === 'completion') {
        migrated.timing = DO_TIMING.UNTIMED;
        migrated.startTime = null;
        migrated.endDate = null;
        migrated.endTime = null;
      }
    } catch {
      // createDoRecord below remains the strict validation boundary.
    }
  }

  return {
    record: createDoRecord(migrated),
    legacyCompletionStatus,
  };
}

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
  WITHIN_PLAN: 'within_plan',
  LATE: 'late',
  LONGER: 'longer',
  SPLIT: 'split',
  NOT_STARTED: 'not_started',
  UNPLANNED: 'unplanned',
});

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

/**
 * Pure Plan-occurrence completion assessment. Completion is ordinal, but this
 * is not a monotonic workflow: any valid assessment may be replaced by any
 * other valid assessment, or cleared with null. Do records are never changed.
 */
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

function comparisonNotStarted({ attemptCount, completionStatus, currentPlanEnd, nowMinute }) {
  return attemptCount === 0
    && completionStatus === null
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
