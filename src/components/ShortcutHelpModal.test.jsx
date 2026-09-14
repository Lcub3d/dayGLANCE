import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import ShortcutHelpModal from './ShortcutHelpModal.jsx';

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const render = async (planner) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18nFor('en')}>
    <DayPlannerContext.Provider value={{ setShowShortcutHelp: vi.fn(), cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', darkMode: false, ...planner }}>
      <ShortcutHelpModal />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);
const keys = (html) => [...html.matchAll(/<kbd[^>]*>([^<]+)<\/kbd>/g)].map((m) => m[1]).filter((k) => /^[1-5C]$/.test(k));

describe('ShortcutHelpModal view keys', () => {
  it('lists the keys this width offers, minus views turned off on this device', async () => {
    expect(keys(await render({ canShowViewCycler: true, hiddenViews: [] }))).toEqual(['1', '2', '3', '4', '5', 'C']);
    expect(keys(await render({ canShowViewCycler: true, hiddenViews: ['month', 'day'] }))).toEqual(['1', '3', '5', 'C']);
    expect(keys(await render({ canShowViewCycler: false, schedOnlyCycler: true, hiddenViews: ['sched'] }))).toEqual(['1', '4', 'C']);
    expect(keys(await render({ canShowViewCycler: false, schedOnlyCycler: false, hiddenViews: [] }))).toEqual([]);
  });
});
