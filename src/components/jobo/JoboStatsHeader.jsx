import React, { useMemo } from 'react';
import { CheckCircle, Clock, LogIn, LogOut, Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { dateToString } from '../../utils/taskUtils.js';
import { formatDuration } from '../../utils/formatDuration.js';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { summarizeJoboDayModel } from '../../jobo/dayStats.js';

// CalendarHeader's date-row tiles, in MonthStats' label-over-value treatment.
// Reuse the same pure day model as the view, without estimates, drag previews,
// new state, or a cross-component writer. Loading is not an empty ledger.
export default function JoboStatsHeader({ className = '' }) {
  const { t, i18n } = useTranslation();
  const planner = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const { selectedDate, getTasksForDate, tasks, unscheduledTasks, expandedRecurringTasks,
    recurringTasks, textPrimary, textSecondary, borderClass } = planner;
  const { joboLoaded, joboRecords } = features;
  const isVisibleForUser = planner.isVisibleForUser || features.isVisibleForUser;
  const date = dateToString(selectedDate);
  const stats = useMemo(() => {
    if (!joboLoaded || !Array.isArray(joboRecords)) return null;
    const dayTasks = getTasksForDate(selectedDate, false).filter(task => !task.isAllDay && task.startTime);
    const model = buildJoboDayModel({
      date, tasks: dayTasks,
      taskLookup: [...(tasks || []), ...(unscheduledTasks || []), ...(expandedRecurringTasks || []), ...dayTasks],
      recurringTasks, records: joboRecords, isVisibleForUser,
    });
    return summarizeJoboDayModel(model);
  }, [date, selectedDate, getTasksForDate, tasks, unscheduledTasks, expandedRecurringTasks, recurringTasks,
    joboLoaded, joboRecords, isVisibleForUser]);
  if (!stats) return null;

  const number = new Intl.NumberFormat(i18n?.resolvedLanguage || i18n?.language);
  const count = value => value == null ? '—' : number.format(value);
  const duration = value => value == null ? '—' : formatDuration(value, t);
  const c = stats.comparison;
  const ratio = value => c.comparableCount > 0 ? `${count(value)} / ${count(c.comparableCount)}` : '—';
  const scope = stats.invalidCount ? t('jobo.view.invalidRecords', { count: stats.invalidCount }) : t('jobo.stats.scope', {
    comparable: count(c.comparableCount), total: count(c.groupCount), untimed: count(stats.untimedCount),
  });
  const details = dimension => {
    const values = c[dimension];
    return `${t('jobo.stats.comparisonScope')} ${t('jobo.stats.breakdown', {
      early: count(values[dimension === 'duration' ? 'shorter' : 'early']),
      on: count(values[dimension === 'duration' ? 'onEstimate' : 'onTime']),
      excluded: count(c.excludedCount),
    })}`;
  };
  const tiles = [
    ['native', CheckCircle, t('jobo.stats.native'), `${count(stats.native.completed)} / ${count(stats.native.total)}`, t('jobo.stats.nativeScope'), 'text-green-500', false],
    ['time', Clock, t('jobo.stats.recorded'), duration(stats.recordedMinutes), `${t('jobo.stats.timeScope')} ${t('jobo.stats.timeDetails', {
      planned: duration(stats.native.plannedMinutes), untimed: count(stats.untimedCount), inferred: count(stats.inferredCount),
    })}`, 'text-orange-400', false],
    ['start', LogIn, t('jobo.stats.lateStart'), ratio(c.start.late), details('start'), 'text-amber-500', false],
    ['finish', LogOut, t('jobo.stats.lateFinish'), ratio(c.finish.late), details('finish'), 'text-orange-400', true],
    ['duration', Hourglass, t('jobo.stats.longer'), ratio(c.duration.longer), details('duration'), 'text-purple-400', true],
  ];
  // Match MonthStats dense mode: keep the three primary measures visible and
  // step the two secondary tiles aside below xl. Their values remain available
  // in the parent/tile tooltips without creating a hidden-scroll affordance.
  const tile = 'flex-1 min-w-[8.5rem] px-3 py-1 flex flex-col justify-center gap-0.5';
  const label = `text-[10px] uppercase tracking-wide leading-none whitespace-nowrap flex items-center gap-1 ${textSecondary}`;
  const valueClass = `text-sm font-semibold leading-tight tabular-nums whitespace-nowrap flex items-baseline gap-1.5 ${textPrimary}`;
  return (
    <dl data-jobo-stats data-recorded-minutes={stats.recordedMinutes ?? ''}
      data-comparable-groups={c.comparableCount ?? ''} data-jobo-stats-date={date}
      role="group" aria-label={t('jobo.stats.title')} title={scope}
      className={`min-w-0 flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {tiles.map(([key, Icon, labelText, value, hint, tone, secondary]) => (
        <div key={key} data-jobo-stat={key} className={`${tile} ${secondary ? 'hidden xl:flex' : ''} border-l ${borderClass}`} title={`${hint} ${scope}`}>
          <dt className={label}><Icon size={10} className={tone} aria-hidden="true" />{labelText}</dt>
          <dd className={valueClass}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
