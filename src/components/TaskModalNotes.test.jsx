import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// What the New/Edit Task modals' notes section renders: hidden behind its
// button until opened, then the app's own notes panel over the right task.
// Typing, Shift+Enter and Add are checked in the browser.
const fixture = {};
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => ({ aiConfig: null }) }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => fixture.sync }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));

const { default: TaskModalNotes, TASK_MODAL_NOTES_KEY } = await import('./TaskModalNotes.jsx');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };

const noop = () => {};
const linked = { id: 'p1', title: 'Write it up [[Report]]', notes: '', subtasks: [], projectId: 'proj' };
beforeEach(() => {
  store.clear();
  fixture.ctx = {
    darkMode: false, borderClass: '', textSecondary: '', hoverBg: '',
    tasks: [{ id: 's1', title: 'Scheduled', notes: 'Kept note', subtasks: [] }, { id: 'ev', title: 'Standup', imported: true }, linked],
    unscheduledTasks: [{ id: 'b1', title: 'Learn to sail', bucketId: 'bk', notes: '', subtasks: [{ id: 'x', title: 'Find a school', completed: false }] }],
    recurringTasks: [],
    updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
  };
  fixture.sync = { loadWikiNote: () => new Promise(noop), saveWikiNote: noop, openInObsidian: noop };
});

const render = (props) => renderToStaticMarkup(<TaskModalNotes newTask={{ title: '' }} setNewTask={noop} editingTask={null} {...props} />);

describe('the task modals\' notes section', () => {
  it('starts hidden: the button, and no panel', () => {
    const html = render({ editingTask: { id: 's1' } });
    expect(html).toContain('data-task-modal-notes-toggle');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('task.notesFormattingPlaceholder');
    expect(html).not.toContain('Kept note');
  });

  it('marks the button when the task holds notes or subtasks, hidden or not', () => {
    expect(render({ editingTask: { id: 's1' } })).toContain('data-task-modal-notes-dot');
    expect(render({ editingTask: { id: 'b1' } })).toContain('data-task-modal-notes-dot');
    expect(render({ editingTask: { id: 'p1' } })).not.toContain('data-task-modal-notes-dot');
    expect(render({ newTask: { title: 'x', notes: 'draft' } })).toContain('data-task-modal-notes-dot');
  });

  it('opened, as remembered on this device, shows the task\'s own notes', () => {
    store.set(TASK_MODAL_NOTES_KEY, '1');
    const html = render({ editingTask: { id: 's1' } });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-task-modal-notes="task"');
    expect(html).toContain('Kept note');
  });

  it('a new task gets a draft panel, with what was written so far', () => {
    store.set(TASK_MODAL_NOTES_KEY, '1');
    const html = render({ newTask: { title: 'New', notes: '', subtasks: [{ id: 'd1', title: 'First step', completed: false }] } });
    expect(html).toContain('data-task-modal-notes="draft"');
    expect(html).toContain('First step');
  });

  // MUTATION: leave out the vault loaders (as the Bucket List's panel did)
  // and a project task linked to an Obsidian note shows an empty local note
  // in its place, edited where the vault never sees it.
  it('a task linked to a vault note opens that note, through the app\'s loader', () => {
    store.set(TASK_MODAL_NOTES_KEY, '1');
    const html = render({ editingTask: { id: 'p1' } });
    expect(html).toContain('Report');
    expect(html).toContain('lucide-book-open');
  });

  it('has no section for a calendar event, whose notes are edited elsewhere', () => {
    expect(render({ editingTask: { id: 'ev' } })).toBe('');
  });
});
