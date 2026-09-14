import React, { useMemo } from 'react';
import { CheckCircle, Clock, Inbox, Target, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { monthStats } from '../../utils/monthStats.js';
import { monthOf } from '../../utils/monthGrid.js';
import { dateToString } from '../../utils/taskUtils.js';

/**
 * The month's headline numbers in the MONTH header row: a row of stat tiles
 * (label over value, one measure each) that fills whatever width it is
 * given. The All-Time Summary's definitions over one month, through today
 * (utils/monthStats.js): completion with a progress bar, tasks done with the
 * incomplete count, inbox tasks done, time spent against time planned, and
 * focus time when any was logged. A future month has nothing to report and
 * renders nothing.
 *
 * Values wear the text tokens; the icons carry the summary's colours so the
 * tiles read as the same figures as the summary sheet.
 *
 * @param {object} props
 * @param {string}  [props.className]  sizing in the header row (flex-1 ...)
 * @param {boolean} [props.dense]      sharing the row with the day's header: the
 *                                     side notes (incomplete, of planned) move to the tooltip
 * @param {boolean} [props.compact]    the phone header: the percentage with a short
 *                                     progress bar over the ratio, nothing else
 */
export default function MonthStats({ className = '', dense = false, compact = false }) {
  const { t, i18n } = useTranslation();
  const planner = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const { selectedDate, tasks, unscheduledTasks, recurringTasks, textPrimary, textSecondary, borderClass } = planner;
  const isVisibleForUser = planner.isVisibleForUser || features.isVisibleForUser;
  const today = dateToString(new Date());
  const { year, month } = monthOf(dateToString(selectedDate));
  const stats = useMemo(
    () => monthStats({ tasks, unscheduledTasks, recurringTasks, year, month, today, isVisibleForUser }),
    [tasks, unscheduledTasks, recurringTasks, year, month, today, isVisibleForUser],
  );
  if (!stats.counted) return null;

  const lang = i18n.resolvedLanguage || i18n.language;
  const percentText = stats.percent === null ? '–' : new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(stats.percent / 100);
  const duration = (min) => {
    const m = Math.max(0, Math.round(min));
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h === 0) return t('weeklyReview.durationMinutes', { minutes: rem });
    if (rem === 0) return t('weeklyReview.durationHours', { hours: h });
    return t('weeklyReview.durationHoursMinutes', { hours: h, minutes: rem });
  };
  const ratio = t('app.completedRatio', { done: stats.completed, total: stats.scheduled });
  const incomplete = stats.incomplete > 0 ? t('app.incompleteCount', { count: stats.incomplete }) : null;
  const dataAttrs = {
    'data-month-stats': '',
    'data-month-stats-scheduled': stats.scheduled,
    'data-month-stats-completed': stats.completed,
    'data-month-stats-incomplete': stats.incomplete,
    'data-month-stats-percent': stats.percent ?? '',
    'data-month-stats-inbox-done': stats.inboxDone,
    'data-month-stats-planned-minutes': stats.plannedMinutes,
    'data-month-stats-spent-minutes': stats.spentMinutes,
    'data-month-stats-focus-minutes': stats.focusMinutes,
  };
  const title = [
    `${t('app.completionRate')}: ${percentText}`,
    `${t('app.tasksCompleted')}: ${ratio}`,
    `${t('app.inboxDone')}: ${stats.inboxDone}`,
    `${t('app.timeSpent')}: ${duration(stats.spentMinutes)}`,
    `${t('app.timePlanned')}: ${duration(stats.plannedMinutes)}`,
    stats.focusMinutes > 0 ? `${t('app.focusTime')}: ${duration(stats.focusMinutes)}` : null,
  ].filter(Boolean).join(' · ') + ` (${t('month.statsHint')})`;

  if (compact) {
    return (
      <div
        {...dataAttrs}
        title={title}
        className={`flex-shrink-0 flex flex-col items-end justify-center px-2 leading-tight tabular-nums ${className}`}
      >
        <span className="flex items-center gap-1.5">
          <span className={`text-sm font-semibold ${textPrimary}`}>{percentText}</span>
          <span className="h-1 w-12 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${stats.percent ?? 0}%` }} />
          </span>
        </span>
        <span className={`text-[10px] ${textSecondary} whitespace-nowrap`}>{ratio}</span>
      </div>
    );
  }

  // Tiles share the width evenly and never shrink past a readable minimum;
  // a row too narrow for all of them scrolls sideways rather than clipping.
  const tile = 'flex-1 min-w-[8.5rem] px-3 py-1 flex flex-col justify-center gap-0.5';
  // Sharing the row with the day's header on a narrow desktop, the two
  // secondary tiles step aside below xl; the tooltip keeps their figures.
  const secondary = dense ? 'hidden xl:flex' : '';
  const label = `text-[10px] uppercase tracking-wide leading-none whitespace-nowrap flex items-center gap-1 ${textSecondary}`;
  const value = `text-sm font-semibold leading-tight tabular-nums whitespace-nowrap flex items-baseline gap-1.5 ${textPrimary}`;
  const sub = `text-[11px] font-normal ${textSecondary}`;
  return (
    <div {...dataAttrs} data-month-stats-dense={dense ? '' : undefined} title={title} className={`min-w-0 flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      <div data-month-stats-tile="completion" className={`${tile} border-l ${borderClass}`}>
        <div className={label}><Trophy size={10} className="text-amber-400" />{t('app.completionRate')}</div>
        <div className={value}>{percentText}</div>
        <div className="h-1 w-full max-w-[12rem] rounded-full bg-black/10 dark:bg-white/10 overflow-hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-brand" style={{ width: `${stats.percent ?? 0}%` }} />
        </div>
      </div>
      <div data-month-stats-tile="tasks" className={`${tile} border-l ${borderClass}`}>
        <div className={label}><CheckCircle size={10} className="text-green-500" />{t('app.tasksCompleted')}</div>
        <div className={value}>
          {stats.completed}<span className={sub}>/ {stats.scheduled}</span>
          {incomplete && !dense && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{incomplete}</span>}
        </div>
      </div>
      <div data-month-stats-tile="inbox" className={`${tile} ${secondary} border-l ${borderClass}`}>
        <div className={label}><Inbox size={10} className="text-amber-400" />{t('app.inboxDone')}</div>
        <div className={value}>{stats.inboxDone}</div>
      </div>
      <div data-month-stats-tile="time" className={`${tile} border-l ${borderClass}`}>
        <div className={label}><Clock size={10} className="text-orange-400" />{t('app.timeSpent')}</div>
        <div className={value}>
          {duration(stats.spentMinutes)}
          {!dense && <span className={sub}>{t('month.ofPlanned', { planned: duration(stats.plannedMinutes) })}</span>}
        </div>
      </div>
      {stats.focusMinutes > 0 && (
        <div data-month-stats-tile="focus" className={`${tile} ${secondary} border-l ${borderClass}`}>
          <div className={label}><Target size={10} className="text-purple-400" />{t('app.focusTime')}</div>
          <div className={value}>{duration(stats.focusMinutes)}</div>
        </div>
      )}
    </div>
  );
}
