import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import useJournalTimeline from '../hooks/useJournalTimeline.js';

export default function PlanHistoryLayer({
  dateStr,
  minToTop,
  clipStartMin = 0,
  clipEndMin = 1440,
}) {
  const { t, i18n } = useTranslation();
  const { darkMode, minutesToPosition, timeToMinutes, formatTime } = useDayPlannerCtx();
  const { historicalForDate } = useJournalTimeline();
  const plans = historicalForDate(dateStr);
  const toTop = minToTop ?? minutesToPosition;
  const originalPlanLabel = t('journal.originalPlan', {
    defaultValue: i18n.resolvedLanguage?.startsWith('zh') ? '原计划' : 'Original plan',
  });

  if (!plans.length) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-0" data-journal-plan-history={dateStr}>
      {plans.map(plan => {
        const start = timeToMinutes(plan.startTime || '00:00');
        const end = start + Math.max(1, Number(plan.duration) || 30);
        if (end <= clipStartMin || start >= clipEndMin) return null;

        const visibleStart = Math.max(start, clipStartMin);
        const visibleEnd = Math.min(end, clipEndMin);
        const top = Math.round(toTop(visibleStart));
        const bottom = Math.round(toTop(visibleEnd));
        const height = Math.max(18, bottom - top - 1);
        const showDetails = height >= 42;

        return (
          <div
            key={`historical-plan:${plan.taskId}:${plan.date}:${plan.startTime}`}
            role="note"
            aria-label={`${originalPlanLabel}: ${plan.title}`}
            className={`absolute left-1 right-1 overflow-hidden rounded-md border-2 border-dashed ${darkMode ? 'text-stone-300 border-stone-400/55 bg-stone-950/10' : 'text-stone-600 border-stone-500/55 bg-white/10'}`}
            style={{ top: `${top}px`, height: `${height}px` }}
          >
            <div className="h-full px-2 py-1 flex flex-col justify-start min-w-0 opacity-70">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider flex-shrink-0">
                  {originalPlanLabel}
                </span>
                <span className="text-xs font-medium truncate">{plan.title}</span>
              </div>
              {showDetails && (
                <div className="text-[10px] opacity-75 truncate">
                  {formatTime(plan.startTime)} · {t('common.minutesShort', { count: plan.duration, defaultValue: '{{count}} min' })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
