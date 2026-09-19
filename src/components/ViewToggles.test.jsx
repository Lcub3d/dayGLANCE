import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES, offeredViews } from '../constants/views.js';
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
  // Settings hands this the views a device may turn on or off: the registry
  // minus every experimental view whose flag is off (offeredViews). JOBO off is
  // the everyday case, so it gets no switch here.
  it("lists a switcher's views in order with its hidden ones off, and any view can be turned off", async () => {
    const html = await render('en', { hiddenViews: { desktop: ['multi', 'sched'], mobile: ['month'] } }, { scope: 'desktop', views: offeredViews(DESKTOP_VIEW_MODES), label: (v) => v.toUpperCase() });
    expect(toggles(html)).toEqual(['multi:false', 'day:true', 'week:true', 'month:true', 'sched:false']);
    expect(html).toContain('data-view-toggles="desktop"');
    expect(html).toContain('Views on this device');
    expect(html).not.toContain('disabled');
    expect(html).toContain('MULTI');
  });

  it('offers JOBO a switch of its own only once its flag is on', async () => {
    const views = offeredViews(DESKTOP_VIEW_MODES, { joboEnabled: true });
    const html = await render('en', { hiddenViews: { desktop: [], mobile: [] } }, { scope: 'desktop', views, label: (v) => v.toUpperCase() });
    expect(toggles(html)).toEqual(['multi:true', 'day:true', 'week:true', 'month:true', 'sched:true', 'jobo:true']);
  });

  it("reads the other switcher's list for scope mobile, and disables the last switch still on", async () => {
    const html = await render('en', { hiddenViews: { desktop: ['month'], mobile: ['grid', 'list', 'sched'] } }, { scope: 'mobile', views: MOBILE_VIEW_MODES, label: (v) => v });
    expect(toggles(html)).toEqual(['grid:false', 'list:false', 'month:true', 'sched:false']);
    expect(html).toMatch(/data-view-toggle="month"[^>]*>[\s\S]*?<input[^>]*disabled/);
    expect(html).not.toMatch(/data-view-toggle="grid"[^>]*>[\s\S]*?<input[^>]*disabled[\s\S]*?data-view-toggle="list"/);
  });

  it('takes a heading of its own and can drop the hint, treats missing lists as everything on, and is localized', async () => {
    const html = await render('de', { hiddenViews: undefined }, { scope: 'desktop', views: ['multi', 'month', 'sched'], label: (v) => v, heading: 'Querformat', hint: false });
    expect(toggles(html)).toEqual(['multi:true', 'month:true', 'sched:true']);
    expect(html).toContain('Querformat');
    expect(html).not.toContain('Ansichten auf diesem Gerät');
    const withHint = await render('de', { hiddenViews: undefined }, { scope: 'mobile', views: MOBILE_VIEW_MODES, label: (v) => v });
    expect(withHint).toContain('Ansichten auf diesem Gerät');
    expect(withHint).not.toContain('Views on this device');
  });
});
