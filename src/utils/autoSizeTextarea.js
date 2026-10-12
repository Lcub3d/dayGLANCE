// One height policy for a note's two states (#2067). The preview grew to its
// content while the editor kept a fixed floor, so clicking a long note to edit
// it collapsed the box to ~192px (72px in compact views, where it could not even
// be resized). The editor now sizes to its content up to the same cap the
// preview uses, and scrolls past it.

/** Fraction of the viewport a note may take before it scrolls, in both states. */
export const NOTE_MAX_VIEWPORT_FRACTION = 0.6;

/** The cap in px for the current viewport. */
export const noteMaxHeightPx = (viewportHeight =
  (typeof window !== 'undefined' ? window.innerHeight : 0)) =>
  Math.max(0, Math.round(viewportHeight * NOTE_MAX_VIEWPORT_FRACTION));

/**
 * Size a textarea to its content, never above `maxPx`. The CSS min-height still
 * applies, so a short note keeps its comfortable floor.
 * @param {HTMLTextAreaElement|null} el
 * @param {number} [maxPx]
 */
export function autoSizeTextarea(el, maxPx = noteMaxHeightPx()) {
  if (!el?.style) return;
  // Reset first so the field can shrink when text is deleted.
  el.style.height = 'auto';
  const content = el.scrollHeight || 0;
  const capped = maxPx > 0 ? Math.min(content, maxPx) : content;
  el.style.height = `${capped}px`;
  el.style.overflowY = maxPx > 0 && content > maxPx ? 'auto' : 'hidden';
}
