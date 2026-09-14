import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import MonthStats from './MonthStats.jsx';

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOfMonth = (d, day) => { const x = new Date(d); x.setDate(day); x.setHours(12, 0, 0, 0); return x; };

const text = (html) => html.replace(/<[^>]+>/g, ' ');
const render = async (language, planner) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18nFor(language)}>
    <DayPlannerContext.Provider value={{ textSecondary: 'text-stone-500', unscheduledTasks: [], recurringTasks: [], ...planner }}>
      <FeaturesContext.Provider value={{ isVisibleForUser: () => true }}>
        <MonthStats />
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('MonthStats', () => {
  it("shows done out of scheduled and the incomplete count for the selected date's month", async () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const first = dayOfMonth(today, 1);
    const tasks = [
      { id: 'a', title: 'A', date: ymd(first), startTime: '09:00', duration: 30, completed: true },
      { id: 'b', title: 'B', date: ymd(first), startTime: '10:00', duration: 30, completed: false },
      { id: 'c', title: 'C', date: ymd(today), startTime: '11:00', duration: 30, completed: true },
    ];
    const html = await render('en', { selectedDate: today, tasks });
    expect(html).toContain('data-month-stats-scheduled="3"');
    expect(html).toContain('data-month-stats-completed="2"');
    expect(html).toContain('2/3 completed');
    expect(html).toContain('1 incomplete');
  });

  it('renders nothing for a future month, and no incomplete label when everything is done', async () => {
    const next = new Date(); next.setMonth(next.getMonth() + 2, 1); next.setHours(12, 0, 0, 0);
    expect(await render('en', { selectedDate: next, tasks: [] })).toBe('');
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const html = await render('en', { selectedDate: today, tasks: [{ id: 'a', title: 'A', date: ymd(today), startTime: '09:00', duration: 30, completed: true }] });
    expect(text(html)).toContain('1/1 completed');
    expect(text(html)).not.toContain('incomplete');
  });

  it('is localized', async () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const html = await render('de', { selectedDate: today, tasks: [{ id: 'a', title: 'A', date: ymd(today), startTime: '09:00', duration: 30, completed: false }] });
    expect(text(html)).not.toContain('completed');
    expect(text(html)).toContain('1');
    expect(html).toContain('data-month-stats-incomplete="1"');
  });
});
