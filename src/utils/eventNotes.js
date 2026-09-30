// Your own notes on imported calendar events.
//
// An imported event is rebuilt from its feed on every calendar refresh, so a
// note typed into the event itself was lost at the next refresh. These notes
// live apart, keyed by the event's id (feed, the calendar's UID and the
// date, see icsParser's expandMultiDayEvent), and are laid over the event
// where the app reads its days. The calendar's own description stays on the
// event as `notes`, read-only; your note is `eventNote`.
//
// On this device only: imported events are not synced (each device imports
// its own calendars), so neither are these.

export const EVENT_NOTES_KEY = 'day-planner-event-notes';

/** An imported calendar event, as opposed to a task or a task-calendar item. */
export const isCalendarEventRow = (task) => !!task?.imported && !task.isTaskCalendar;

/** The stored map, or an empty one when storage is missing or unreadable. */
export function readEventNotes(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(EVENT_NOTES_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** The map with one event's note set; an empty note removes the entry. */
export function withEventNote(notes, id, text, now = new Date().toISOString()) {
  const key = String(id);
  const next = { ...(notes || {}) };
  if (typeof text === 'string' && text.trim()) next[key] = { text, updatedAt: now };
  else delete next[key];
  return next;
}

/**
 * Lay the notes over the calendar events in `tasks`. Every event row gets
 * its note, or loses a stale one, so a copy of the list that found its way
 * back into state never outlives a cleared note. Returns the same array
 * when nothing changes, so memoized readers keep their identity.
 */
export function applyEventNotes(tasks, notes) {
  if (!Array.isArray(tasks)) return tasks;
  let changed = false;
  const out = tasks.map((task) => {
    if (!isCalendarEventRow(task)) return task;
    const text = notes?.[String(task.id)]?.text;
    if (text === task.eventNote || (text === undefined && !('eventNote' in task))) return task;
    changed = true;
    if (text === undefined) {
      const { eventNote: _drop, ...rest } = task;
      return rest;
    }
    return { ...task, eventNote: text };
  });
  return changed ? out : tasks;
}
