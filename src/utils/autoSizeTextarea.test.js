import { describe, expect, it } from 'vitest';
import { autoSizeTextarea, noteMaxHeightPx, NOTE_MAX_VIEWPORT_FRACTION } from './autoSizeTextarea.js';

const field = (scrollHeight) => ({ scrollHeight, style: {} });

describe('autoSizeTextarea (#2067)', () => {
  it('grows to the content of a long note instead of keeping a fixed floor', () => {
    const el = field(640);
    autoSizeTextarea(el, 900);
    expect(el.style.height).toBe('640px');
    expect(el.style.overflowY).toBe('hidden');
  });

  it('stops at the cap and scrolls beyond it', () => {
    const el = field(2000);
    autoSizeTextarea(el, 900);
    expect(el.style.height).toBe('900px');
    expect(el.style.overflowY).toBe('auto');
  });

  it('measures from auto so the field shrinks when text is removed', () => {
    const el = { style: { height: '640px' } };
    let measuredFrom;
    Object.defineProperty(el, 'scrollHeight', { get() { measuredFrom = el.style.height; return 120; } });
    autoSizeTextarea(el, 900);
    expect(measuredFrom).toBe('auto');
    expect(el.style.height).toBe('120px');
  });

  it('ignores a missing element', () => {
    expect(() => autoSizeTextarea(null, 900)).not.toThrow();
  });

  it('caps at a fraction of the viewport', () => {
    expect(noteMaxHeightPx(1000)).toBe(Math.round(1000 * NOTE_MAX_VIEWPORT_FRACTION));
    expect(noteMaxHeightPx(0)).toBe(0);
  });

  it('without a known viewport it sizes to content rather than collapsing', () => {
    const el = field(500);
    autoSizeTextarea(el, 0);
    expect(el.style.height).toBe('500px');
  });
});
