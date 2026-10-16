import { describe, expect, it } from 'vitest';
import { CARET_H, CARET_W, caretSpots, pickCaretSpot } from './stripCaret.js';

// A strip box whose bottom-left corner is the gutter's foot.
const box = { left: 100, right: 1100, top: 860, bottom: 900 };
const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const spots = caretSpots(64);
const [rightBase, rightLifted, leftBase, leftLifted] = spots;

describe('caretSpots', () => {
  it('prefers the right edge of the gutter, beside the pills', () => {
    expect(rightBase).toEqual({ left: 64 - CARET_W - 6, bottom: 8 });
    expect(leftLifted.left).toBe(6);
  });
});

describe('pickCaretSpot', () => {
  it('stays at the right edge when nothing is at the gutter foot', () => {
    expect(pickCaretSpot(spots, box, [])).toBe(rightBase);
  });

  it('lifts over WEEK\'s end-hour toggle rather than leaving the right edge', () => {
    // "▼ 23:00": right-2, bottom-0.5, ~10px tall, ~40px wide.
    const toggle = rect(box.left + 16, box.bottom - 12, 40, 10);
    expect(pickCaretSpot(spots, box, [toggle])).toBe(rightLifted);
  });

  it('moves to the left edge when a short last row puts its label beside the toggle', () => {
    const toggle = rect(box.left + 16, box.bottom - 12, 40, 10);
    // Right-aligned "21:00" at the top of a 40px row.
    const label = rect(box.left + 30, box.bottom - 38, 26, 10);
    expect(pickCaretSpot(spots, box, [toggle, label])).toBe(leftLifted);
  });

  it('ignores marks well away from the foot, and ones not laid out', () => {
    const label = rect(box.left + 30, box.bottom - 200, 26, 10);
    const hidden = rect(box.left + 40, box.bottom - 20, 0, 0);
    expect(pickCaretSpot(spots, box, [label, hidden])).toBe(rightBase);
  });

  it('takes the lifted left edge when everything is covered', () => {
    const wall = rect(box.left, box.bottom - 3 * CARET_H, 64, 3 * CARET_H);
    expect(pickCaretSpot(spots, box, [wall])).toBe(leftLifted);
  });

  it('keeps base height on the left when only the right is blocked', () => {
    const block = rect(box.left + 30, box.bottom - 60, 34, 60);
    expect(pickCaretSpot(spots, box, [block])).toBe(leftBase);
  });
});
