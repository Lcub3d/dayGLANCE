import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The event panel every view opens (timeline and all-day cards, the phone's
// notes sheet and agenda). A feed event's description is rebuilt on every
// refresh, so it shows read-only with your own note beneath it; an event
// from the device's own calendar keeps its editable description, which is
// written back to that calendar.

let native = false;
vi.mock('../native.js', () => ({ isNativeApp: () => native, nativeUpdateEvent: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ setTasks: vi.fn(), setEventNote: vi.fn(), timeToMinutes: () => 0, minutesToTime: () => '00:00', darkMode: false }) }));
const { default: EventNotesPanel } = await import('./EventNotesPanel.jsx');

const event = (over = {}) => ({ id: 'uid-1-2026-09-30', title: 'Busy', date: '2026-09-30', startTime: '13:00', duration: 45, imported: true, notes: 'Room 4B', ...over });
const render = (task, props = {}) => renderToStaticMarkup(<EventNotesPanel task={task} {...props} />);

beforeEach(() => { native = false; });

describe('EventNotesPanel', () => {
  // MUTATION: make the feed description editable again and it is lost on
  // the next refresh; the first expectation catches it.
  it('a feed event: the description read-only, your note editable beneath it', () => {
    const html = render(event({ eventNote: 'Ask about the budget' }));
    expect(html).toContain('data-event-notes="feed"');
    expect(html).toMatch(/data-event-description="true"[^]*task\.calendarDescription[^]*Room 4B/);
    expect(html).not.toMatch(/<textarea[^>]*>Room 4B/);
    expect(html).toMatch(/<textarea data-event-note="true"[^>]*>Ask about the budget<\/textarea>/);
  });

  it('a feed event with no description: just your note', () => {
    const html = render(event({ notes: undefined }));
    expect(html).not.toContain('data-event-description');
    expect(html).toContain('data-event-note');
  });

  it('an event from the device calendar keeps its editable description, written back to it', () => {
    native = true;
    const html = render(event({ nativeEventId: 'dev-1' }));
    expect(html).toContain('data-event-notes="device"');
    expect(html).toMatch(/<textarea[^>]*>Room 4B<\/textarea>/);
    expect(html).not.toContain('data-event-note=');
  });

  it('the same event on desktop, with no device calendar, is a feed event', () => {
    expect(render(event({ nativeEventId: 'dev-1' }))).toContain('data-event-notes="feed"');
  });
});
