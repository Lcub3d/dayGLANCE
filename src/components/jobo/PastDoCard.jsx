import React from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';

// A recorded Do on a past day, in DAY, MULTI and WEEK (slice 6,
// docs/jobo-past-days.md). The item comes from pastDayItems: task-shaped so
// each view's own layout places it, marked `joboDo`.
//
// Read-only everywhere: no drag, resize, checkbox or context menu. Clicking
// it opens the JOBO view on that date, where the record can be edited. The
// striped fill in the task's colour is the Do look in every view, JOBO's own
// recorded Do included, so a Do never passes for a plan block.

/** The Do stripes, laid over the card's own colour class. */
export const DO_STRIPES = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.24) 0 6px, transparent 6px 12px)';
const NEUTRAL = 'bg-gray-500';

const minuteOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function useDoText(item) {
  const { t } = useTranslation();
  const { formatTime, setViewMode, setSelectedDate } = useDayPlannerCtx() || {};
  const show = (time) => (typeof formatTime === 'function' ? formatTime(time) : time);
  const range = `${show(item.startTime)}–${show(clock(minuteOf(item.startTime) + item.duration))}`;
  const progress = item.joboProgress === 'completed' ? t('common.completed') : t(`jobo.view.progress.${item.joboProgress}`);
  const openInJobo = () => {
    setSelectedDate?.(new Date(`${item.date}T12:00:00`));
    setViewMode?.('jobo');
  };
  return { t, range, progress, openInJobo };
}

/** DAY and MULTI: the card, placed by the column's own layout (`style`). */
export default function PastDoCard({ item, style, showTime = true, zoom = 1 }) {
  const { t, range, progress, openInJobo } = useDoText(item);
  const stop = (event) => event.stopPropagation();
  return (
    <div
      data-jobo-past-do={item.joboRecordId}
      role="button"
      tabIndex={0}
      draggable={false}
      title={`${t('jobo.past.recorded', { range })} · ${progress}\n${t('jobo.past.open')}`}
      onClick={(event) => { event.stopPropagation(); openInJobo(); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); openInJobo(); } }}
      onMouseDown={stop}
      onPointerDown={stop}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      className={`absolute pointer-events-auto rounded-lg shadow-md overflow-hidden text-white cursor-pointer hover:brightness-95 ${item.color || NEUTRAL}`}
      style={{ backgroundImage: DO_STRIPES, ...style }}
    >
      <div className="px-2 py-1 h-full flex flex-col min-w-0" style={zoom !== 1 ? { zoom } : undefined}>
        <div className="font-semibold text-sm leading-tight truncate">{renderTitleWithoutTags(item.title)}</div>
        {showTime && (
          <div className="text-xs opacity-90 flex items-center gap-1 min-w-0 whitespace-nowrap">
            <Clock size={10} className="flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{range} · {progress}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** WEEK's click popup, for a Do chip: what was recorded, and the way to JOBO. */
export function PastDoDetails({ item, onClose }) {
  const { t, range, progress, openInJobo } = useDoText(item);
  return (
    <div data-jobo-past-do-details={item.joboRecordId} className="p-4 h-full flex flex-col gap-2 text-white">
      <div className="font-semibold leading-tight">{renderTitleWithoutTags(item.title)}</div>
      <div className="text-sm opacity-90 flex items-center gap-1.5">
        <Clock size={14} aria-hidden="true" />{t('jobo.past.recorded', { range })}
      </div>
      <div className="text-sm opacity-90">{progress}</div>
      <button type="button" className="mt-auto self-start px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-medium"
        onClick={(event) => { event.stopPropagation(); onClose?.(); openInJobo(); }}>
        {t('jobo.past.open')}
      </button>
    </div>
  );
}

/** WEEK's chip style for a Do: its own colour, striped. */
export const pastDoChipStyle = { backgroundImage: DO_STRIPES };
export const pastDoColor = (item) => item.color || NEUTRAL;
