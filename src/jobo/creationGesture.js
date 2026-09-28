// Pointer selection is view state until release, never a partially saved task.
export const CREATION_HOLD_MS = 500;
export const CREATION_DRAG_PX = 5;

// Decide on the first intentional movement. A long marquee must never turn
// into task creation merely because the user is still holding the pointer.
export function creationGestureMode({ distance = 0, elapsed = 0, previousMode = 'pending' } = {}) {
  if (previousMode === 'select' || previousMode === 'range') return previousMode;
  if (Math.abs(distance) < CREATION_DRAG_PX) return elapsed >= CREATION_HOLD_MS ? 'armed' : 'pending';
  return previousMode === 'armed' || elapsed >= CREATION_HOLD_MS ? 'range' : 'select';
}

export function creationInterval(anchorMinute, pointerMinute, dragged = true) {
  const snap = (value) => Math.max(0, Math.min(1440, Math.round(value / 5) * 5));
  const anchor = Math.min(dragged ? 1435 : 1410, snap(anchorMinute));
  const pointer = snap(pointerMinute);
  const startMinute = dragged ? Math.min(anchor, pointer) : anchor;
  const endMinute = dragged ? Math.max(anchor + (pointer >= anchor ? 5 : 0), pointer) : Math.min(1440, anchor + 30);
  return { startMinute, endMinute, duration: endMinute - startMinute };
}
