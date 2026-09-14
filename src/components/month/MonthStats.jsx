import React, { useMemo } from 'react';
import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { monthStats } from '../../utils/monthStats.js';
import { monthOf } from '../../utils/monthGrid.js';
import { dateToString } from '../../utils/taskUtils.js';

/**
 * The month's headline numbers beside the day header in MONTH: done out of
 * scheduled, and the incomplete count when there is one. The All-Time
 * Summary's definitions over one month, through today (utils/monthStats.js).
 * A future month has nothing to report and renders nothing.
 *
 * @param {object} props
 * @param {boolean} [props.compact]  the phone header: two stacked lines, smaller
 */
export default function MonthStats({ compact = false }) {
  const { t } = useTranslation();
  const planner = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const { selectedDate, tasks, unscheduledTasks, recurringTasks, textSecondary } = planner;
  const isVisibleForUser = planner.isVisibleForUser || features.isVisibleForUser;
  const today = dateToString(new Date());
  const { year, month } = monthOf(dateToString(selectedDate));
  const stats = useMemo(
    () => monthStats({ tasks, unscheduledTasks, recurringTasks, year, month, today, isVisibleForUser }),
    [tasks, unscheduledTasks, recurringTasks, year, month, today, isVisibleForUser],
  );
  if (!stats.counted) return null;

  const ratio = t('app.completedRatio', { done: stats.completed, total: stats.scheduled });
  const incomplete = stats.incomplete > 0 ? t('app.incompleteCount', { count: stats.incomplete }) : null;
  return (
    <div
      data-month-stats
      data-month-stats-scheduled={stats.scheduled}
      data-month-stats-completed={stats.completed}
      data-month-stats-incomplete={stats.incomplete}
      title={`${t('app.tasksScheduled')}: ${stats.scheduled} · ${t('app.tasksCompleted')}: ${stats.completed} (${t('month.statsHint')})`}
      className={`flex-shrink-0 ${compact ? 'flex flex-col items-end justify-center pr-2 text-[10px] leading-tight' : 'flex items-center gap-3 px-3 text-xs'} ${textSecondary} tabular-nums`}
    >
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <CheckCircle size={compact ? 10 : 12} className="text-green-500" />
        {ratio}
      </span>
      {incomplete && (
        <span className="whitespace-nowrap text-amber-600 dark:text-amber-400">{incomplete}</span>
      )}
    </div>
  );
}
