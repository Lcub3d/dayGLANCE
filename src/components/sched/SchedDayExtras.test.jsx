import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SchedDeadlineCard } from './SchedDayExtras.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// The SCHED day group's deadline card (#2116).
//
// It used to make the WHOLE card a "pick a time" affordance: tapping anywhere
// opened the ClockTimePicker, so there was no way to reach the editor from the
// row, and the calendar glyph on the right was decoration inside that same tap
// target. It also rendered no project pill while every scheduled card beside it
// did. Now the card opens the task (like every other card) and only the calendar
// button schedules it; the project shows.
// ─────────────────────────────────────────────────────────────────────────────

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};

const render = async (task, { goalsProjectsEnabled = true, projects = [] } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200',
      textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
      scheduleDeadlineTaskAt: noop, use24HourClock: true, isTablet: false,
      openMobileEditTask: noop,
    }}>
      <FeaturesContext.Provider value={{ projects, goalsProjectsEnabled }}>
        <SchedDeadlineCard task={task} dateStr="2030-03-15" />
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const base = { id: 'u1', title: 'Call the plumber', deadline: '2030-03-15', duration: 30, completed: false, projectId: 'p1' };
const scheduleButton = (html) => html.match(/<button[^>]*aria-label="Schedule for today"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

describe('SchedDeadlineCard', () => {
  it('the card itself is the way INTO the editor, not into the time picker', async () => {
    const html = await render(base);
    expect(html).toContain('title="Edit"');
    // The time picker is now behind its own control, which is a real button.
    expect(scheduleButton(html)).toContain('lucide-calendar-plus');
  });

  it('a completed card offers no schedule button', async () => {
    const html = await render({ ...base, completed: true });
    expect(scheduleButton(html)).toBe('');
    expect(html).toContain('line-through');
  });

  it('shows the project the task belongs to', async () => {
    const html = await render(base, { projects: [{ id: 'p1', title: 'Home admin' }] });
    expect(html).toContain('Home admin');
  });

  it('shows no pill when the task has no project, or goals/projects are off', async () => {
    const noProject = await render({ ...base, projectId: undefined }, { projects: [{ id: 'p1', title: 'Home admin' }] });
    expect(noProject).not.toContain('Home admin');
    const off = await render(base, { goalsProjectsEnabled: false, projects: [{ id: 'p1', title: 'Home admin' }] });
    expect(off).not.toContain('Home admin');
  });

  it('still reads as a deadline with its duration', async () => {
    const html = await render(base);
    expect(html).toContain('Deadline');
    expect(html).toContain('30m');
  });
});
