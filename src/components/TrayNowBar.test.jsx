import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import TrayNowBar from './TrayNowBar.jsx';

// The tray's NOW bar gets an open-book button when the running task has a
// vault note (pushed as `note` by the main window, title already stripped),
// and nothing extra when it does not.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const render = async (currentTask) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <TrayNowBar darkMode={false} currentTask={currentTask} />
  </I18nextProvider>,
);

describe('TrayNowBar', () => {
  it('shows the open-book button for a task with a vault note', async () => {
    const html = await render({ id: 'a', title: 'Prepare #obsidian', note: 'Projects/dayGLANCE/NEXT- Prepare', startTime: '09:00', duration: 30 });
    expect(html).toContain('Now: Prepare #obsidian  ·  9am–9:30am');
    expect(html).toContain('lucide-book-open');
    expect(html).toContain('aria-label="Open “Projects/dayGLANCE/NEXT- Prepare” in Obsidian"');
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it('renders only the bar for a task without one', async () => {
    const html = await render({ id: 'b', title: 'Plain task', note: null, startTime: '09:00', duration: 30 });
    expect(html).not.toContain('lucide-book-open');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('renders nothing when no task is running', async () => {
    expect(await render(null)).toBe('');
  });
});
