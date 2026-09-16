import { describe, it, expect } from 'vitest';
import { readSentNotes, recordSentNotes, NOTES_JOURNAL_KEY, NOTES_JOURNAL_RETAIN_MS } from './obsidianNotesJournal.js';

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

describe('the sent-notes journal (device-local, report F3)', () => {
  it('records the last body per task and prunes aged entries', () => {
    const s = storage();
    const t0 = Date.parse('2026-09-17T12:00:00.000Z');
    recordSentNotes({ id: 'a', target: 'Projects/A', body: 'first' }, s, t0);
    recordSentNotes({ id: 'a', target: 'Projects/A', body: 'second' }, s, t0 + 1000);
    recordSentNotes({ id: 'b', target: 'Projects/B', body: 'other' }, s, t0 + 2000);
    expect(readSentNotes(s)).toEqual({
      a: { target: 'Projects/A', body: 'second', at: new Date(t0 + 1000).toISOString() },
      b: { target: 'Projects/B', body: 'other', at: new Date(t0 + 2000).toISOString() },
    });
    recordSentNotes({ id: 'c', target: 'Projects/C', body: 'late' }, s, t0 + NOTES_JOURNAL_RETAIN_MS + 5000);
    expect(Object.keys(readSentNotes(s))).toEqual(['c']);
  });
  it('reads corruption and a missing store as empty', () => {
    const s = storage();
    s.setItem(NOTES_JOURNAL_KEY, '{nope');
    expect(readSentNotes(s)).toEqual({});
    expect(readSentNotes(null)).toEqual({});
  });
});
