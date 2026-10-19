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

// An imported calendar event has nothing to tick off, and its card used to
// leave the checkbox's slot empty: the title sat flush left while every task
// beside it was indented past a circle. A calendar glyph now holds the slot.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};
const render = async (task) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
      formatTime: (t) => t, toggleComplete: noop, openMobileEditTask: noop, currentTime: new Date(), postponeTask: noop,
      updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
    }}>
      <FeaturesContext.Provider value={{ projects: [], goalsProjectsEnabled: false, generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null }}>
        <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null }}>
          <SchedTaskCard task={task} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('SchedTaskCard on an imported event', () => {
  const event = { id: 'e', title: 'Standup', date: '2099-01-01', startTime: '10:00', duration: 15, completed: false, imported: true };

  // MUTATION: drop the Calendar glyph from the event branch and this fails.
  it('holds the checkbox slot with a calendar glyph instead of a checkbox', async () => {
    const html = await render(event);
    expect(html).not.toContain('aria-label="Mark complete"');
    expect(html).toMatch(/<svg[^>]*class="lucide lucide-calendar[ "]/);
  });

  it('a task keeps its checkbox and gets no calendar glyph', async () => {
    const html = await render({ ...event, imported: false });
    expect(html).toContain('aria-label="Mark complete"');
    expect(html).not.toMatch(/<svg[^>]*class="lucide lucide-calendar[ "]/);
  });
});
