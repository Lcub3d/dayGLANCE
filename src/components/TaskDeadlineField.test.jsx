import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import TaskDeadlineField from './TaskDeadlineField.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// The deadline control the two task editors share (#2116 review).
//
// A deadline belongs to an INBOX task. "Inbox task" reaches the editor as either
// the plain inbox flavor (`openInInbox`) or a project task kept unscheduled
// (`keepUnscheduled`) — the flavor the project row's own title opens — so the
// field must render for both, and for a project task it must be LIVE: the old
// hand-written copies disabled it whenever a project was attached, even though
// the project row's own picker allowed a deadline all along.
//
// A scheduled task and a recurring series render nothing: the save path writes
// no deadline for either.
// ─────────────────────────────────────────────────────────────────────────────

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const render = async (newTask, { open = false } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      darkMode: false, borderClass: 'border-stone-200', cardBg: 'bg-white',
      textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      showNewTaskDeadlinePicker: open, setShowNewTaskDeadlinePicker: () => {},
      setDeadlinePickerTaskId: () => {},
    }}>
      <TaskDeadlineField newTask={newTask} setNewTask={() => {}} openUpward />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('TaskDeadlineField', () => {
  it('reads as a deadline control with no date set', async () => {
    const html = await render({ openInInbox: true, title: 'Ship the report', deadline: null });
    expect(html).toContain('Deadline');
    expect(html).toContain('No deadline');
  });

  it('shows the chosen date', async () => {
    const html = await render({ openInInbox: true, title: 'Ship the report', deadline: '2030-03-15' });
    expect(html).not.toContain('No deadline');
    expect(html).toMatch(/Mar\s*15/);
  });

  it('offers today, tomorrow and next week, and a clear only when one is set', async () => {
    const open = await render({ openInInbox: true, deadline: '2030-03-15' }, { open: true });
    expect(open).toContain('Today');
    expect(open).toContain('Tomorrow');
    expect(open).toContain('Clear deadline');

    const noneSet = await render({ openInInbox: true, deadline: null }, { open: true });
    expect(noneSet).not.toContain('Clear deadline');
  });

  it('is LIVE for a project inbox task (the field the old copies disabled)', async () => {
    const html = await render({ openInInbox: true, projectId: 'p1', priority: 0, deadline: null });
    expect(html).toContain('Deadline');
    expect(html).not.toContain('cursor-not-allowed');
    expect(html).not.toContain('disabled');
  });

  it('renders for a project task kept unscheduled — the flavor the project row opens', async () => {
    const html = await render({ keepUnscheduled: true, projectId: 'p1', date: '2030-03-15', startTime: '09:00', deadline: null });
    expect(html).toContain('Deadline');
  });

  it('renders NOTHING for a scheduled task: the save drops a deadline there', async () => {
    expect(await render({ date: '2030-03-15', startTime: '09:00', projectId: 'p1', deadline: null })).toBe('');
  });

  it('renders NOTHING for a series, even in the inbox flavor', async () => {
    expect(await render({ openInInbox: true, recurrence: { type: 'daily' }, deadline: null })).toBe('');
    expect(await render({ keepUnscheduled: true, projectId: 'p1', recurrence: { type: 'daily' }, deadline: null })).toBe('');
  });
});
