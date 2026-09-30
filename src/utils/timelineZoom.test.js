import { describe, it, expect } from 'vitest';
import { ZOOM_STORAGE_KEY, anchoredScrollTop, clampZoom, isZoomView, readZooms, stepZoom, wheelSteps, withZoom, zoomFor, zoomMin } from './timelineZoom.js';

describe('timeline magnification', () => {
  it('applies to MULTI, WEEK and JOBO only', () => {
    expect(['multi', 'week', 'jobo'].every(isZoomView)).toBe(true);
    expect(['day', 'month', 'sched'].some(isZoomView)).toBe(false);
    expect(zoomFor({ day: 1.3 }, 'day')).toBe(1);
  });

  it('runs from 80% to 150% in 10% steps, and WEEK, which already fits, only grows', () => {
    expect(clampZoom('multi', 0.5)).toBe(0.8);
    expect(clampZoom('multi', 2)).toBe(1.5);
    expect(clampZoom('multi', 1.23)).toBe(1.2);
    expect(zoomMin('week')).toBe(1);
    expect(clampZoom('week', 0.8)).toBe(1);
    expect(stepZoom('jobo', 1, 1)).toBe(1.1);
    expect(stepZoom('jobo', 0.8, -1)).toBe(0.8);
    expect(stepZoom('jobo', 1.5, 1)).toBe(1.5);
    expect(clampZoom('multi', NaN)).toBe(1);
  });

  it('keeps a level per view, and stores 100% as nothing', () => {
    let zooms = withZoom({}, 'multi', 1.2);
    zooms = withZoom(zooms, 'jobo', 0.9);
    expect(zooms).toEqual({ multi: 1.2, jobo: 0.9 });
    expect(zoomFor(zooms, 'week')).toBe(1);
    expect(withZoom(zooms, 'multi', 1)).toEqual({ jobo: 0.9 });
  });

  it('reads stored levels defensively', () => {
    const at = (value) => readZooms({ getItem: (k) => (k === ZOOM_STORAGE_KEY ? value : null) });
    expect(at('{"multi":1.2,"week":0.5,"day":2,"jobo":"x"}')).toEqual({ multi: 1.2, week: 1 });
    expect(at('{broken')).toEqual({});
    expect(at(null)).toEqual({});
  });

  it('turns a pinch or Ctrl+wheel into whole steps, keeping the remainder', () => {
    expect(wheelSteps(0, -120)).toEqual({ steps: 2, rest: -20 });
    expect(wheelSteps(-20, -30)).toEqual({ steps: 1, rest: 0 });
    expect(wheelSteps(0, 30)).toEqual({ steps: 0, rest: 30 });
    expect(wheelSteps(30, 30)).toEqual({ steps: -1, rest: 10 });
  });

  // MUTATION: scale the scroll offset without the anchor and the time under
  // the pointer runs away as the timeline grows.
  it('keeps the time under the pointer in place', () => {
    // Midnight 40px down (a header above it), scrolled 800px, pointer 200px
    // into the view: 960px into the timeline. At 150%, that time is 1440px in.
    const next = anchoredScrollTop({ scrollTop: 800, anchorY: 200, originOffset: 40, ratio: 1.5 });
    expect(next + 200 - 40).toBe(1440);
    expect(anchoredScrollTop({ scrollTop: 0, anchorY: 300, originOffset: 40, ratio: 0.8 })).toBe(0);
  });
});
