import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import useJournalTimeline from '../hooks/useJournalTimeline.js';

export default function ActualTimelineLayer({
  dateStr,
  minToTop,
  clipStartMin = 0,
  clipEndMin = 1440,
}) {
  const { t, i18n } = useTranslation();
  const { darkMode, minutesToPosition, timeToMinutes, formatTime } = useDayPlannerCtx();
  const { actualForDate } = useJournalTimeline();
  const blocks = actualForDate(dateStr);
  const toTop = minToTop ?? minutesToPosition;
  const actualLabel = t('journal.actual', {
    defaultValue: i18n.resolvedLanguage?.startsWith('zh') ? '实际' : 'Actual',
  });

  if (!blocks.length) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-[8]" data-journal-actual-layer={dateStr}>
      {blocks.map(block => {
        const start = timeToMinutes(block.startTime || '00:00');
        const end = start + Math.max(1, Number(block.duration) || 30);
        if (end <= clipStartMin || start >= clipEndMin) return null;

        const visibleStart = Math.max(start, clipStartMin);
        const visibleEnd = Math.min(end, clipEndMin);
        const top = Math.round(toTop(visibleStart));
        const bottom = Math.round(toTop(visibleEnd));
        const height = Math.max(18, bottom - top - 1);
        const showDetails = height >= 42;

        return (
          <div
            key={block.id}
            role="note"
            aria-label={`${actualLabel}: ${block.title}`}
            data-journal-actual-id={block.id}
            className={`absolute left-1 right-1 overflow-hidden rounded-md border-2 ${darkMode ? 'text-stone-50 border-stone-100/80' : 'text-stone-900 border-stone-900/75'}`}
            style={{
              top: `${top}px`,
              height: `${height}px`,
              backgroundColor: darkMode ? 'rgba(12, 10, 9, 0.88)' : 'rgba(250, 250, 249, 0.92)',
              backgroundImage: darkMode
                ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 6px, transparent 6px 12px)'
                : 'repeating-linear-gradient(135deg, rgba(28,25,23,0.045) 0 6px, transparent 6px 12px)',
              boxShadow: darkMode
                ? 'inset 4px 0 0 rgba(250,250,249,0.85), 0 2px 8px rgba(0,0,0,0.28)'
                : 'inset 4px 0 0 rgba(28,25,23,0.8), 0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <div className="h-full px-2 py-1 pl-3 flex flex-col justify-start min-w-0">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider opacity-70 flex-shrink-0">
                  {actualLabel}
                </span>
                <span className="text-xs font-semibold truncate">{block.title}</span>
              </div>
              {showDetails && (
                <div className="text-[10px] opacity-70 truncate">
                  {formatTime(block.startTime)} · {t('common.minutesShort', { count: block.duration, defaultValue: '{{count}} min' })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
