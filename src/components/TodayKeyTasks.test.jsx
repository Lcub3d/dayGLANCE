import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import TodayKeyTasks from './TodayKeyTasks.jsx';

// The control is absent unless today has starred tasks, which for most people on
// most days is always. That is the whole reason another button in a busy header
// is acceptable, so it is the case most worth pinning.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const TODAY = dateToString(new Date());
const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: TODAY, startTime: '09:00', ...over });

const render = async (tasks, extra = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      getTasksForDate: () => tasks,
      goToDate: vi.fn(), scrollToHour: vi.fn(), formatTime: (t) => t,
      darkMode: false, textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      ...extra,
    }}>
      <TodayKeyTasks />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('TodayKeyTasks', () => {
  it('renders nothing when nothing is starred today', async () => {
    expect(await render([task(), task({ id: 't2' })])).toBe('');
  });

  it('renders nothing when there are no tasks at all', async () => {
    expect(await render([])).toBe('');
  });

  it('renders nothing without a day-planner provider', async () => {
    const html = renderToStaticMarkup(<TodayKeyTasks />);
    expect(html).toBe('');
  });

  it('appears with a count once today has starred tasks', async () => {
    const html = await render([task({ starredDate: TODAY }), task({ id: 't2', starredDate: TODAY }), task({ id: 't3' })]);
    expect(html).toContain('lucide-star');
    expect(html).toContain('>2<');
  });

  it('ignores a star left behind by a task that moved to another day', async () => {
    // starredDate is the day the star was FOR; the task is no longer on it.
    expect(await render([task({ date: '2026-01-01', starredDate: TODAY })])).toBe('');
  });

  it('ignores tasks starred for a different day', async () => {
    expect(await render([task({ date: '2026-01-01', starredDate: '2026-01-01' })])).toBe('');
  });

  it('keeps the list closed until asked', async () => {
    const html = await render([task({ starredDate: TODAY })]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Write the report');
  });
});
