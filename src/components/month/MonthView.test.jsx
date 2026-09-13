import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import MonthView, { monthViewRangeFor } from './MonthView.jsx';

// Static markup, no DOM. The range lifecycle (publish while mounted, replace
// on navigation, clear on unmount) lives in an effect, which static
// rendering never runs, so it is covered by the browser check; the pure
// range helper and what the view draws for a selectedDate are covered here.

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
}

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const render = (i18n, selectedDate, weekStartDay = 0) => {
  const planner = {
    selectedDate, weekStartDay,
    goToDate: vi.fn(), setMonthViewRange: vi.fn(),
    getTasksForDate: (date) => (date.getDate() === 16 && date.getMonth() === 8 ? [{ id: 't1', title: 'Design review', date: '2026-09-16', startTime: '14:00', duration: 60, isAllDay: false, completed: false }] : []),
    getDeadlineTasksForDate: () => [],
  };
  const features = { routinesEnabled: false, todayRoutines: [], routinesDate: null, routineCompletions: {} };
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <MonthView width={1120} height={700} />
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
};

describe('monthViewRangeFor', () => {
  it('spans the whole drawn grid, leading and trailing days included', () => {
    expect(monthViewRangeFor(2026, 9, 0)).toEqual({ from: '2026-08-30', to: '2026-10-03' });
    expect(monthViewRangeFor(2026, 9, 1)).toEqual({ from: '2026-08-31', to: '2026-10-04' });
  });
  it('crosses the year for January and December', () => {
    expect(monthViewRangeFor(2027, 1, 0)).toEqual({ from: '2026-12-27', to: '2027-02-06' });
    expect(monthViewRangeFor(2026, 12, 0)).toEqual({ from: '2026-11-29', to: '2027-01-02' });
  });
});

describe('MonthView', () => {
  it("shows selectedDate's month with selectedDate highlighted and no sheet until a day is tapped", async () => {
    const html = render(await i18nFor('en'), new Date(2026, 8, 16, 12));
    expect(html).toContain('data-month-view');
    expect(html).toContain('data-month-grid="2026-09"');
    expect(html).toMatch(/data-month-cell="2026-09-16"[^>]*data-selected="true"/);
    expect((html.match(/data-selected="true"/g) || []).length).toBe(1);
    expect(html).not.toContain('data-month-day-sheet');
    // The grid has no header of its own: the app chrome names the month.
    expect(html).not.toContain('<h2');
  });

  it('follows selectedDate into another month and the week-start setting', async () => {
    const html = render(await i18nFor('de'), new Date(2027, 0, 5, 12), 1);
    expect(html).toContain('data-month-grid="2027-01"');
    expect(html).toMatch(/data-month-cell="2027-01-05"[^>]*data-selected="true"/);
    const weekdays = html.slice(html.indexOf('data-month-grid-weekdays'), html.indexOf('data-month-grid-area'));
    expect(weekdays.indexOf('Mo')).toBeLessThan(weekdays.indexOf('So'));
  });
});
