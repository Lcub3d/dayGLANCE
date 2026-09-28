const planDate = item => item.plan?.date ?? item.currentTask?.date ?? item.task?.date;
const taskId = item => String(item.currentTask?.id ?? item.id);
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// Neighbours follow chronological task starts, not the expanded card height.
// Captured history is another view of a task, never an extra neighbour.
export function planEdgeSnap(item, plans, edge) {
  if (!item || item.historical || !['start', 'end'].includes(edge)) return null;
  const { startMinute: start, endMinute: end } = item;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end <= start) return null;
  const peers = (plans || []).filter(peer => peer && !peer.historical
    && taskId(peer) !== taskId(item) && planDate(peer) === planDate(item)
    && Number.isInteger(peer.startMinute) && Number.isInteger(peer.endMinute)
    && peer.startMinute >= 0 && peer.endMinute <= 1440 && peer.endMinute > peer.startMinute);
  const neighbour = edge === 'start'
    ? peers.filter(peer => peer.startMinute < start).sort((a, b) => b.startMinute - a.startMinute || b.endMinute - a.endMinute)[0]
    : peers.filter(peer => peer.startMinute > start).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)[0];
  if (!neighbour) return null;
  const nextStart = edge === 'start' ? neighbour.endMinute : start;
  const nextEnd = edge === 'end' ? neighbour.startMinute : end;
  if (nextStart >= nextEnd || (nextStart === start && nextEnd === end)) return null;
  return {
    startTime: clock(nextStart), duration: nextEnd - nextStart,
    targetTime: clock(edge === 'start' ? nextStart : nextEnd),
  };
}
