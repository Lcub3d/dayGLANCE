import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import TaskStarButton from './TaskStarButton.jsx';

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const render = async (task, ctx = { setTasks: vi.fn() }) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={ctx}>
      <TaskStarButton task={task} />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const DAY = '2026-09-18';
const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: DAY, startTime: '09:00', ...over });

describe('TaskStarButton', () => {
  it('renders an outline star on an unstarred task', async () => {
    const html = await render(task());
    expect(html).toContain('lucide-star');
    expect(html).toContain('fill="none"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('renders a filled star once starred', async () => {
    const html = await render(task({ starredDate: DAY }));
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('reads as unstarred after the task moves to another day', async () => {
    const html = await render(task({ date: '2026-09-20', starredDate: DAY }));
    expect(html).toContain('aria-pressed="false"');
  });

  it('renders nothing for an undated task', async () => {
    // The star is a statement about a particular day; an inbox item is not on one.
    expect(await render({ id: 't1', title: 'Someday' })).toBe('');
  });

  it('renders nothing where there is nothing to toggle', async () => {
    // Render-only surfaces such as the tray have no setTasks.
    expect(await render(task(), {})).toBe('');
  });

  it('offers the opposite action in its label', async () => {
    expect(await render(task())).toContain('Star as a key task for today');
    expect(await render(task({ starredDate: DAY }))).toContain('Remove key-task star');
  });
});
