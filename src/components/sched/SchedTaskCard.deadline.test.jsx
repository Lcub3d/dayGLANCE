import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import SchedTaskCard from './SchedTaskCard.jsx';
import useDeadlinePriority from '../../hooks/useDeadlinePriority.js';
import { dateToString } from '../../utils/taskUtils.js';

// Unscheduled project tasks are inbox tasks, so the PLANNER's unscheduled
// column carries the inbox's deadline button, and a deadline set there puts
// the task on the timeline like any inbox deadline.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};
const render = async (task, { isInbox = true, showDeadlinePicker = null } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
      formatTime: (t) => t, toggleComplete: noop, openMobileEditTask: noop, currentTime: new Date(), postponeTask: noop,
      showDeadlinePicker, setShowDeadlinePicker: noop,
      updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
    }}>
      <FeaturesContext.Provider value={{ projects: [], goalsProjectsEnabled: false, generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null }}>
        <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null }}>
          <SchedTaskCard task={task} isInbox={isInbox} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const deadlineButton = (html) => html.match(/<button[^>]*aria-label="Set deadline"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

const base = { id: 'p-task', title: 'Draft outline', duration: 30, completed: false, projectId: 'proj1', subtasks: [] };

describe('SchedTaskCard deadline button', () => {
  it('an unscheduled card offers a dimmed deadline button', async () => {
    const btn = deadlineButton(await render(base));
    expect(btn).toContain('lucide-calendar');
    expect(btn).toContain('opacity-35');
    expect(btn).toContain('title="Set deadline"');
  });

  it('a set deadline lights the button and shows its date', async () => {
    const btn = deadlineButton(await render({ ...base, deadline: '2030-03-15' }));
    expect(btn).toContain('text-blue-600');
    expect(btn).not.toContain('opacity-35');
    expect(btn).toMatch(/title="Deadline: [^"]+"/);
  });

  it('no button on a completed task or a dated (non-inbox) card', async () => {
    expect(deadlineButton(await render({ ...base, completed: true }))).toBe('');
    expect(deadlineButton(await render({ ...base, date: '2030-03-15', startTime: '09:00' }, { isInbox: false }))).toBe('');
  });

  // The PLANNER opens over the project card listing the same task, and the
  // picker state is one shared id: a card keyed on the bare id would open a
  // second menu from the card underneath.
  it('the card keys its picker apart from the project card row', async () => {
    const opened = (html) => /<span hidden="">/.test(html);
    expect(opened(await render(base, { showDeadlinePicker: 'p-task' }))).toBe(false);
    expect(opened(await render(base, { showDeadlinePicker: 'sched:p-task' }))).toBe(true);
  });
});

describe('project task deadlines reach the timeline', () => {
  it('getDeadlineTasksForDate returns an unscheduled project task due that day', () => {
    const due = dateToString(new Date(Date.now() + 3 * 86400000));
    const tasks = [
      { ...base, deadline: due },
      { id: 'plain', title: 'Inbox task', deadline: due, completed: false },
      { id: 'other', title: 'Other day', deadline: '2099-01-01', completed: false, projectId: 'proj1' },
    ];
    let found = null;
    const Probe = () => {
      const { getDeadlineTasksForDate } = useDeadlinePriority({
        unscheduledTasks: tasks, setUnscheduledTasks: noop, pushUndo: noop, playUISound: noop,
        onboardingProgress: {}, setOnboardingProgress: noop,
      });
      found = getDeadlineTasksForDate(due).map(t => t.id);
      return null;
    };
    renderToStaticMarkup(<Probe />);
    expect(found).toEqual(['p-task', 'plain']);
  });
});
