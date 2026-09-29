import React from 'react';
import { Check, Clock } from 'lucide-react';
import { summarizeTiming } from '../../jobo/core.js';
import { formatDuration } from '../../utils/formatDuration.js';

function translate(t, key, defaultValue, values = {}) {
  return t(key, { ...values, defaultValue });
}

/**
 * An offset as people read it: minutes under an hour ("45 min"), the app's
 * compact duration under a day ("2h 15m"), and days and hours beyond that
 * ("1d 22h"), where minutes stop meaning anything.
 */
export function formatOffset(minutes, t) {
  const total = Math.max(0, Math.round(Math.abs(Number(minutes) || 0)));
  if (total < 60) return t('jobo.view.offsetMinutes', { minutes: total });
  if (total < 1440) return formatDuration(total, t);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  return hours ? t('jobo.view.offsetDaysHours', { days, hours }) : t('jobo.view.offsetDays', { days });
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
    text: t(`jobo.view.${group}.${state}`, { amount: formatOffset(minutes, t) }),
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
    .filter((row) => Number.isFinite(row.minutes) && row.minutes >= 0);
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
  return canonical.map((label) => {
    // Core's "late" means the start or the finish was late. Say which, so
    // the label agrees with the lines under it ("Started on time" beside
    // "Late" read as a contradiction).
    const shown = label === 'late' && comparison
      ? (comparison.startTiming === 'late' ? 'startedLate' : 'finishedLate')
      : label;
    return {
    key: label,
    text: shown === 'timeIncomplete'
      ? t('jobo.view.timeIncompleteShort')
      : t(`jobo.view.summary.${shown}`, { defaultValue: shown }),
    title: label === 'timeIncomplete' ? t('jobo.view.timeIncomplete') : undefined,
    };
  });
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
  const hasEstimated = comparisonMeta?.hasEstimatedAttempts;
  const hasUntimed = comparison?.metrics?.untimedAttemptCount > 0 || comparisonMeta?.hasUntimedAttempts;
  const progressLabel = latestAttempt
    ? latestAttempt.progress === 'completed'
      ? t('common.completed')
      : t(`jobo.view.progress.${latestAttempt.progress}`)
    : null;

  return <div className="grid gap-3 my-3">
    <section className="min-w-0 pt-2 border-t border-stone-300 dark:border-gray-600 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-1 [&_h3]:font-semibold [&_h3]:mb-2 [&_dl]:grid [&_dl]:gap-1 [&_dl>div]:flex [&_dl>div]:gap-2 [&_dt]:w-24 [&_dt]:shrink-0 [&_dt]:opacity-70 [&_dd]:min-w-0 [&_dd]:break-words" data-jobo-execution-axis="timing" aria-labelledby="jobo-time-axis-title">
      <h3 id="jobo-time-axis-title"><Clock size={14} aria-hidden="true" />{translate(t, 'jobo.view.timeAxis', 'Time performance')}</h3>
      {canonical.length > 0 && <div className="flex flex-wrap gap-1 mb-2 [&_span]:rounded [&_span]:bg-black/5 dark:[&_span]:bg-white/10 [&_span]:px-1 [&_span]:py-0.5" data-jobo-timing-summary>
        {canonical.map((row) => <span key={row.key} title={row.title}>{row.text}</span>)}
      </div>}
      {detailTiming.length > 0 && <dl className="text-xs">
        {detailTiming.map((row) => <div key={row.key} data-jobo-timing-row={row.key}>
          <dt>{row.key === 'incomplete' ? t('jobo.view.timeIncompleteShort') : row.key === 'start' ? t('jobo.view.timeStartLabel', { defaultValue: 'Start' }) : row.key === 'finish' ? t('jobo.view.timeFinishLabel', { defaultValue: 'Finish' }) : row.key === 'duration' ? t('jobo.view.timeDurationLabel', { defaultValue: 'Duration' }) : ''}</dt>
          <dd>{row.text}</dd>
        </div>)}
      </dl>}
      {hasEstimated && <p>{t('jobo.view.inferredHint')}</p>}
      {(hasEstimated || hasUntimed) && metrics.length > 0 && <p>{t('jobo.view.measuredOnly')}</p>}
      {metrics.length > 0 && <dl className="mt-2 text-[11px] opacity-90">
        {metrics.map((row) => <div key={row.key}><dt>{row.key === 'recordedMinutes' ? t('jobo.view.recordedLabel', { defaultValue: 'Recorded' }) : row.key === 'activeMinutes' ? t('jobo.view.activeLabel', { defaultValue: 'Active' }) : row.key === 'elapsedMinutes' ? t('jobo.view.elapsedLabel', { defaultValue: 'Elapsed' }) : row.key === 'gapMinutes' ? t('jobo.view.gapLabel', { defaultValue: 'Gaps' }) : t('jobo.view.overlapLabel', { defaultValue: 'Overlap' })}</dt><dd>{row.text}</dd></div>)}
      </dl>}
      {!canonical.length && !detailTiming.length && !metrics.length && !hasUntimed && !hasEstimated && <p className="mt-1 opacity-70">{t('jobo.view.noAttemptsShort')}</p>}
    </section>
    <section className="min-w-0 pt-2 border-t border-stone-300 dark:border-gray-600 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-1 [&_h3]:font-semibold [&_h3]:mb-2 [&_dl]:grid [&_dl]:gap-1 [&_dl>div]:flex [&_dl>div]:gap-2 [&_dt]:w-24 [&_dt]:shrink-0 [&_dt]:opacity-70 [&_dd]:min-w-0 [&_dd]:break-words" data-jobo-execution-axis="completion" aria-labelledby="jobo-progress-axis-title">
      <h3 id="jobo-progress-axis-title"><Check size={14} aria-hidden="true" />{translate(t, 'jobo.view.completionAxis', 'Completion')}</h3>
      {latestAttempt && <p className="mt-1 flex gap-1" data-progress={latestAttempt.progress}><span>{t('jobo.view.latestShort')}:</span> {progressLabel}</p>}
      {!records.length && <p className="mt-1 opacity-70">{t('jobo.view.noAttempts')}</p>}
      {children}
    </section>
  </div>;
}
