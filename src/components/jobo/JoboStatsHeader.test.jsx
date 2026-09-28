import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import JoboStatsHeader from './JoboStatsHeader.jsx';
import { summaryPillClass } from '../SummaryStrip.jsx';
import { buildJoboDayModel } from '../../jobo/viewModel.js';

const model = buildJoboDayModel({ date: '2026-09-28', tasks: [], records: [] });
const ctx = { darkMode: false, borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500' };

describe('native read-only JOBO stats header', () => {
  it.each(['en', 'zh-CN', 'de', 'pl', 'uk'])('renders all five dimensions with the real %s bundle and no new action', async lng => {
    const i18n = i18next.createInstance();
    const resource = JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
    await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: resource } }, interpolation: { escapeValue: false } });
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><JoboStatsHeader model={model} ctx={ctx} /></I18nextProvider>);
    expect(html.match(/data-jobo-stat=/g)).toHaveLength(5);
    expect(html).toContain(resource.jobo.stats.native);
    expect(html).toContain(resource.jobo.stats.lateStart);
    expect(html).not.toContain('jobo.stats.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain(summaryPillClass(false));
    expect(html).toContain('flex-wrap');
    expect(html).toContain('col-span-2');
  });
  it('reuses the exported dark pill treatment without mounting the DAY strip or writing preferences', () => {
    const storage = vi.fn();
    vi.stubGlobal('localStorage', { setItem: storage });
    try {
      const html = renderToStaticMarkup(<JoboStatsHeader model={model} ctx={{ ...ctx, darkMode: true }} />);
      expect(html).toContain(summaryPillClass(true));
      expect(storage).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
