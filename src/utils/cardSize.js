// Card size for the Goals & Projects space: a few named steps rather than a
// percentage, since a card grid has no axis to anchor a free zoom to. A size
// scales the cards (CSS zoom, laid out as they would be at Normal) and the
// width a column needs, so a larger size also fits fewer cards across.
//
// Per device, like the timeline levels (utils/timelineZoom.js): it suits one
// screen, so it lives in localStorage and never syncs.

export const CARD_SIZES = Object.freeze([
  { id: 'small', scale: 0.9 },
  { id: 'normal', scale: 1 },
  { id: 'large', scale: 1.15 },
  { id: 'larger', scale: 1.3 },
]);
export const CARD_SIZE_STORAGE_KEY = 'dg-space-card-size';
export const DEFAULT_CARD_SIZE = 'normal';

/** A known size id; anything else is Normal. */
export const clampCardSize = (id) => (CARD_SIZES.some((s) => s.id === id) ? id : DEFAULT_CARD_SIZE);

/** The scale a size draws at. */
export const cardScale = (id) => CARD_SIZES.find((s) => s.id === clampCardSize(id)).scale;

/**
 * How many columns of `min`-wide cards, `gap` apart, fit in `width` at
 * `scale`. Both the card and the gap grow with the scale.
 */
export const cardColumns = (width, { min, gap, scale = 1 }) =>
  Math.max(1, Math.floor((width + gap * scale) / ((min + gap) * scale)));

/** The stored size, or Normal when storage is missing or unreadable. */
export function readCardSize(storage = globalThis.localStorage) {
  try { return clampCardSize(storage?.getItem(CARD_SIZE_STORAGE_KEY)); } catch { return DEFAULT_CARD_SIZE; }
}

/** Store a size; Normal is stored as no entry. */
export function writeCardSize(id, storage = globalThis.localStorage) {
  const size = clampCardSize(id);
  try {
    if (size === DEFAULT_CARD_SIZE) storage?.removeItem(CARD_SIZE_STORAGE_KEY);
    else storage?.setItem(CARD_SIZE_STORAGE_KEY, size);
  } catch { /* kept for this session */ }
  return size;
}
