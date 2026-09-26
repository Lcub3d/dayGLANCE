import React from 'react';
import { compareExecutionToPlan, DO_TIMING, summarizeTiming } from '../../jobo/core.js';
import { formatDuration } from '../../utils/formatDuration.js';
import { attemptComparisonStates, doDuration } from './TimelineComparison.js';
import './TimelineComparison.css';

const identity = (value) => value;

function formatClock(ctx, value) {
  return typeof ctx?.formatTime === 'function' ? ctx.formatTime(value) : value;
}

function translate(t, key, fallback, values) {
  if (typeof t !== 'function') return fallback;
  const result = t(key, values);
  return result === key ? fallback : result;
}

function comparisonText(t, key, comparison, value, metric, fallback) {
  const minutes = comparison?.metrics?.[metric];
  if (!comparison || !Number.isFinite(minutes) || !value) return fallback;
  return translate(t, `jobo.view.${key}.${value}`, fallback, { minutes: Math.abs(minutes) });
}

const SUMMARY_FALLBACKS = Object.freeze({
  withinPlan: 'On plan',
  late: 'Late',
  longer: 'Longer',
  split: 'Split',
  notStarted: 'No Do recorded',
  unplanned: 'Unplanned',
  timeIncomplete: 'Time not comparable',
});

function timingSummary(record) {
  if (!record) return { comparison: null, labels: [] };
  const plan = record.planSnapshot || null;
  try {
    // A Do owns one captured plan. Keep this comparison deliberately scoped to
    // this record so another attempt can never tint its timing chip.
    const comparison = compareExecutionToPlan(plan, [record], plan ? {} : { knownUnplanned: true });
    const labels = comparison.metrics.untimedAttemptCount > 0
      ? ['timeIncomplete']
      : summarizeTiming(comparison);
    return { comparison, labels };
  } catch {
    return { comparison: null, labels: [] };
  }
}

function summaryText(t, label) {
  if (label === 'timeIncomplete') return translate(t, 'jobo.view.timeIncompleteShort', SUMMARY_FALLBACKS[label]);
  return translate(t, `jobo.view.summary.${label}`, SUMMARY_FALLBACKS[label] || label);
}

function summaryTone(label) {
  if (label === 'late' || label === 'longer' || label === 'notStarted') return 'attention';
  if (label === 'withinPlan') return 'ok';
  if (label === 'split') return 'info';
  return 'muted';
}

/**
 * The small timing line used by a Do card.  Its comparison is per attempt:
 * aggregate group comparison belongs to execution details and must not tint this row.
 */
export default function DoTimeMeta({ item, ctx, t, className = '' }) {
  const record = item?.record || item;
  if (!record) return null;

  const timed = record.timing === DO_TIMING.TIMED;
  const duration = doDuration(record);
  const hasTimeRange = typeof record.startTime === 'string' && typeof record.endTime === 'string';
  if (!timed || !hasTimeRange) {
    if (!record.timing) return null;
    const text = translate(t, 'jobo.view.untimed', 'Untimed');
    return <span className={`jobo-time-meta jobo-time-meta-neutral ${className}`.trim()}
      data-jobo-time-meta="true" data-plan-state="unplanned" data-start-state="neutral"
      data-finish-state="neutral" data-duration-state="neutral" aria-label={text}>{text}</span>;
  }

  const states = attemptComparisonStates(record);
  const summary = timingSummary(record);
  const timingLabels = summary.labels;
  const leftArrow = item?.clippedStart ?? (record.date !== record.endDate);
  const rightArrow = item?.clippedEnd ?? (record.date !== record.endDate);
  const format = ctx?.formatTime || identity;
  const durationText = duration == null ? null : formatDuration(duration, typeof t === 'function' ? t : (key, values) => {
    if (key === 'common.durationMinutes') return `${values.minutes}m`;
    if (key === 'common.durationHours') return `${values.hours}h`;
    return `${values.hours}h ${values.minutes}m`;
  });
  const rangeLabel = `${leftArrow ? '← ' : ''}${formatClock(ctx, record.startTime)}–${formatClock(ctx, record.endTime)}${rightArrow ? ' →' : ''}`;
  const summaryLabels = timingLabels.map((label) => summaryText(t, label));
  const ariaLabel = [rangeLabel, durationText, ...summaryLabels].filter(Boolean).join(', ');
  const startAccessible = comparisonText(t, 'timeStart', states.comparison, states.comparison?.startTiming, 'startOffsetMinutes', formatClock(ctx, record.startTime));
  const finishAccessible = comparisonText(t, 'timeFinish', states.comparison, states.comparison?.finishTiming, 'finishOffsetMinutes', formatClock(ctx, record.endTime));
  const durationAccessible = durationText
    ? comparisonText(t, 'timeDuration', states.comparison, states.comparison?.durationComparison, 'durationDifferenceMinutes', durationText)
    : null;

  return <span className={`jobo-time-meta ${className}`.trim()}
    data-jobo-time-meta="true" data-plan-state={states.planState} aria-label={ariaLabel}>
    <span className={`jobo-time-meta-part is-${states.startState}`.trim()} data-jobo-time-dimension="start" data-state={states.startState}
      title={startAccessible} aria-label={startAccessible}>
      {leftArrow && <span aria-hidden="true">← </span>}{format(record.startTime)}
    </span>
    <span aria-hidden="true" className="jobo-time-meta-separator">–</span>
    <span className={`jobo-time-meta-part is-${states.finishState}`.trim()} data-jobo-time-dimension="finish" data-state={states.finishState}
      title={finishAccessible} aria-label={finishAccessible}>
      {format(record.endTime)}{rightArrow && <span aria-hidden="true"> →</span>}
    </span>
    {durationText && <span className={`jobo-time-meta-part jobo-time-meta-duration is-${states.durationState}`.trim()} data-jobo-time-dimension="duration" data-state={states.durationState}
      title={durationAccessible} aria-label={durationAccessible}>
      {durationText}
    </span>}
    {timingLabels.map((label) => {
      const text = summaryText(t, label);
      return <span key={label} className={`jobo-time-meta-status is-${summaryTone(label)}`.trim()}
        data-jobo-time-status={label} title={text} aria-label={text}>{text}</span>;
    })}
  </span>;
}
