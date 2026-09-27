import { completionMarker } from './completionMarker.js';
import { assignOverlapColumns } from './viewModel.js';

export const DO_POINT_HEIGHT_PX = 40;
const DO_LAYOUT_GAP_PX = 2;
const DEFAULT_SCALE = 84;

const usableScale = scale => Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_SCALE;

function pointLayout(item, date, scale) {
  const marker = completionMarker(item?.record);
  if (!marker || marker.date !== date) return null;

  // The marker remains a point in the ledger. This interval is only a
  // temporary screen footprint so assignOverlapColumns can keep it clear of
  // cards whose visible height is larger than their measured interval.
  const halfHeightMinutes = (DO_POINT_HEIGHT_PX / 2) * 60 / scale;
  const footprintMinutes = (DO_POINT_HEIGHT_PX + DO_LAYOUT_GAP_PX) * 60 / scale;
  const displayStartMinute = Math.max(0, marker.startMinute - halfHeightMinutes);

  return {
    ...item,
    point: true,
    marker,
    displayStartMinute,
    displayHeightPx: DO_POINT_HEIGHT_PX,
    startMinute: displayStartMinute,
    endMinute: displayStartMinute + footprintMinutes,
    __doTimelinePoint: true,
  };
}

function restorePoint(item) {
  if (!item.__doTimelinePoint) return item;
  const { __doTimelinePoint, ...point } = item;
  return {
    ...point,
    startMinute: point.marker.startMinute,
    endMinute: point.marker.endMinute,
  };
}

/**
 * Place timed Do cards and untimed completion points in one visual column
 * layout. Completion points use a temporary pixel footprint for collision
 * detection, then regain their canonical zero-length interval before return.
 */
export function layoutDoTimeline(timedItems = [], untimedItems = [], { date, scale } = {}) {
  const layoutScale = usableScale(scale);
  const points = (Array.isArray(untimedItems) ? untimedItems : [])
    .map(item => pointLayout(item, date, layoutScale))
    .filter(Boolean);
  const timed = Array.isArray(timedItems) ? timedItems : [];
  const laidOut = assignOverlapColumns([...timed, ...points], { scale: layoutScale });
  return laidOut.map(restorePoint);
}
