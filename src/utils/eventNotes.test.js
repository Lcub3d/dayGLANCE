import { describe, it, expect } from 'vitest';
import { EVENT_NOTES_KEY, applyEventNotes, isCalendarEventRow, readEventNotes, withEventNote } from './eventNotes.js';

const event = (over = {}) => ({ id: 'uid-1-2026-09-30', title: 'Busy', date: '2026-09-30', startTime: '13:00', duration: 45, imported: true, notes: 'From the calendar', ...over });
const task = { id: 't1', title: 'Write', date: '2026-09-30' };

describe('notes on calendar events', () => {
  it('only an imported calendar event takes one, not a task or a task-calendar item', () => {
    expect(isCalendarEventRow(event())).toBe(true);
    expect(isCalendarEventRow(task)).toBe(false);
    expect(isCalendarEventRow(event({ isTaskCalendar: true }))).toBe(false);
  });

  it('lays a note over its event and leaves the calendar description where it was', () => {
    const notes = withEventNote({}, 'uid-1-2026-09-30', 'Ask about the budget', '2026-09-30T13:05:00Z');
    const [row, other] = applyEventNotes([event(), task], notes);
    expect(row).toMatchObject({ eventNote: 'Ask about the budget', notes: 'From the calendar' });
    expect(other).toBe(task);
  });

  // MUTATION: key the note on anything the refresh changes and this loses it.
  it('survives the refresh that rebuilds the event from its feed', () => {
    const notes = withEventNote({}, 'uid-1-2026-09-30', 'Ask about the budget');
    const refreshed = event({ title: 'Busy (moved room)' });
    expect(applyEventNotes([refreshed], notes)[0].eventNote).toBe('Ask about the budget');
  });

  it('an empty note removes the entry, and the event loses a stale copy of it', () => {
    const set = withEventNote({}, 'uid-1-2026-09-30', 'x');
    const cleared = withEventNote(set, 'uid-1-2026-09-30', '   ');
    expect(cleared).toEqual({});
    expect('eventNote' in applyEventNotes([event({ eventNote: 'x' })], cleared)[0]).toBe(false);
  });

  it('returns the same list when nothing changes', () => {
    const tasks = [event(), task];
    expect(applyEventNotes(tasks, {})).toBe(tasks);
    const notes = withEventNote({}, 'uid-1-2026-09-30', 'x');
    const once = applyEventNotes(tasks, notes);
    expect(applyEventNotes(once, notes)).toBe(once);
  });

  it('reads an empty map from missing or broken storage', () => {
    expect(readEventNotes({ getItem: () => null })).toEqual({});
    expect(readEventNotes({ getItem: () => '{broken' })).toEqual({});
    expect(readEventNotes({ getItem: () => '[1]' })).toEqual({});
    expect(readEventNotes({ getItem: (k) => (k === EVENT_NOTES_KEY ? '{"a":{"text":"x"}}' : null) })).toEqual({ a: { text: 'x' } });
  });
});
