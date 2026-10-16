import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2118: on desktop the strip folds into a caret over the hour gutter, the one
// spot of a timeline nothing else uses, so a collapsed strip covers no part of
// the grid. DAY view never scrolls, which is why that matters there most.

let dayTasks = [];
let dayWindow = null;
let isToday = false;

vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({
    selectedDate: new Date('2026-10-16T12:00:00Z'),
    getTasksForDate: () => dayTasks,
    listEndOfDayTime: null, visibleDays: 1, isToday,
    darkMode: false, textPrimary: '', textSecondary: '',
  }),
}));
vi.mock('../context/FeaturesContext.jsx', () => ({
  useFeaturesCtx: () => ({
    getDayWindow: () => dayWindow,
    dayWindowMenuOpen: false, setDayWindowMenuOpen: () => {},
  }),
}));

const { default: SummaryStrip, DESKTOP_COLLAPSE_KEY } = await import('./SummaryStrip.jsx');

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  dayTasks = [{ id: 1, title: 'Write #work', startTime: '09:00', duration: 60, date: '2026-10-16' }];
  dayWindow = null;
  isToday = false;
});
afterEach(() => vi.unstubAllGlobals());

async function render(props = {}) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><SummaryStrip {...props} /></I18nextProvider>);
}

describe('SummaryStrip desktop gutter caret', () => {
  it('defaults to expanded: the pills and a caret that hides them', async () => {
    const html = await render();
    expect(html).toContain('aria-label="Hide day summary"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('unblocked');
    expect(html).toContain('#work');
  });

  it('collapsed, it renders the caret alone and no pills over the grid', async () => {
    store.set(DESKTOP_COLLAPSE_KEY, '1');
    const html = await render();
    expect(html).toContain('aria-label="Show day summary"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('unblocked');
    expect(html).not.toContain('#work');
  });

  it('starts at the gutter\'s right edge, beside the pills', async () => {
    expect(await render()).toContain('left:38px;bottom:8px');
  });

  it('does not share the touch strip\'s flag', async () => {
    store.set('day-planner-summary-strip-collapsed', '1');
    const html = await render();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('#work');
  });

  it('keeps the empty-day hint visible, and offers no caret, even when collapsed', async () => {
    dayTasks = [];
    store.set(DESKTOP_COLLAPSE_KEY, '1');
    const html = await render();
    expect(html).toContain('Set day window');
    expect(html).not.toContain('day summary');
  });

  it('has no caret while the macOS title bar carries today\'s pills', async () => {
    isToday = true;
    const html = await render({ titlebarPills: true });
    expect(html).not.toContain('day summary');
    expect(html).not.toContain('#work');
  });

  it('leaves the touch variants on their own collapse', async () => {
    const compact = await render({ compact: true });
    expect(compact).not.toContain('day summary');
    const list = await render({ compact: true, staticPlacement: true });
    expect(list).not.toContain('day summary');
  });
});
