import React from 'react';
import { ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { ZOOM_MAX, ZOOM_STEP, zoomFor, zoomMin } from '../utils/timelineZoom.js';

// Settings' home for timeline magnification (utils/timelineZoom.js): one
// level per scrolling timeline, saved on this device. A level is set once
// per screen and left alone, so it lives here rather than in a header; a
// pinch or Ctrl+scroll over the timeline adjusts it in place.
const levels = (view) => {
  const out = [];
  for (let z = zoomMin(view); z <= ZOOM_MAX + 1e-9; z += ZOOM_STEP) out.push(Math.round(z * 10) / 10);
  return out;
};

export default function TimelineSizeSettings({ joboEnabled = false }) {
  const { t } = useTranslation();
  const { timelineZooms, setTimelineZoom, darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  if (typeof setTimelineZoom !== 'function') return null;
  const views = ['multi', 'week', ...(joboEnabled ? ['jobo'] : [])];
  return (
    <div className="space-y-3" data-timeline-size-settings>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <ZoomIn size={16} className={textSecondary} />
        {t('timelineZoom.label')}
      </h4>
      <div className="flex flex-wrap gap-3">
        {views.map((view) => (
          <label key={view} className={`flex items-center gap-1.5 text-xs ${textSecondary}`}>
            <span className="uppercase font-medium">{view}</span>
            <select
              data-timeline-size={view}
              value={zoomFor(timelineZooms, view)}
              onChange={(e) => setTimelineZoom(view, Number(e.target.value))}
              className={`px-2 py-1 text-xs rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              {levels(view).map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className={`text-[10px] ${textSecondary} opacity-70`}>{t('timelineZoom.hint')}</p>
    </div>
  );
}
