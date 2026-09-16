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

// The notes button on the Planner's card follows the open-book rule (#1658):
// a wikilinked note in the vault lights the button and shows the open book;
// dayGLANCE notes show the document; a task with neither is dimmed.

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
          <SchedTaskCard task={task} isInbox />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const notesButton = (html) => html.match(/<button[^>]*aria-label="(?:View notes and subtasks|Add notes or subtasks)"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

describe('SchedTaskCard notes icon', () => {
  it('a wikilinked task lights the button and shows the open book', async () => {
    const btn = notesButton(await render({ id: 'a', title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian', importSource: 'obsidian', completed: false }));
    expect(btn).toContain('lucide-book-open');
    expect(btn).toContain('opacity-70');
    expect(btn).toContain('View notes and subtasks');
  });
  it('dayGLANCE notes show the document, lit', async () => {
    const btn = notesButton(await render({ id: 'b', title: 'Fix the gutter #obsidian', importSource: 'obsidian', notes: 'call the roofer', completed: false }));
    expect(btn).toContain('lucide-file-text');
    expect(btn).not.toContain('lucide-book-open');
    expect(btn).toContain('opacity-70');
  });
  it('no notes anywhere: the document, dimmed', async () => {
    const btn = notesButton(await render({ id: 'c', title: 'Plain task', completed: false }));
    expect(btn).toContain('lucide-file-text');
    expect(btn).toContain('opacity-35');
    expect(btn).toContain('Add notes or subtasks');
  });
});
