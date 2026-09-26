import {
  DURATION_COMPARISON,
  DO_TIMING,
  RELATIVE_TIMING,
  compareExecutionToPlan,
  doDurationMinutes,
} from '../../jobo/core.js';

export const DAY_MINUTES = 24 * 60;

// The task model uses 3 as its highest priority and 0 as its default.  The
// timeline's visual labels are intentionally the inverse Todoist-style names:
// P1 is the most important colour and P4 is the neutral/default colour.
export const PRIORITY_COLORS = Object.freeze({
  3: '#ff7775',
  2: '#ffa834',
  1: '#609bef',
  0: '#b3b3b3',
});

export const PRIORITY_LABELS = Object.freeze({
  3: 'P1',
  2: 'P2',
  1: 'P3',
  0: 'P4',
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Normalize the native 0..3 priority field without treating zero as missing.
 * String values are accepted at this presentation boundary because imported
 * task payloads can be JSON-stringified, while unknown values remain neutral.
 */
export function priorityRank(value) {
  if (value === 'p1' || value === 'P1') return 3;
  if (value === 'p2' || value === 'P2') return 2;
  if (value === 'p3' || value === 'P3') return 1;
  if (value === 'p4' || value === 'P4') return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 3 ? numeric : 0;
}

export function priorityColor(value) {
  return PRIORITY_COLORS[priorityRank(value)];
}

export function priorityLabel(value) {
  return PRIORITY_LABELS[priorityRank(value)];
}

function parseClock(value) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value || '');
  if (!match) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function dayDistance(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return 0;
  const fromMillis = Date.parse(`${from}T00:00:00Z`);
  const toMillis = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMillis) || !Number.isFinite(toMillis)) return 0;
  return Math.round((toMillis - fromMillis) / 86400000);
}

function itemInterval(item) {
  if (!item || typeof item !== 'object') return null;
  // buildJoboDayModel already supplies day-relative, clipped coordinates.  Do
  // not use a truthiness check here: midnight is a real, useful zero value.
  if (finite(item.startMinute) && finite(item.endMinute)) {
    return { startMinute: item.startMinute, endMinute: item.endMinute };
  }

  // Keep the helper useful with a plain Plan item in focused tests and small
  // integrations.  The full view model path above remains the source of truth.
  const plan = item.plan || item;
  const planStart = parseClock(plan?.startTime);
  if (plan && planStart !== null && finite(plan.duration) && plan.duration > 0) {
    return { startMinute: planStart, endMinute: planStart + plan.duration };
  }

  // This is a convenience for isolated helper callers.  The production view
  // passes model items with startMinute/endMinute, so no date selection is
  // guessed in the normal path.
  const record = item.record || item;
  const recordStart = parseClock(record?.startTime);
  const recordEnd = parseClock(record?.endTime);
  if (recordStart !== null && recordEnd !== null) {
    const dayOffset = dayDistance(record.date, record.endDate);
    const endMinute = recordStart + dayOffset * DAY_MINUTES + (recordEnd - recordStart);
    if (endMinute > recordStart) return { startMinute: recordStart, endMinute };
  }
  return null;
}

function clipInterval(interval, startMinute, endMinute) {
  const start = Math.max(startMinute, interval.startMinute);
  const end = Math.min(endMinute, interval.endMinute);
  return end > start ? { startMinute: start, endMinute: end } : null;
}

