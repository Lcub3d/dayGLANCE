import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// Goals & Projects is a space of its own on desktop and tablet (the header's
// switcher, or `g`), so the GLANCE panel no longer carries a pill that opens
// it — even with the feature on.
vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({
    darkMode: false, textPrimary: '', setDailyNotesModalDate: () => {}, getTodayStr: () => '2026-09-26',
    recycleBin: [], setShowMobileDailySummary: () => {},
    actualTodayNonImportedTasks: [], actualTodayCompletedTasks: [], inboxCompletedTodayCount: 0,
  }),
}));
vi.mock('../context/SyncContext.jsx', () => ({
  useSyncCtx: () => ({ obsidianConfig: { enabled: false }, setShowMobileRecycleBin: () => {} }),
}));
vi.mock('../context/FeaturesContext.jsx', () => ({
  useFeaturesCtx: () => ({
    goalsProjectsEnabled: true, setShowGoalsDashboard: () => {},
    setShowWeeklyReview: () => {}, showWeeklyReviewReminder: false, setShowWeeklyReviewReminder: () => {},
    weeklyReviewDismissedRef: { current: null }, lastWeeklyReviewFiredRef: { current: null },
  }),
}));

const { default: GlanceFabs } = await import('./GlanceFabs.jsx');

async function render() {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><GlanceFabs /></I18nextProvider>);
}

describe('GlanceFabs', () => {
  it('keeps the daily note pill but no Goals & Projects pill, even with the feature on', async () => {
    const html = await render();
    expect(html).toContain('Daily Note');
    expect(html).not.toContain('Goals &amp; Projects');
    expect(html).not.toContain('Goals & Projects');
  });
});
