import { describe, it, expect } from 'vitest';
import { lineReappendStamp, readLineReappends, writeLineReappends, LINE_REAPPENDS_STORAGE_KEY } from './obsidianLineReappend.js';

const WIPE = '2026-09-13T19:04:00.000-06:00';
const placed = (over = {}) => ({
  id: 'obsidian-dg-e83w0v79', title: 'FEATURE: TRMNL layout #obsidian', importSource: 'obsidian',
  obsidianRawTitle: 'FEATURE: TRMNL layout', obsidianNotePath: 'Projects/dayGLANCE.md', obsidianBlockId: 'e83w0v79',
  completed: false, lastModified: '2026-09-14T10:00:00.000-06:00', ...over,
});

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

describe('lineReappendStamp (the re-append ruling, 2026-09-16)', () => {
  it('names the stamp when the line was confirmed removed but the record is newer', () => {
    expect(lineReappendStamp(placed(), { 'obsidian-dg-e83w0v79': WIPE })).toBe(WIPE);
  });
  it('is null when the tombstone is at least as new as the record: the vault owns existence', () => {
    expect(lineReappendStamp(placed({ lastModified: '2026-09-13T18:00:00.000-06:00' }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
    expect(lineReappendStamp(placed({ lastModified: WIPE }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
    expect(lineReappendStamp(placed({ lastModified: undefined }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
  });
  it('is null without a tombstone, a token, a home, or for a completed or app-only task', () => {
    expect(lineReappendStamp(placed(), {})).toBeNull();
    expect(lineReappendStamp(placed({ obsidianBlockId: null }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
    expect(lineReappendStamp(placed({ obsidianNotePath: null }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
    expect(lineReappendStamp(placed({ completed: true }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
    expect(lineReappendStamp(placed({ importSource: null }), { 'obsidian-dg-e83w0v79': WIPE })).toBeNull();
  });
});

describe('the acted-on memory', () => {
  it('round-trips and keeps only entries whose tombstone still carries the same stamp', () => {
    const s = storage();
    const kept = writeLineReappends({ a: WIPE, b: WIPE, c: '2026-09-01T00:00:00.000Z' }, { a: WIPE, b: '2026-09-15T00:00:00.000Z' }, s);
    expect(kept).toEqual({ a: WIPE });
    expect(readLineReappends(s)).toEqual({ a: WIPE });
    writeLineReappends({}, {}, s);
    expect(s.getItem(LINE_REAPPENDS_STORAGE_KEY)).toBeNull();
  });
  it('reads corruption and a missing store as empty', () => {
    const s = storage();
    s.setItem(LINE_REAPPENDS_STORAGE_KEY, '{nope');
    expect(readLineReappends(s)).toEqual({});
    expect(readLineReappends(null)).toEqual({});
  });
});
