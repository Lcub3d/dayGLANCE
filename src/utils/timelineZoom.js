// Timeline magnification for the scrolling timelines: MULTI, WEEK and JOBO.
// Pure: the limits, the steps, the stored form and the scroll anchor, so the
// views and the header control share one set of rules.
//
// A zoom level multiplies a view's hour height, and card contents are drawn
// at the same factor (CSS zoom), laid out as they would be at 100%: a card
// at 120% is the 100% card, larger. DAY fits exactly eight hours and MONTH
// fits its grid, so neither zooms; SCHED has no timeline.
//
// Per view and per device: a level is a preference of this screen, like a
// remembered tab, so it lives in localStorage and never syncs.

export const ZOOM_VIEWS = Object.freeze(['multi', 'week', 'jobo']);
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;
export const ZOOM_STORAGE_KEY = 'dg-timeline-zoom';
// A Ctrl+wheel or trackpad pinch sends many small deltas: this much
// accumulated scroll is one step.
const WHEEL_STEP_PX = 50;

export const isZoomView = (view) => ZOOM_VIEWS.includes(view);

/** WEEK already fits its whole range on screen, so it only grows. */
export const zoomMin = (view) => (view === 'week' ? 1 : 0.8);

const round = (z) => Math.round(z * 10) / 10;

/** A level the view allows, on the 10% grid; anything unusable is 100%. */
export function clampZoom(view, z) {
  if (!isZoomView(view) || !Number.isFinite(z)) return 1;
  return round(Math.min(ZOOM_MAX, Math.max(zoomMin(view), z)));
}

/** One step larger (dir > 0) or smaller (dir < 0). */
export const stepZoom = (view, z, dir) => clampZoom(view, (Number.isFinite(z) ? z : 1) + Math.sign(dir) * ZOOM_STEP);

/** The level a view is drawn at: 1 for any view that does not zoom. */
export const zoomFor = (zooms, view) => (isZoomView(view) ? clampZoom(view, zooms?.[view] ?? 1) : 1);

/** The stored levels, or none when storage is missing or unreadable. */
export function readZooms(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(ZOOM_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(ZOOM_VIEWS.filter((v) => Number.isFinite(parsed[v])).map((v) => [v, clampZoom(v, parsed[v])]));
  } catch { return {}; }
}

/** The levels with one view's set; 100% is stored as no entry. */
export function withZoom(zooms, view, z) {
  const next = { ...(zooms || {}) };
  const level = clampZoom(view, z);
  if (level === 1) delete next[view];
  else next[view] = level;
  return next;
}

/**
 * Whole steps in an accumulated wheel delta: `{ steps, rest }`. Scrolling
 * up (negative delta) makes the timeline larger, as a pinch outward does.
 */
export function wheelSteps(accumulated, deltaY) {
  const total = accumulated + deltaY;
  const steps = Math.trunc(total / WHEEL_STEP_PX);
  return { steps: -steps || 0, rest: total - steps * WHEEL_STEP_PX };
}

/**
 * Where to scroll after a zoom so the time under `anchorY` stays under it.
 * `originOffset` is where the timeline's midnight sits in the scrolled
 * content (below any header, which does not zoom).
 */
export function anchoredScrollTop({ scrollTop, anchorY, originOffset = 0, ratio }) {
  const intoTimeline = scrollTop + anchorY - originOffset;
  return Math.max(0, originOffset + intoTimeline * ratio - anchorY);
}