function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const same = previous
      && previous.kind === segment.kind
      && previous.priority === segment.priority
      && previous.endMinute === segment.startMinute;
    if (same) {
      previous.endMinute = segment.endMinute;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * Paint a full day as contiguous priority/gap segments.  A segment's bounds
 * are real minute coordinates; callers can choose their own pixel scale later.
 * Overlapping rows use the highest priority at each boundary interval.
 */
export function buildPrioritySegments(items, options = {}) {
  const startMinute = finite(options.startMinute) ? Math.max(0, options.startMinute) : 0;
  const endMinute = finite(options.endMinute) ? Math.min(DAY_MINUTES, options.endMinute) : DAY_MINUTES;
  const priorityForItem = typeof options.priorityForItem === 'function'
    ? options.priorityForItem
    : (item) => item?.task?.priority;
  if (endMinute <= startMinute) return [];

  const intervals = (Array.isArray(items) ? items : [])
    .map((item) => {
      const interval = itemInterval(item);
      if (!interval || interval.endMinute <= interval.startMinute) return null;
      const clipped = clipInterval(interval, startMinute, endMinute);
      return clipped ? { ...clipped, item } : null;
    })
    .filter(Boolean);

  const boundaries = new Set([startMinute, endMinute]);
  for (const interval of intervals) {
    boundaries.add(interval.startMinute);
    boundaries.add(interval.endMinute);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end <= start) continue;
    const active = intervals.filter((interval) => interval.startMinute < end && interval.endMinute > start);
    if (!active.length) {
      segments.push({ kind: 'gap', priority: null, color: null, startMinute: start, endMinute: end });
      continue;
    }
    let winner = active[0];
    let winnerPriority = priorityRank(priorityForItem(winner.item));
    for (const candidate of active.slice(1)) {
      const candidatePriority = priorityRank(priorityForItem(candidate.item));
      if (candidatePriority > winnerPriority) {
        winner = candidate;
        winnerPriority = candidatePriority;
      }
    }
    segments.push({
      kind: 'priority',
      priority: winnerPriority,
      label: priorityLabel(winnerPriority),
      color: priorityColor(winnerPriority),
      startMinute: start,
      endMinute: end,
      itemIds: active.map((entry) => entry.item?.id ?? entry.item?.record?.id).filter((id) => id != null),
    });
  }
  return mergeSegments(segments);
}

function planPriority(item) {
  const task = item?.currentTask || item?.task || item?.sourceTask;
  return task?.priority;
}

function doPriority(item) {
  // Priority is a task property.  A record-level priority is intentionally
  // ignored so an unlinked Do remains the ordinary neutral grey segment.
  return item?.task?.priority;
}

export function buildPriorityTimeline({ plans = [], timedRecords = [] } = {}) {
  const currentPlans = (Array.isArray(plans) ? plans : []).filter((item) => item && item.historical !== true);
  return {
    plan: buildPrioritySegments(currentPlans, { priorityForItem: planPriority }),
    do: buildPrioritySegments(timedRecords, { priorityForItem: doPriority }),
  };
}

/**
 * Compare exactly one Do attempt to its captured plan.  This deliberately
 * never consumes item.attempts/comparison, whose aggregate values are useful
 * for Plan cards but would colour an individual Do with another attempt's data.
 */
export function compareAttemptToPlan(record) {
  if (!record || record.timing !== DO_TIMING.TIMED || !record.planSnapshot) return null;
  try {
    return compareExecutionToPlan(record.planSnapshot, [record]);
  } catch {
    // Invalid or legacy rows remain visually neutral; this helper must never
    // invent a timing judgement from partially valid data.
    return null;
  }
}

export function comparisonState(value) {
  if (value === RELATIVE_TIMING.EARLY || value === DURATION_COMPARISON.SHORTER) return 'early';
  if (value === RELATIVE_TIMING.LATE || value === DURATION_COMPARISON.LONGER) return 'late';
  return 'neutral';
}

export function attemptComparisonStates(record) {
  const comparison = compareAttemptToPlan(record);
  return {
    comparison,
    planState: comparison ? 'planned' : 'unplanned',
    startState: comparisonState(comparison?.startTiming),
    finishState: comparisonState(comparison?.finishTiming),
    durationState: comparisonState(comparison?.durationComparison),
  };
}

export function doDuration(record) {
  if (!record || record.timing !== DO_TIMING.TIMED) return null;
  try {
    return doDurationMinutes(record);
  } catch {
    return null;
  }
}

export function visibleSegment(segment, startHour, scale, height) {
  const pxPerHour = finite(scale) && scale > 0 ? scale : 60;
  const safeStartHour = finite(startHour) ? Math.max(0, startHour) : 0;
  const visibleStart = Math.max(segment.startMinute, safeStartHour * 60);
  const visibleEnd = Math.min(segment.endMinute, DAY_MINUTES);
  const top = ((visibleStart - safeStartHour * 60) / 60) * pxPerHour;
  const segmentHeight = ((visibleEnd - visibleStart) / 60) * pxPerHour;
  if (visibleEnd <= visibleStart || segmentHeight <= 0 || (finite(height) && top >= height)) return null;
  return {
    ...segment,
    startMinute: visibleStart,
    endMinute: visibleEnd,
    top,
    height: finite(height) ? Math.min(segmentHeight, Math.max(0, height - top)) : segmentHeight,
  };
}
