export function marqueeRect(start, end) {
  const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x), bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function rectanglesIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Apply one common offset; independently clamping each task would collapse
// the spacing within a selection at midnight.
export function clampGroupDelta(items, requestedDelta) {
  if (!items.length || !Number.isFinite(requestedDelta)
    || items.some(item => !Number.isFinite(item.startMinute) || !Number.isFinite(item.endMinute))) return 0;
  const earliest = Math.min(...items.map(item => item.startMinute));
  const latest = Math.max(...items.map(item => item.endMinute));
  return Math.max(-earliest, Math.min(1440 - latest, Math.round(requestedDelta / 5) * 5));
}
