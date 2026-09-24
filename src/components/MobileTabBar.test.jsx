import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({
    tabBarRef: null, currentTime: new Date(),
    mobileActiveTab: 'timeline', setMobileActiveTab: () => {},
    setMobileSettingsView: () => {},
    cardBg: '', borderClass: '', textSecondary: '',
    filteredUnscheduledTasks: [], todayAgenda: [],
    goToToday: () => {},
  }),
}));
vi.mock('../context/FeaturesContext.jsx', () => ({
  useFeaturesCtx: () => ({
    goalsProjectsEnabled: false, goals: [], handleRoutinesDone: () => {},
    isVisibleForUser: () => true,
  }),
}));

const { default: MobileTabBar } = await import('./MobileTabBar.jsx');

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: language, fallbackLng: false,
    resources: { [language]: { translation: bundle } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

// task.inbox is the lowercase, mid-sentence form ("add to inbox"); a tab or
// panel label must use the capitalised settings.inbox. The label once shipped
// lowercase because the two keys were swapped.
describe('MobileTabBar inbox label', () => {
  it('renders the capitalised Inbox label', async () => {
    const i18n = await i18nFor('en');
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}><MobileTabBar /></I18nextProvider>
    );
    expect(html).toContain('>Inbox</span>');
    expect(html).not.toContain('>inbox</span>');
  });
});
