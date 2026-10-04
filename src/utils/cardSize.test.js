import { describe, expect, it } from 'vitest';
import { CARD_SIZE_STORAGE_KEY, cardColumns, cardScale, clampCardSize, readCardSize, writeCardSize } from './cardSize.js';

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

describe('cardSize', () => {
  it('falls back to Normal for anything unknown', () => {
    expect(clampCardSize('huge')).toBe('normal');
    expect(clampCardSize(null)).toBe('normal');
    expect(cardScale('bogus')).toBe(1);
    expect(cardScale('large')).toBe(1.15);
  });

  it('fits fewer columns as cards grow', () => {
    const opts = { min: 300, gap: 16 };
    // A wide screen that holds six Normal cards holds five Large ones.
    expect(cardColumns(1900, { ...opts, scale: 1 })).toBe(6);
    expect(cardColumns(1900, { ...opts, scale: 1.15 })).toBe(5);
    expect(cardColumns(1900, { ...opts, scale: 1.3 })).toBe(4);
    expect(cardColumns(100, { ...opts, scale: 1.3 })).toBe(1);
  });

  it('stores Normal as no entry and survives bad storage', () => {
    const s = memoryStorage();
    expect(readCardSize(s)).toBe('normal');
    writeCardSize('larger', s);
    expect(s.m.get(CARD_SIZE_STORAGE_KEY)).toBe('larger');
    expect(readCardSize(s)).toBe('larger');
    writeCardSize('normal', s);
    expect(s.m.has(CARD_SIZE_STORAGE_KEY)).toBe(false);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readCardSize(broken)).toBe('normal');
    expect(writeCardSize('large', broken)).toBe('large');
  });
});
