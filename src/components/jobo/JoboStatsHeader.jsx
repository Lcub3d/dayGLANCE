import React, { useMemo } from 'react';
import { CheckCircle, Clock, LogIn, LogOut, Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { summaryPillClass } from '../SummaryStrip.jsx';
import { formatDuration } from '../../utils/formatDuration.js';
import { summarizeJoboDayModel } from '../../jobo/dayStats.js';

// The original five headline dimensions, in DAY's existing pill treatment.
// No click-to-Check dialog: the journal remains a separate slice 7 concern.
export default function JoboStatsHeader({ model, ctx }) {
  const { t, i18n } = useTranslation();
  const stats = useMemo(() => summarizeJoboDayModel(model), [model]);
  if (!stats) return null;
  const number = new Intl.NumberFormat(i18n?.resolvedLanguage || i18n?.language);
  const count = value => value == null ? '—' : number.format(value);
  const duration = value => value == null ? '—' : formatDuration(value, t);
  const c = stats.comparison;
  const compared = c.comparableCount > 0;
  const ratio = value => compared ? `${count(value)} / ${count(c.comparableCount)}` : '—';
  const details = (dimension) => {
    const values = c[dimension];
    return `${t('jobo.stats.comparisonScope')} ${t('jobo.stats.breakdown', {
      early: count(values[dimension === 'duration' ? 'shorter' : 'early']),
      on: count(values[dimension === 'duration' ? 'onEstimate' : 'onTime']),
      excluded: count(c.excludedCount),
    })}`;
  };
  const pills = [
    ['native', CheckCircle, t('jobo.stats.native'), `${count(stats.native.completed)} / ${count(stats.native.total)}`, t('jobo.stats.nativeScope')],
    ['time', Clock, t('jobo.stats.recorded'), duration(stats.recordedMinutes), `${t('jobo.stats.timeScope')} ${t('jobo.stats.timeDetails', {
      planned: duration(stats.native.plannedMinutes), untimed: count(stats.untimedCount), inferred: count(stats.inferredCount),
    })}`],
    ['start', LogIn, t('jobo.stats.lateStart'), ratio(c.start.late), details('start')],
    ['finish', LogOut, t('jobo.stats.lateFinish'), ratio(c.finish.late), details('finish')],
    ['duration', Hourglass, t('jobo.stats.longer'), ratio(c.duration.longer), details('duration')],
  ];
  return (
    <div data-jobo-stats className={`col-span-2 min-w-0 ml-16 px-3 py-1.5 border-t ${ctx.borderClass} font-normal`}
      role="group" aria-label={t('jobo.stats.title')}>
      <dl className="flex flex-wrap items-center gap-1.5 text-xs min-w-0">
        {pills.map(([key, Icon, label, value, hint]) => (
          <div key={key} data-jobo-stat={key} className={`${summaryPillClass(ctx.darkMode)} max-w-full flex-wrap`} title={hint}>
            <Icon size={12} className={`flex-shrink-0 ${ctx.textSecondary}`} aria-hidden="true" />
            <dt className={ctx.textSecondary}>{label}</dt>
            <dd className={`font-semibold tabular-nums ${ctx.textPrimary}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={`text-[10px] leading-snug mt-1 ${ctx.textSecondary}`}>
        {stats.invalidCount ? t('jobo.view.invalidRecords', { count: stats.invalidCount }) : t('jobo.stats.scope', {
          comparable: count(c.comparableCount), total: count(c.groupCount), untimed: count(stats.untimedCount),
        })}
      </p>
    </div>
  );
}
