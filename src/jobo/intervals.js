// JOBO civil-time and interval mathematics.
// This module computes interval facts; policy classification belongs in comparison.js.

import { plain } from './internal/json.js';

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function validTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validStamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d):[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return !!match && validDate(match[1]) && Number.isFinite(Date.parse(value));
}

export function civilMinute(date, time) {
  if (!validDate(date) || !validTime(time)) throw new TypeError('Invalid civil date/time');
  const [hour, minute] = time.split(':').map(Number);
  return Date.parse(`${date}T00:00:00.000Z`) / 60000 + hour * 60 + minute;
}

export function planBounds(plan) {
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

export function timedRecordDurationMinutes(record) {
  return civilMinute(record.endDate, record.endTime) - civilMinute(record.date, record.startTime);
}

export function unionDurationMinutes(records) {
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

export function comparisonAllenRelation(planStart, planEnd, actualStart, actualEnd) {
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

export function comparisonBounds(record) {
  return {
    start: civilMinute(record.date, record.startTime),
    end: civilMinute(record.endDate, record.endTime),
  };
}

export function unionBoundsMinutes(bounds) {
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

export function comparisonPlanOverlap(bounds, anchor) {
  const clipped = bounds.map(({ start, end }) => ({
    start: Math.max(start, anchor.start),
    end: Math.min(end, anchor.end),
  })).filter(({ start, end }) => end > start);
  return unionBoundsMinutes(clipped);
}

export function measureExecutionIntervals(records) {
  const bounds = records.map(comparisonBounds);
  const attemptMinutes = records.length
    ? records.reduce((sum, record) => sum + timedRecordDurationMinutes(record), 0)
    : null;
  const activeMinutes = records.length ? unionDurationMinutes(records) : null;
  const recordedMinutes = activeMinutes;
  const overlapMinutes = records.length ? Math.max(0, attemptMinutes - activeMinutes) : null;
  const firstStart = bounds.length ? Math.min(...bounds.map(item => item.start)) : null;
  const lastEnd = bounds.length ? Math.max(...bounds.map(item => item.end)) : null;
  const elapsedMinutes = bounds.length ? lastEnd - firstStart : null;
  const gapMinutes = bounds.length ? Math.max(0, elapsedMinutes - activeMinutes) : null;

  return {
    bounds,
    attemptMinutes,
    activeMinutes,
    recordedMinutes,
    overlapMinutes,
    firstStart,
    lastEnd,
    elapsedMinutes,
    gapMinutes,
  };
}
