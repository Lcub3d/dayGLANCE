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

// SCHED's card sizes (SCHED, the Project Planner, MONTH's panel and day
// sheet share it): the title one step up from text-sm, the meta row at
// text-sm with 14px icons, and tap targets the size guidance asks for. They
// were 10px icons in about 14px targets, too small to hit reliably.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};
const render = async (task, isInbox = true) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
      formatTime: (t) => t, toggleComplete: noop, openMobileEditTask: noop, currentTime: new Date(), postponeTask: noop,
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

const button = (html, label) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? '';
const iconWidth = (markup) => Number(/<svg[^>]*\swidth="(\d+)"/.exec(markup)?.[1]);

describe('SchedTaskCard sizes', () => {
  const task = { id: 'a', title: 'Call the bank #admin', date: '2099-01-01', startTime: '09:00', duration: 30, completed: false, notes: 'x' };

  it('reads one step larger: a text-base title over a text-sm meta row', async () => {
    const html = await render(task);
    expect(html).toMatch(/<span class="text-base font-medium[^"]*truncate/);
    expect(html).toMatch(/<span class="text-sm [^"]*flex items-center gap-3/);
  });

  // MUTATION: put a meta-row icon back to 10px and this fails.
  it('draws the meta row\'s controls at 14px with padded tap targets', async () => {
    const notes = button(await render(task), 'View notes and subtasks');
    expect(iconWidth(notes)).toBe(14);
    expect(notes).toContain('p-1.5 -m-1.5');
  });

  it('gives the checkbox and the row actions larger targets', async () => {
    const html = await render(task, false);
    expect(iconWidth(button(html, 'Mark complete'))).toBe(22);
    expect(iconWidth(button(html, 'Postpone to tomorrow'))).toBe(18);
    expect(button(html, 'Postpone to tomorrow')).toContain('p-2');
  });
});
