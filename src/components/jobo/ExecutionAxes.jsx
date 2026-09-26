import React from 'react';
import { Check, Clock } from 'lucide-react';
import { summarizeTiming } from '../../jobo/core.js';
import './ExecutionAxes.css';

function translate(t, key, defaultValue, values = {}) {
  return t(key, { ...values, defaultValue });
}

export function timingRows(comparison, t) {
  if (!comparison) return [];
  const metrics = comparison.metrics || {};
  if (metrics.untimedAttemptCount > 0) {
    return [{ key: 'incomplete', text: t('jobo.view.timeIncomplete') }];
  }
  if (comparison.notStarted) {
    return [{ key: 'notStarted', text: t('jobo.view.summary.notStarted') }];
  }
  if (comparison.planContext === 'noPlan') {
    return [{ key: 'unplanned', text: t('jobo.view.summary.unplanned') }];
  }
  if (!comparison.comparable) return [];
  return [
    ['start', 'timeStart', comparison.startTiming, metrics.startOffsetMinutes],
    ['finish', 'timeFinish', comparison.finishTiming, metrics.finishOffsetMinutes],
    ['duration', 'timeDuration', comparison.durationComparison, metrics.durationDifferenceMinutes],
  ].map(([key, group, state, minutes]) => ({
    key,
    text: t(`jobo.view.${group}.${state}`, { minutes: Math.abs(minutes) }),
    state,
  }));
}

export function metricRows(comparison, comparisonMeta, t) {
  const mixed = comparison?.metrics?.untimedAttemptCount > 0;
  const source = mixed
    ? comparisonMeta?.measuredComparison?.metrics || comparisonMeta?.measured || comparison?.metrics || {}
    : comparison?.metrics || comparisonMeta?.measured || {};
  const definitions = [
    ['recordedMinutes', 'jobo.view.recordedMinutes', 'Recorded: {{minutes}} min'],
    ['activeMinutes', 'jobo.view.activeMinutes', 'Active: {{minutes}} min'],
    ['elapsedMinutes', 'jobo.view.elapsedMinutes', 'Elapsed: {{minutes}} min'],
    ['gapMinutes', 'jobo.view.gapMinutes', 'Gaps: {{minutes}} min'],
    ['overlapMinutes', 'jobo.view.overlapMinutes', 'Overlap: {{minutes}} min'],
  ];
  return definitions
    .map(([key, translationKey, defaultValue]) => ({
      key,
      minutes: source[key],
      text: translate(t, translationKey, defaultValue, { minutes: source[key] }),
    }))
    .filter((row) => Number.isFinite(row.minutes) && row.minutes > 0);
}

export function summaryRows(labels, comparison, t) {
  let canonical = Array.isArray(labels) ? labels : [];
  if (!canonical.length && comparison) {
    try {
      canonical = summarizeTiming(comparison);
    } catch {
      canonical = [];
    }
  }
  const incomplete = comparison?.metrics?.untimedAttemptCount > 0;
  if (incomplete && !canonical.includes('timeIncomplete')) canonical = ['timeIncomplete', ...canonical];
  return canonical.map((label) => ({
    key: label,
    text: label === 'timeIncomplete'
      ? t('jobo.view.timeIncompleteShort')
      : t(`jobo.view.summary.${label}`, { defaultValue: label }),
    title: label === 'timeIncomplete' ? t('jobo.view.timeIncomplete') : undefined,
  }));
}

/**
 * Details deliberately keeps the two dimensions visible as separate sections:
 * the timing evidence belongs to the captured Plan, while completion progress
 * belongs to the individual Do attempts.  This is display-only; it does not
 * infer completion or change ledger records.
 */
export default function ExecutionAxes({ comparison, comparisonMeta, latestAttempt, records = [], labels, t, children }) {
  const timing = timingRows(comparison, t);
  const canonical = summaryRows(labels, comparison, t);
  const detailTiming = timing.filter((row) => row.key !== 'incomplete');
  const metrics = metricRows(comparison, comparisonMeta, t);
  const hasUntimed = comparison?.metrics?.untimedAttemptCount > 0 || comparisonMeta?.hasUntimedAttempts;
  const progressLabel = latestAttempt
    ? latestAttempt.progress === 'completed'
      ? t('common.completed')
      : t(`jobo.view.progress.${latestAttempt.progress}`)
    : null;

  return <div className="jobo-s5-execution-axes">
    <section className="jobo-s5-execution-axis" data-jobo-execution-axis="timing" aria-labelledby="jobo-time-axis-title">
      <h3 id="jobo-time-axis-title"><Clock size={14} aria-hidden="true" />{translate(t, 'jobo.view.timeAxis', 'Time performance')}</h3>
      {canonical.length > 0 && <div className="jobo-s5-execution-summary" data-jobo-timing-summary>
        {canonical.map((row) => <span key={row.key} title={row.title}>{row.text}</span>)}
      </div>}
      {detailTiming.length > 0 && <dl className="jobo-s5-execution-timing-list">
        {detailTiming.map((row) => <div key={row.key} data-jobo-timing-row={row.key}>
          <dt>{row.key === 'incomplete' ? t('jobo.view.timeIncompleteShort') : row.key === 'start' ? t('jobo.view.timeStartLabel', { defaultValue: 'Start' }) : row.key === 'finish' ? t('jobo.view.timeFinishLabel', { defaultValue: 'Finish' }) : row.key === 'duration' ? t('jobo.view.timeDurationLabel', { defaultValue: 'Duration' }) : ''}</dt>
          <dd>{row.text}</dd>
        </div>)}
      </dl>}
      {metrics.length > 0 && <dl className="jobo-s5-execution-metrics">
        {metrics.map((row) => <div key={row.key}><dt>{row.key === 'recordedMinutes' ? t('jobo.view.recordedLabel', { defaultValue: 'Recorded' }) : row.key === 'activeMinutes' ? t('jobo.view.activeLabel', { defaultValue: 'Active' }) : row.key === 'elapsedMinutes' ? t('jobo.view.elapsedLabel', { defaultValue: 'Elapsed' }) : row.key === 'gapMinutes' ? t('jobo.view.gapLabel', { defaultValue: 'Gaps' }) : t('jobo.view.overlapLabel', { defaultValue: 'Overlap' })}</dt><dd>{row.text}</dd></div>)}
      </dl>}
      {!canonical.length && !detailTiming.length && !metrics.length && !hasUntimed && <p className="jobo-s5-execution-empty">{t('jobo.view.noAttemptsShort')}</p>}
    </section>
    <section className="jobo-s5-execution-axis" data-jobo-execution-axis="completion" aria-labelledby="jobo-progress-axis-title">
      <h3 id="jobo-progress-axis-title"><Check size={14} aria-hidden="true" />{translate(t, 'jobo.view.completionAxis', 'Completion')}</h3>
      {latestAttempt && <p className="jobo-s5-execution-latest" data-progress={latestAttempt.progress}><span>{t('jobo.view.latestShort')}:</span> {progressLabel}</p>}
      {!records.length && <p className="jobo-s5-execution-empty">{t('jobo.view.noAttempts')}</p>}
      {children}
    </section>
  </div>;
}
