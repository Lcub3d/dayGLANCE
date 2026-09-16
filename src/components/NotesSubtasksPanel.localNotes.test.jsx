import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';

// A linked task can hold notes in two places (report
// docs/reports/obsidian-linked-note-append.md, F4): the panel shows the
// linked-note editor and, beneath it, the local notes whenever the record
// holds any. Without the linked-note loader (a surface that does not wire
// it) the local block renders alone, as it always did.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};
const linkedTask = (notes) => ({ id: 't1', title: 'Prepare [[Projects/dayGLANCE/NEXT- Prepare]] #obsidian', notes, subtasks: [] });
const render = async (task, extra = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <NotesSubtasksPanel
      task={task} isInbox darkMode={false} noAutoFocus
      updateTaskNotes={noop} addSubtask={noop} toggleSubtask={noop} deleteSubtask={noop} updateSubtaskTitle={noop}
      wikilinks={['Projects/dayGLANCE/NEXT- Prepare']}
      {...extra}
    />
  </I18nextProvider>,
);

describe('NotesSubtasksPanel: local notes on a linked task', () => {
  it('plugin shape: the linked-note editor and, beneath it, the local notes with their own label', async () => {
    const html = await render(linkedTask('stranded text'), { onLoadWikiNote: async () => ({ text: '' }), onSaveWikiNote: noop });
    expect(html).toContain('Projects/dayGLANCE/NEXT- Prepare');
    expect(html).toContain('data-local-notes="beside-linked"');
    expect(html).toContain('Notes in dayGLANCE');
    expect(html).toContain('stranded text');
  });
  it('plugin shape, no local notes: the linked-note editor alone', async () => {
    const html = await render(linkedTask(''), { onLoadWikiNote: async () => ({ text: '' }), onSaveWikiNote: noop });
    expect(html).not.toContain('data-local-notes');
    expect(html).not.toContain('Notes in dayGLANCE');
  });
  it('without the linked-note loader: the local block alone, plainly labelled', async () => {
    const html = await render(linkedTask('stranded text'));
    expect(html).toContain('data-local-notes="only"');
    expect(html).toContain('stranded text');
    expect(html).not.toContain('Notes in dayGLANCE');
  });
});
