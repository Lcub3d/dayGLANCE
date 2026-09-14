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

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const tiles = (html) => [...html.matchAll(/data-month-stats-tile="([a-z]+)"/g)].map((m) => m[1]);
const render = async (language, planner, props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18nFor(language)}>
    <DayPlannerContext.Provider value={{ textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', borderClass: 'border-stone-200', unscheduledTasks: [], recurringTasks: [], ...planner }}>
      <FeaturesContext.Provider value={{ isVisibleForUser: () => true }}>
        <MonthStats {...props} />
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const today = new Date(); today.setHours(12, 0, 0, 0);
const first = dayOfMonth(today, 1);
const tasks = [
  { id: 'a', title: 'A', date: ymd(first), startTime: '09:00', duration: 30, completed: true, focusMinutes: 25 },
  { id: 'b', title: 'B', date: ymd(first), startTime: '10:00', duration: 45, completed: false },
  { id: 'c', title: 'C', date: ymd(today), startTime: '11:00', duration: 60, completed: true },
];
const unscheduledTasks = [
  { id: 'in', title: 'inbox', completed: true, completedAt: `${ymd(first)}T10:00:00.000Z` },
];

describe('MonthStats', () => {
  it("lays out the selected date's month as stat tiles: completion, tasks, inbox, time, focus", async () => {
    const html = await render('en', { selectedDate: today, tasks, unscheduledTasks });
    expect(tiles(html)).toEqual(['completion', 'tasks', 'inbox', 'time', 'focus']);
    expect(html).toContain('data-month-stats-scheduled="3"');
    expect(html).toContain('data-month-stats-completed="2"');
    expect(html).toContain('data-month-stats-percent="67"');
    expect(html).toContain('data-month-stats-inbox-done="1"');
    expect(html).toContain('data-month-stats-planned-minutes="135"');
    expect(html).toContain('data-month-stats-spent-minutes="90"');
    expect(html).toContain('data-month-stats-focus-minutes="25"');
    const body = text(html);
    expect(body).toContain('Completion rate 67%');
    expect(body).toContain('Tasks completed 2 / 3 1 incomplete');
    expect(body).toContain('Inbox done 1');
    expect(body).toContain('Time spent 1h 30m of 2h 15m planned');
    expect(body).toContain('Focus time 25m');
    // The completion bar is filled to the percentage.
    expect(html).toContain('width:67%');
  });

  it('drops the focus tile when nothing was logged and the incomplete note when everything is done', async () => {
    const html = await render('en', { selectedDate: today, tasks: [{ id: 'a', title: 'A', date: ymd(today), startTime: '09:00', duration: 30, completed: true }] });
    expect(tiles(html)).toEqual(['completion', 'tasks', 'inbox', 'time']);
    expect(text(html)).toContain('100%');
    expect(text(html)).not.toContain('incomplete');
    expect(text(html)).toContain('Inbox done 0');
  });

  it('renders nothing for a future month, and a dash for a month with nothing scheduled', async () => {
    const next = new Date(); next.setMonth(next.getMonth() + 2, 1); next.setHours(12, 0, 0, 0);
    expect(await render('en', { selectedDate: next, tasks: [] })).toBe('');
    const html = await render('en', { selectedDate: today, tasks: [] });
    expect(html).toContain('data-month-stats-percent=""');
    expect(text(html)).toContain('Completion rate –');
    expect(html).toContain('width:0%');
  });

  it('compact: the percentage with its bar over the ratio, for the phone header', async () => {
    const html = await render('en', { selectedDate: today, tasks, unscheduledTasks }, { compact: true });
    expect(tiles(html)).toEqual([]);
    expect(text(html).trim()).toBe('67% 2/3 completed');
    expect(html).toContain('data-month-stats-percent="67"');
    expect(html).toContain('width:67%');
    expect(html).toContain('bg-brand');
  });

  it('takes the sizing class it is given', async () => {
    const html = await render('en', { selectedDate: today, tasks }, { className: 'flex-[2]' });
    expect(html).toMatch(/data-month-stats[^>]*class="[^"]*flex-\[2\]/);
  });

  it('is localized, percentage included', async () => {
    const html = await render('fr', { selectedDate: today, tasks, unscheduledTasks });
    const body = text(html);
    expect(body).not.toContain('completed');
    expect(body).not.toContain('planned');
    expect(body).toContain('67 %'); // fr places a space before the sign
    expect(html).toContain('data-month-stats-incomplete="1"');
  });
});
