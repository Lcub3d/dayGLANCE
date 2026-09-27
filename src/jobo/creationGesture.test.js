import { describe, expect, it } from 'vitest';
import { creationGestureMode, creationInterval } from './creationGesture.js';

describe('empty-lane creation selection', () => {
  it('separates a click, quick stroke and held range without treating jitter as a stroke', () => {
    expect(creationGestureMode({ distance: 0, elapsed: 40 })).toBe('dialog');
    expect(creationGestureMode({ distance: 4, elapsed: 900 })).toBe('dialog');
    expect(creationGestureMode({ distance: 12, elapsed: 100 })).toBe('quick');
    expect(creationGestureMode({ distance: 12, elapsed: 350 })).toBe('range');
    expect(creationGestureMode({ distance: -20, elapsed: 500 })).toBe('range');
  });
  it('creates a default half-hour on a click and clamps midnight', () => {
    expect(creationInterval(601, 601, false)).toEqual({ startMinute: 600, endMinute: 630, duration: 30 });
    expect(creationInterval(1439, 1439, false)).toEqual({ startMinute: 1435, endMinute: 1440, duration: 5 });
  });
  it('supports dragging either way without moving the anchor to a different day', () => {
    expect(creationInterval(600, 646)).toEqual({ startMinute: 600, endMinute: 645, duration: 45 });
    expect(creationInterval(600, 552)).toEqual({ startMinute: 550, endMinute: 600, duration: 50 });
    expect(creationInterval(20, -15)).toEqual({ startMinute: 0, endMinute: 20, duration: 20 });
  });
  it('keeps a five-minute minimum after snapping a very short drag', () => {
    expect(creationInterval(600, 601)).toEqual({ startMinute: 600, endMinute: 605, duration: 5 });
  });
});
