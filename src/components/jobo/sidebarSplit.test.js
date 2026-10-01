import { describe, it, expect } from 'vitest';
import { DAILY_NOTE_SHARE, clampShare, shareAtPointer, shareForKey } from './sidebarSplit.js';

describe('the notes sidebar split', () => {
  it('starts with a little more than half for the Daily Note', () => {
    expect(DAILY_NOTE_SHARE).toBe(0.55);
    expect(clampShare(undefined)).toBe(DAILY_NOTE_SHARE);
  });

  it('never lets either part drop below a fifth', () => {
    expect(clampShare(0.05)).toBe(0.2);
    expect(clampShare(0.95)).toBe(0.8);
    expect(clampShare(0.4)).toBe(0.4);
  });

  it('follows the pointer within the area the two parts share', () => {
    expect(shareAtPointer(300, { top: 100, height: 400 })).toBe(0.5);
    expect(shareAtPointer(110, { top: 100, height: 400 })).toBe(0.2);
    expect(shareAtPointer(300, { top: 100, height: 0 })).toBeNull();
  });

  it('moves a step on the arrows and to its limits on Home and End', () => {
    expect(shareForKey(0.5, 'ArrowUp')).toBeCloseTo(0.45);
    expect(shareForKey(0.5, 'ArrowDown')).toBeCloseTo(0.55);
    expect(shareForKey(0.5, 'Home')).toBe(0.2);
    expect(shareForKey(0.5, 'End')).toBe(0.8);
    expect(shareForKey(0.5, 'a')).toBeNull();
  });
});
