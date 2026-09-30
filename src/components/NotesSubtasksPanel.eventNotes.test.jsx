import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import useTaskActions from '../hooks/useTaskActions.js';
import { applyEventNotes, withEventNote } from '../utils/eventNotes.js';

// A note typed on an imported calendar event used to be written into the
// event itself, and the next calendar refresh, which rebuilds every event
// from its feed, dropped it. The note now lives apart, keyed by the event,
// and is laid over the event where the app reads its days. This walks the
// whole path: the panel's save, the action's routing, the store, a refresh
// that rebuilds the event, and the panel again.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}
const noop = () => {};
const event = (over = {}) => ({ id: 'uid-1-2026-09-30', title: 'Busy', date: '2026-09-30', startTime: '13:00', duration: 45, imported: true, notes: 'Room 4B, bring the deck', ...over });
const render = async (task) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <NotesSubtasksPanel task={task} isInbox={false} darkMode={false} noAutoFocus
      updateTaskNotes={noop} addSubtask={noop} toggleSubtask={noop} deleteSubtask={noop} updateSubtaskTitle={noop} />
  </I18nextProvider>,
);

// The action as App wires it: calendar events route to the event-notes
// store, everything else to the task lists.
function actions(tasks) {
  let store = {};
  const setEventNote = vi.fn((id, text) => { store = withEventNote(store, id, text); });
  const setTasks = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { updateTaskNotes } = useTaskActions({ tasks, setTasks, setEventNote, onboardingProgress: { hasAddedNotes: true } });
  return { updateTaskNotes, setEventNote, setTasks, store: () => store };
}

describe('your notes on a calendar event', () => {
  // MUTATION: drop the routing in updateTaskNotes and the note goes into the
  // event row (setTasks), where the next refresh drops it.
  it('are kept apart from the event, and survive the refresh that rebuilds it', async () => {
    const a = actions([event()]);
    a.updateTaskNotes('uid-1-2026-09-30', 'Ask about the budget', false);
    expect(a.setEventNote).toHaveBeenCalledWith('uid-1-2026-09-30', 'Ask about the budget');
    expect(a.setTasks).not.toHaveBeenCalled();

    const refreshed = applyEventNotes([event({ title: 'Busy' })], a.store());
    const html = await render(refreshed[0]);
    expect(html).toContain('Ask about the budget');
    expect(html).toContain('Your notes (this device)');
  });

  it('show the calendar\'s description read-only, apart from your note', async () => {
    const html = await render(applyEventNotes([event()], withEventNote({}, 'uid-1-2026-09-30', 'Mine'))[0]);
    expect(html).toContain('data-event-description');
    expect(html).toContain('From the calendar');
    expect(html).toContain('Room 4B, bring the deck');
    // The description is not in the editor: your note starts from your text.
    expect(html.slice(html.indexOf('data-local-notes'))).not.toContain('Room 4B');
  });

  it('offer no subtasks on an event, which would be lost the same way', async () => {
    expect(await render(event())).not.toContain('Subtasks');
  });

  it('leave a task\'s notes and subtasks as they were', async () => {
    const a = actions([{ id: 't1', title: 'Write', date: '2026-09-30' }]);
    a.updateTaskNotes('t1', 'text', false);
    expect(a.setTasks).toHaveBeenCalled();
    expect(a.setEventNote).not.toHaveBeenCalled();
    const html = await render({ id: 't1', title: 'Write', notes: 'task notes', subtasks: [] });
    expect(html).toContain('task notes');
    expect(html).toContain('Subtasks');
    expect(html).not.toContain('data-event-description');
  });
});
