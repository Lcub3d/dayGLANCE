import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { frameColorBg, frameColorBorder } from '../../utils/colorUtils.js';
import { timeToMinutes } from '../../utils/dayOccupancy.js';
import { dateToString } from '../../utils/taskUtils.js';
import './JoboTimeFrames.css';

/** Native GTD frame data, positioned in one JOBO lane's own time scale. */
export default function JoboTimeFrames({ date, startHour = 0, scale, height, lane = 'plan' }) {
  const { t } = useTranslation();
  const { darkMode } = useDayPlannerCtx();
  const { getFrameInstancesForDate, computeAvailableSlots, openFrameAdjust, setFrameContextMenu } = useFeaturesCtx();
  const day = date instanceof Date ? date : new Date(`${date}T12:00:00`);
  if (!Number.isFinite(day.getTime()) || !Number.isFinite(scale) || scale <= 0
    || !Number.isFinite(height) || height <= 0 || !Number.isFinite(startHour)) return null;

  const dateStr = dateToString(day);
  const clipStart = Math.max(0, startHour * 60);
  const clipEnd = Math.min(1440, startHour * 60 + height / scale * 60);
  const frames = getFrameInstancesForDate?.(day) || [];
  const intervalStyle = (start, end) => {
    const startMinute = timeToMinutes(start);
    const endMinute = timeToMinutes(end);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return null;
    const visibleStart = Math.max(clipStart, startMinute);
    const visibleEnd = Math.min(clipEnd, endMinute);
    if (visibleEnd <= visibleStart) return null;
    return {
      top: (visibleStart - startHour * 60) / 60 * scale,
      height: (visibleEnd - visibleStart) / 60 * scale,
    };
  };

  if (!frames.length) return null;
  return <div className="jobo-s5-time-frames" data-jobo-frames={lane} style={{ height }}>
    {frames.map(frame => {
      const position = intervalStyle(frame.start, frame.end);
      if (!position) return null;
      const border = frameColorBorder(frame.color, darkMode);
      const availableSlots = computeAvailableSlots?.(frame, day) || [];
      const label = `${frame.label} · ${frame.start}–${frame.end}`;
      return <React.Fragment key={frame.frameId}>
        <div className="jobo-s5-time-frame" data-jobo-frame={frame.frameId}
          style={{ ...position, background: frameColorBg(frame.color, darkMode), borderLeftColor: border }}>
          {/* Only the label handles pointers. The rest of the band leaves creation
              and Plan/Do drop gestures to the containing JOBO lane. */}
          {openFrameAdjust ? <button type="button" className="jobo-s5-frame-label" data-ctx-menu
            title={`${t('frames.adjustTime')}: ${label}`} aria-label={`${t('frames.adjustTime')}: ${label}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); openFrameAdjust(frame.frameId, dateStr); }}
            onContextMenu={event => {
              if (!setFrameContextMenu) return;
              event.preventDefault(); event.stopPropagation();
              setFrameContextMenu({ x: event.clientX, y: event.clientY, frameId: frame.frameId, dateStr });
            }}>
            {frame.label}
          </button> : <span className="jobo-s5-frame-label" title={label}>{frame.label}</span>}
        </div>
        {availableSlots.map((slot, index) => {
          const slotPosition = intervalStyle(slot.start, slot.end);
          if (!slotPosition || slotPosition.height < 4) return null;
          return <div key={`${frame.frameId}:${index}`} className="jobo-s5-frame-available"
            data-jobo-frame-available={frame.frameId} aria-hidden="true"
            style={{ ...slotPosition, borderColor: border }} />;
        })}
      </React.Fragment>;
    })}
  </div>;
}
