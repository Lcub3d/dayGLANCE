// The notes sidebar's split between the Daily Note and the task's notes.
// Pure, so the drag and keyboard rules are tested without a DOM.

/** Where the split starts: the Daily Note gets a little more than half. */
export const DAILY_NOTE_SHARE = 0.55;
const MIN = 0.2;
const MAX = 0.8;
const STEP = 0.05;

/** A share both parts can live with: neither drops below a fifth. */
export const clampShare = (share) => Math.min(MAX, Math.max(MIN, Number.isFinite(share) ? share : DAILY_NOTE_SHARE));

/** The share at a pointer's height within the area the two parts divide. */
export function shareAtPointer(clientY, area) {
  if (!area || !(area.height > 0)) return null;
  return clampShare((clientY - area.top) / area.height);
}

/** The keyboard: arrows move the split a step, Home and End to its limits. */
export function shareForKey(share, key) {
  if (key === 'ArrowUp') return clampShare(share - STEP);
  if (key === 'ArrowDown') return clampShare(share + STEP);
  if (key === 'Home') return MIN;
  if (key === 'End') return MAX;
  return null;
}
