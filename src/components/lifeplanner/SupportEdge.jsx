import React from 'react';
import { BaseEdge, getBezierPath } from '@xyflow/react';
import { MAP_HEIGHT, MAP_WIDTH } from '../../lifeplanner/lifeMap.js';

// Same-level nodes normally share a column. Route beside it and through the
// gap below the target instead of drawing a diagonal through intervening cards.
export default function SupportEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, markerEnd, style, label, data } = props;
  let [path, labelX, labelY] = getBezierPath(props);
  if (Math.abs(sourceX - targetX - MAP_WIDTH) < 24 && Math.abs(sourceY - targetY) > MAP_HEIGHT) {
    const right = Math.max(sourceX, targetX + MAP_WIDTH) + 36 + (data?.routeSlot || 0) * 22;
    const left = targetX - 18, gap = targetY + MAP_HEIGHT * .22 + 12;
    path = `M ${sourceX},${sourceY} H ${right} V ${gap} H ${left} V ${targetY} H ${targetX}`;
    labelX = right; labelY = (sourceY + targetY) / 2;
  }
  return <BaseEdge id={id} path={path} labelX={labelX} labelY={labelY} label={label}
    markerEnd={markerEnd} style={{ ...style, strokeLinejoin: 'round' }} interactionWidth={18} />;
}
