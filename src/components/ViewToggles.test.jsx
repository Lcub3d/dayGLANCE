import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES } from '../constants/views.js';
import ViewToggles from './ViewToggles.jsx';

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const render = async (language, planner, props) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18nFor(language)}>
    <DayPlannerContext.Provider value={{ darkMode: false, textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', setViewHidden: vi.fn(), ...planner }}>
      <ViewToggles {...props} />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);
const toggles = (html) => [...html.matchAll(/data-view-toggle="([a-z]+)" data-on="(true|false)"/g)].map((m) => `${m[1]}:${m[2]}`);

describe('ViewToggles', () => {
  it('lists the views in switcher order, hidden ones off, the home view always on and disabled', async () => {
    const html = await render('en', { hiddenViews: ['week', 'sched'] }, { views: DESKTOP_VIEW_MODES, label: (v) => v.toUpperCase() });
    expect(toggles(html)).toEqual(['multi:true', 'day:true', 'week:false', 'month:true', 'sched:false']);
    expect(html).toContain('Views on this device');
    expect(html).toContain('Always on');
    expect(html).toMatch(/data-view-toggle="multi"[^>]*>[\s\S]*?<input[^>]*disabled/);
    expect(html).not.toMatch(/data-view-toggle="day"[^>]*>[\s\S]*?<input[^>]*disabled[\s\S]*?data-view-toggle="week"/);
    expect(html).toContain('MULTI');
  });

  it('treats a missing hidden list as everything on, and is localized', async () => {
    const html = await render('de', { hiddenViews: undefined }, { views: MOBILE_VIEW_MODES, label: (v) => v });
    expect(toggles(html)).toEqual(['grid:true', 'list:true', 'month:true', 'sched:true']);
    expect(html).toContain('Ansichten auf diesem Gerät');
    expect(html).not.toContain('Views on this device');
  });
});
