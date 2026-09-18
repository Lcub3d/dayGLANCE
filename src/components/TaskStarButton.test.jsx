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

describe('read-only mode, for surfaces that report rather than edit', () => {
  const renderRO = async (task) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <DayPlannerContext.Provider value={{ setTasks: vi.fn() }}>
        <TaskStarButton task={task} readOnly />
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );

  it('shows a filled star for a starred task', async () => {
    const html = await renderRO(task({ starredDate: DAY }));
    expect(html).toContain('lucide-star');
    expect(html).toContain('fill="currentColor"');
  });

  it('shows nothing at all for an unstarred task', async () => {
    // A faint outline you cannot act on would be noise on every row.
    expect(await renderRO(task())).toBe('');
  });

  it('offers no toggle', async () => {
    expect(await renderRO(task({ starredDate: DAY }))).not.toContain('<button');
  });

  it('still renders without anything to toggle with', async () => {
    const html = renderToStaticMarkup(<TaskStarButton task={task({ starredDate: DAY })} readOnly />);
    expect(html).toContain('lucide-star');
  });
});

describe('recurring occurrences', () => {
  // Generated for display, with no stored row behind them: setTasks maps the real
  // tasks by id and would match none of them, so a toggle would look like it
  // worked and change nothing.
  const occurrence = { id: 'recurring-abc-2026-09-18', title: 'Standup', date: DAY, startTime: '09:00' };

  it('gets no toggle', async () => {
    expect(await render(occurrence)).toBe('');
  });

  it('gets no read-only star either, even if one is somehow set', async () => {
    const html = renderToStaticMarkup(
      <TaskStarButton task={{ ...occurrence, starredDate: DAY }} readOnly />,
    );
    expect(html).toBe('');
  });
});
