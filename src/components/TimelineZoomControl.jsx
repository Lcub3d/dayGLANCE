import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { ZOOM_MAX, isZoomView, stepZoom, zoomFor, zoomMin } from '../utils/timelineZoom.js';

// The header's magnifier for the scrolling timelines (MULTI, WEEK, JOBO):
// the view's own level, one step at a time, remembered per view on this
// device. Pinch or Ctrl+scroll over the timeline does the same
// (hooks/useTimelineZoom.js). Shown only in a view that zooms.
export default function TimelineZoomControl({ view }) {
  const { t } = useTranslation();
  const { timelineZooms, setTimelineZoom, darkMode, hoverBg, cardBg, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  if (!isZoomView(view) || typeof setTimelineZoom !== 'function') return null;
  const zoom = zoomFor(timelineZooms, view);
  const percent = `${Math.round(zoom * 100)}%`;
  const step = (dir) => setTimelineZoom(view, stepZoom(view, zoom, dir));
  const stepButton = `p-1.5 rounded-lg ${hoverBg} disabled:opacity-30 disabled:cursor-not-allowed`;

  return (
    <div ref={rootRef} className="relative" data-timeline-zoom={view}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${t('timelineZoom.label')}: ${percent}`}
        title={`${t('timelineZoom.label')}: ${percent}`}
        className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} flex items-center gap-1`}
      >
        <ZoomIn size={18} className={textSecondary} />
        {zoom !== 1 && <span className={`text-xs font-semibold tabular-nums ${textSecondary}`}>{percent}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t('timelineZoom.label')}
          className={`absolute right-0 top-full mt-2 z-50 w-56 p-3 rounded-xl border shadow-lg ${cardBg} ${borderClass}`}>
          <div className={`text-xs font-semibold mb-2 ${textSecondary}`}>{t('timelineZoom.label')}</div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={stepButton} onClick={() => step(-1)} disabled={zoom <= zoomMin(view)}
              aria-label={t('timelineZoom.smaller')} title={t('timelineZoom.smaller')}>
              <Minus size={16} className={textPrimary} />
            </button>
            <span data-timeline-zoom-level className={`text-sm font-semibold tabular-nums ${textPrimary}`}>{percent}</span>
            <button type="button" className={stepButton} onClick={() => step(1)} disabled={zoom >= ZOOM_MAX}
              aria-label={t('timelineZoom.larger')} title={t('timelineZoom.larger')}>
              <Plus size={16} className={textPrimary} />
            </button>
          </div>
          <button type="button" onClick={() => setTimelineZoom(view, 1)} disabled={zoom === 1}
            className={`mt-2 w-full text-xs py-1.5 rounded-lg ${hoverBg} ${textSecondary} disabled:opacity-40`}>
            {t('timelineZoom.reset')}
          </button>
          <p className={`mt-2 text-[11px] leading-snug ${textSecondary}`}>{t('timelineZoom.hint')}</p>
        </div>
      )}
    </div>
  );
}
