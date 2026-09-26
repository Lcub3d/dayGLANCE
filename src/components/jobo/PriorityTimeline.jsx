import React, { useMemo } from 'react';
import {
  buildPriorityTimeline,
  visibleSegment,
} from './TimelineComparison.js';
import './TimelineComparison.css';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function segmentStyle(segment, startHour, scale, height) {
  const visible = visibleSegment(segment, startHour, scale, height);
  if (!visible) return null;
  return {
    top: `${visible.top}px`,
    height: `${visible.height}px`,
    '--jobo-priority-color': visible.color || 'transparent',
  };
}

function Segment({ segment, side, startHour, scale, height }) {
  const style = segmentStyle(segment, startHour, scale, height);
  if (!style) return null;
  const isGap = segment.kind === 'gap';
  return <span className={`jobo-priority-segment jobo-priority-segment-${side} ${isGap ? 'jobo-priority-segment-gap' : ''}`.trim()}
    style={style} data-jobo-priority-segment={side} data-segment-kind={segment.kind}
    data-start-minute={segment.startMinute} data-end-minute={segment.endMinute}
    data-priority={segment.priority == null ? 'gap' : segment.priority}
    aria-hidden="true" />;
}

/**
 * A pointer-transparent 46px priority ruler.  It is intended to sit inside
 * the existing time ruler: current Plans occupy the left 23px and Do rows the
 * right 23px, while the hour labels and drag separator stay above it.
 */
export default function PriorityTimeline({
  plans = [],
  timedRecords = [],
  startHour = 0,
  height,
  scale,
  className = '',
}) {
  const safeStartHour = Math.max(0, Math.min(24, Number(startHour) || 0));
  const inferredScale = finite(height) && height > 0
    ? height / Math.max(1, 24 - safeStartHour)
    : 60;
  const pxPerHour = finite(scale) && scale > 0 ? scale : inferredScale;
  const totalHeight = finite(height) && height >= 0 ? height : Math.max(0, 24 - safeStartHour) * pxPerHour;
  const segments = useMemo(() => buildPriorityTimeline({ plans, timedRecords }), [plans, timedRecords]);
  const renderSide = (side) => segments[side].map((segment, index) => (
    <Segment key={`${side}:${segment.startMinute}:${segment.endMinute}:${index}`} segment={segment} side={side}
      startHour={safeStartHour} scale={pxPerHour} height={totalHeight} />
  ));

  return <div className={`jobo-priority-timeline ${className}`.trim()} data-jobo-priority-timeline="true"
    style={{ height: `${totalHeight}px` }} aria-hidden="true">
    <span className="jobo-priority-half jobo-priority-half-plan" data-jobo-priority-half="plan" />
    <span className="jobo-priority-half jobo-priority-half-do" data-jobo-priority-half="do" />
    <span className="jobo-priority-segments jobo-priority-segments-plan">{renderSide('plan')}</span>
    <span className="jobo-priority-segments jobo-priority-segments-do">{renderSide('do')}</span>
  </div>;
}
