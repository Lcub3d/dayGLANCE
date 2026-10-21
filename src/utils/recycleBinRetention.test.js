import { describe, it, expect } from 'vitest';
import { readBinAutoEmptyDays, expiredBinItems, BIN_AUTO_EMPTY_KEY } from './recycleBinRetention.js';

const storage = (entries) => ({ getItem: (k) => (k in entries ? entries[k] : null) });

describe('readBinAutoEmptyDays', () => {
  it('starts a fresh install at 30 days', () => {
    expect(readBinAutoEmptyDays(storage({}))).toBe(30);
  });

  it('starts a device that already holds data off', () => {
    expect(readBinAutoEmptyDays(storage({ 'day-planner-tasks': '[]' }))).toBe(0);
    expect(readBinAutoEmptyDays(storage({ 'day-planner-recycle-bin': '[]' }))).toBe(0);
  });

  it('keeps a saved choice, and reads an unknown one as off', () => {
    expect(readBinAutoEmptyDays(storage({ [BIN_AUTO_EMPTY_KEY]: '7', 'day-planner-tasks': '[]' }))).toBe(7);
    expect(readBinAutoEmptyDays(storage({ [BIN_AUTO_EMPTY_KEY]: '0' }))).toBe(0);
    expect(readBinAutoEmptyDays(storage({ [BIN_AUTO_EMPTY_KEY]: '12' }))).toBe(0);
    expect(readBinAutoEmptyDays(storage({ [BIN_AUTO_EMPTY_KEY]: 'nope' }))).toBe(0);
  });
});

describe('expiredBinItems', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const bin = [
    { id: 'a', deletedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', deletedAt: '2026-10-19T00:00:00Z' },
    { id: 'c' },
    { id: 'd', deletedAt: 'garbage' },
  ];

  it('returns items deleted before the cutoff, never unstamped ones', () => {
    expect(expiredBinItems(bin, 30, now).map(t => t.id)).toEqual(['a']);
    expect(expiredBinItems(bin, 0, now)).toEqual([]);
    expect(expiredBinItems(null, 30, now)).toEqual([]);
  });
});
