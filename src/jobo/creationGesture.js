// Pointer selection is view state until release, never a partially saved task.
export const CREATION_HOLD_MS = 350;
export const CREATION_DRAG_PX = 5;

// A click keeps the native dialog. A quick stroke is a 30-minute blank;
// holding before/during the stroke enables an explicit interval selection.
export function creationGestureMode({ distance = 0, elapsed = 0 } = {}) {
  if (Math.abs(distance) < CREATION_DRAG_PX) return 'dialog';
  return elapsed >= CREATION_HOLD_MS ? 'range' : 'quick';
}

export function creationInterval(anchorMinute, pointerMinute, dragged = true) {
  const snap = (value) => Math.max(0, Math.min(1440, Math.round(value / 5) * 5));
  const anchor = Math.min(1435, snap(anchorMinute));
  const pointer = snap(pointerMinute);
  const startMinute = dragged ? Math.min(anchor, pointer) : anchor;
  const endMinute = dragged ? Math.max(anchor + (pointer >= anchor ? 5 : 0), pointer) : Math.min(1440, anchor + 30);
  return { startMinute, endMinute, duration: endMinute - startMinute };
}
