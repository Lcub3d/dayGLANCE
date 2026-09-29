import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import { createDoRecord } from '../../jobo/core.js';
import JoboStatsHeader from './JoboStatsHeader.jsx';
import CalendarHeader from '../CalendarHeader.jsx';

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => vi.unstubAllGlobals());

const date = '2026-09-28';
const selectedDate = new Date(2026, 8, 28, 12);
const task = { id: 't1', title: 'Work', date, startTime: '09:00', duration: 60, completed: true };
const stamp = `${date}T10:00:00+08:00`;
const row = createDoRecord({ id: 'do:t1:x', source: 'completion', taskId: 't1', title: 'Work', progress: 'partial',
  timing: 'timed', date, startTime: '09:10', endDate: date, endTime: '10:10', planSnapshot: { date, startTime: '09:00', duration: 60 },
  createdAt: stamp, updatedAt: stamp, observedAt: stamp });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function render({ lng = 'en', header = false, planner = {}, features = {}, props = {} } = {}) {
  const i18n = i18next.createInstance();
  const resource = JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
  await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: resource } }, interpolation: { escapeValue: false } });
  const ctx = { selectedDate, tasks: [task], unscheduledTasks: [], expandedRecurringTasks: [], recurringTasks: [],
    getTasksForDate: d => d.getDate() === 28 ? [task] : [], getDeadlineTasksForDate: () => [],
    effectiveViewMode: 'jobo', visibleDates: [selectedDate], weekViewDates: [selectedDate], dayViewColumns: [],
    textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', borderClass: 'border-stone-200', cardBg: 'bg-white',
    dailyNotes: {}, darkMode: false, ...planner };
  const featureValues = Object.defineProperties({ joboLoaded: true, joboRecords: [row] }, Object.getOwnPropertyDescriptors(features));
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={ctx}><FeaturesContext.Provider value={featureValues}>
      <SyncContext.Provider value={{}}>{header ? <CalendarHeader /> : <JoboStatsHeader {...props} />}</SyncContext.Provider>
    </FeaturesContext.Provider></DayPlannerContext.Provider>
  </I18nextProvider>);
  return { html, resource };
}

describe('read-only JOBO date-header tiles', () => {
  it.each(['en', 'zh-CN', 'de', 'pl', 'uk'])('renders all five tiles with the real %s bundle', async lng => {
    const { html, resource } = await render({ lng, props: { className: 'flex-1' } });
    expect(html.match(/data-jobo-stat=/g)).toHaveLength(5);
    expect(html).toContain(resource.jobo.stats.native);
    expect(html).toContain(resource.jobo.stats.lateStart);
    expect(html).not.toContain('jobo.stats.');
    expect(html).toContain('data-recorded-minutes="60"');
    expect(html).toContain('data-comparable-groups="1"');
    expect(html).toContain('min-w-[8.5rem]');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('flex-1');
    expect(html).not.toContain('flex-wrap');
    expect(html).not.toContain('<button');
    expect(html).not.toMatch(/<p(?:\s|>)/);
    expect(text(html)).not.toContain(resource.jobo.stats.scope.split(' · ')[0]);
  });

  it('keeps the three primary tiles visible and steps secondary tiles aside below xl', async () => {
    const { html } = await render();
    expect(html).toMatch(/data-jobo-stat="native" class="(?![^"]*hidden xl:flex)[^"]*"/);
    expect(html).toMatch(/data-jobo-stat="time" class="(?![^"]*hidden xl:flex)[^"]*"/);
    expect(html).toMatch(/data-jobo-stat="start" class="(?![^"]*hidden xl:flex)[^"]*"/);
    expect(html).toMatch(/data-jobo-stat="finish" class="[^"]*hidden xl:flex[^"]*"/);
    expect(html).toMatch(/data-jobo-stat="duration" class="[^"]*hidden xl:flex[^"]*"/);
  });

  it('is in CalendarHeader beside the date, not in the Plan/Do header', async () => {
    const { html } = await render({ header: true });
    expect(html).toContain(`data-day-header="${date}"`);
    expect(html).toContain('data-jobo-stats');
    expect(html.indexOf('data-day-header=')).toBeLessThan(html.indexOf('data-jobo-stats'));
    expect(html).toContain('data-day-header-actions');
    const view = readFileSync(new URL('../JoboView.jsx', import.meta.url), 'utf8');
    expect(view).not.toContain('JoboStatsHeader');
  });

  it.each([
    { joboLoaded: false, joboRecords: undefined },
    { joboLoaded: false, joboRecords: [row], joboError: 'storageRead' },
    { joboLoaded: true, joboRecords: undefined },
  ])('does not call an unread ledger an empty day (%j)', async features => {
    const { html } = await render({ features });
    expect(html).toBe('');
    const { html: header } = await render({ header: true, features });
    expect(header).toContain('data-day-header=');
    expect(header).not.toContain('data-jobo-stats');
  });

  it('renders loaded-empty figures but not a fabricated zero actual duration', async () => {
    const { html } = await render({ features: { joboRecords: [] }, planner: { tasks: [], getTasksForDate: () => [] } });
    expect(html).toContain('data-recorded-minutes=""');
    expect(text(html)).toContain('0 / 0');
    expect(text(html)).toContain('Recorded time —');
  });

  it('uses the selected day and current task state, not a cached previous model', async () => {
    const tomorrow = new Date(2026, 8, 29, 12);
    const { html } = await render({ planner: { selectedDate: tomorrow } });
    expect(html).toContain('data-jobo-stats-date="2026-09-29"');
    expect(html).toContain('data-recorded-minutes=""');
    expect(text(html)).toContain('0 / 0');
  });

  it.each(['month', 'week', 'multi', 'sched'])('does not inject JOBO stats or read its ledger in %s', async effectiveViewMode => {
    const features = { get joboRecords() { throw new Error('Other views must not read JOBO'); } };
    const { html } = await render({ header: true, planner: { effectiveViewMode }, features });
    expect(html).not.toContain('data-jobo-stats');
    if (effectiveViewMode === 'month') expect(html).toContain('data-month-stats');
  });

  it('uses the given theme without preferences or write actions', async () => {
    const storage = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: storage });
    try {
      const { html } = await render({ planner: { textPrimary: 'text-white', textSecondary: 'text-gray-400', borderClass: 'border-gray-700', darkMode: true } });
      expect(html).toContain('text-white');
      expect(html).toContain('border-gray-700');
      expect(storage).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
