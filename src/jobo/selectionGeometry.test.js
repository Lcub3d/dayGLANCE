import { describe, expect, it } from 'vitest';
import { clampGroupDelta, marqueeRect, rectanglesIntersect } from './selectionGeometry.js';

describe('timeline group selection', () => {
  it('selects intersecting cards in both drag directions but not an adjacent edge', () => {
    const a = marqueeRect({ x: 200, y: 180 }, { x: 20, y: 30 });
    expect(a).toEqual({ left: 20, top: 30, right: 200, bottom: 180, width: 180, height: 150 });
    expect(rectanglesIntersect(a, { left: 80, top: 100, right: 240, bottom: 220 })).toBe(true);
    expect(rectanglesIntersect(a, { left: 200, top: 100, right: 240, bottom: 220 })).toBe(false);
  });
  it('moves a group with one snapped offset and preserves its spacing at both day boundaries', () => {
    const items = [{ startMinute: 20, endMinute: 50 }, { startMinute: 100, endMinute: 145 }];
    expect(clampGroupDelta(items, -100)).toBe(-20);
    expect(clampGroupDelta(items, 2000)).toBe(1295);
    expect(clampGroupDelta(items, 63)).toBe(65);
    const delta = clampGroupDelta(items, 2000);
    expect((items[1].startMinute + delta) - (items[0].startMinute + delta)).toBe(80);
  });
  it('does not mutate an absent or invalid selection', () => {
    expect(clampGroupDelta([], 10)).toBe(0);
    expect(clampGroupDelta([{ startMinute: NaN, endMinute: 30 }], 10)).toBe(0);
    expect(clampGroupDelta([{ startMinute: 0, endMinute: 30 }], Infinity)).toBe(0);
  });
});
