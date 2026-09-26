import React from 'react';
import { Check, Clock } from 'lucide-react';
import { summarizeTiming } from '../../jobo/core.js';
import './PrototypeBadges.css';

const SUMMARY_TONES = Object.freeze({
  withinPlan: 'ok',
  late: 'attention',
  longer: 'attention',
  split: 'info',
  notStarted: 'danger',
  unplanned: 'muted',
});

// Summarise the comparison supplied by core; these are presentation choices,
// never progress transitions or a replacement for the native task checkbox.
export function comparisonBadges(comparison, t) {
  if (!comparison) return [];
  const { metrics, comparable, notStarted, planContext } = comparison;
  if (metrics.untimedAttemptCount) return [{ key: 'incomplete', tone: 'muted', text: t('jobo.view.timeIncompleteShort'), title: t('jobo.view.timeIncomplete') }];
  if (notStarted) return [{ key: 'not-started', tone: 'muted', text: t('jobo.view.noAttemptsShort') }];
  if (planContext === 'noPlan') return [{ key: 'no-plan', tone: 'muted', text: t('jobo.view.summary.unplanned') }];
  if (!comparable) return [];
  return [
    { key: 'start', text: t(`jobo.view.timeStartShort.${comparison.startTiming}`, { minutes: Math.abs(metrics.startOffsetMinutes) }), title: t(`jobo.view.timeStart.${comparison.startTiming}`, { minutes: Math.abs(metrics.startOffsetMinutes) }), attention: comparison.startTiming === 'late', deviation: comparison.startTiming !== 'onTime' },
    { key: 'finish', text: t(`jobo.view.timeFinishShort.${comparison.finishTiming}`, { minutes: Math.abs(metrics.finishOffsetMinutes) }), title: t(`jobo.view.timeFinish.${comparison.finishTiming}`, { minutes: Math.abs(metrics.finishOffsetMinutes) }), attention: comparison.finishTiming === 'late', deviation: comparison.finishTiming !== 'onTime' },
    { key: 'duration', text: t(`jobo.view.timeDurationShort.${comparison.durationComparison}`, { minutes: Math.abs(metrics.durationDifferenceMinutes) }), title: t(`jobo.view.timeDuration.${comparison.durationComparison}`, { minutes: Math.abs(metrics.durationDifferenceMinutes) }), attention: comparison.durationComparison === 'longer', deviation: comparison.durationComparison !== 'onEstimate' },
  ].map(badge => ({ ...badge, tone: badge.attention ? 'attention' : 'neutral' }));
}

/**
 * The compact Plan card has two independent axes.  The completion axis is
 * the latest execution state; the timing axis uses the canonical summary
 * labels produced by the view model.  The raw start/finish/duration values
 * remain in the details panel, so a narrow card never has to choose one
 * dimension and silently hide the others.
 */
export function summaryBadges(item, t) {
  const labels = Array.isArray(item?.labels) ? item.labels : [];
  const incomplete = item?.comparisonMeta?.hasUntimedAttempts
    || item?.comparison?.metrics?.untimedAttemptCount > 0;
  const canonicalLabels = incomplete
    ? ['timeIncomplete', ...labels.filter((label) => label !== 'timeIncomplete')]
    : labels;
  return canonicalLabels.map((label) => ({
    key: label,
    text: label === 'timeIncomplete'
      ? t('jobo.view.timeIncompleteShort')
      : t(`jobo.view.summary.${label}`, { defaultValue: label }),
    title: label === 'timeIncomplete' ? t('jobo.view.timeIncomplete') : undefined,
    tone: SUMMARY_TONES[label] || 'muted',
  }));
}

function fallbackSummary(item, t) {
  // Older callers/tests may provide only a comparison.  Keep those cards
  // readable while the normal view-model path uses `item.labels` above.
  const comparison = item?.comparison;
  if (!comparison) return [];
  try {
    return summaryBadges({
      labels: summarizeTiming(comparison),
      comparison,
      comparisonMeta: item.comparisonMeta,
    }, t);
  } catch {
    return [];
  }
}

export default function PlanExecutionBadges({ item, t, onDetails, availableHeight }) {
  const summaries = summaryBadges(item, t);
  const timingAxis = summaries.length ? summaries : fallbackSummary(item, t);
  const progress = item.latestProgress || item.latestAttempt?.progress;
  const progressLabel = progress && (progress === 'completed' ? t('common.completed') : t(`jobo.view.progress.${progress}`));
  const latestLabel = progress && t('jobo.view.latestAttempt', { progress: progressLabel });
  const timingTitle = timingAxis.map(badge => badge.title || badge.text).join(' · ');
  const showAll = availableHeight >= 48;
  const visibleTiming = showAll ? timingAxis : timingAxis.slice(0, 1);
  const hiddenTimingCount = Math.max(0, timingAxis.length - visibleTiming.length);
  return <div className={`jobo-s5-proto-status-badges ${availableHeight >= 48 ? 'can-wrap' : ''}`}>
    {progress && <button type="button" className="jobo-s5-proto-status-badge jobo-s5-proto-progress-badge" data-axis="progress" data-progress={progress} title={latestLabel} aria-label={latestLabel} aria-haspopup="dialog"
      onClick={(event) => { event.stopPropagation(); onDetails(event.currentTarget); }}>
      <Check size={11} aria-hidden="true" /><span>{progressLabel}</span>
    </button>}
    {visibleTiming.length > 0 && <span className="jobo-s5-proto-timing-axis" data-axis="timing" title={timingTitle}>
      {visibleTiming.map((badge) => <button key={badge.key} type="button" className={`jobo-s5-proto-status-badge jobo-s5-proto-time-badge is-${badge.tone}`} aria-label={`${badge.text}. ${t('jobo.view.details')}`} aria-haspopup="dialog"
        onClick={(event) => { event.stopPropagation(); onDetails(event.currentTarget); }}>
        <Clock size={11} aria-hidden="true" /><span title={badge.title}>{badge.text}</span>
      </button>)}
      {hiddenTimingCount > 0 && <small className="jobo-s5-proto-more" aria-hidden="true">+{hiddenTimingCount}</small>}
    </span>}
  </div>;
}
