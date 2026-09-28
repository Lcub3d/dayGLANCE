import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import LifeNetworkPanel from './LifeNetworkPanel.jsx';
import { analyzeNetwork, DEFAULT_SCENARIO_ID as s } from '../../lifeplanner/supportNetwork.js';
import { readLifeNetwork, valueId, edgeId } from '../../jobu/lifeNetworkStore.js';
const en = JSON.parse(fs.readFileSync('public/locales/en/translation.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('public/locales/zh-CN/translation.json', 'utf8'));
const nodes = ['health', 'speech', 'career'].map(id => ({ id, mapId: id, title: id, kind: 'goal' }));
const values = nodes.map((n, i) => ({ version: 1, scenarioId: s, nodeId: n.id, baseValue: [30, 20, 50][i], note: '' }));
const edges = ['health', 'speech'].map((source, i) => ({ version: 1, scenarioId: s, source, target: 'career', relation: 'supports', weight: [.6, .4][i], condition: 'unknown', note: '' }));
const records = [...values.map(v => ({ kind: 'lifeNetworkValue', entityId: valueId(s, v.nodeId), value: v })), ...edges.map(value => ({ kind: 'lifeNetworkEdge', entityId: edgeId(value), value }))].map((r, i) => ({ ...r, version: 1, id: `r${i}`, updatedAt: '2026-09-28T00:00:00Z', deleted: false }));
async function render(request, { lang = 'zh-CN', incomplete = false, readonly = false } = {}) {
  const i18n = createInstance(); await i18n.init({ lng: lang, resources: { en: { translation: en }, 'zh-CN': { translation: zh } }, interpolation: { escapeValue: false } });
  const state = readLifeNetwork(incomplete ? records.slice(1) : records);
  const controller = { nodes, state, scenarioId: s, status: { loaded: true, writable: !readonly }, writable: !readonly,
    analysis: analyzeNetwork({ nodes, edges: state.edges.map(r => r.value), evaluations: state.evaluations.map(r => r.value) }), pending: false, editRevision: 0 };
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><LifeNetworkPanel controller={controller} request={request} onRequest={() => true} onDirty={() => {}} onFocusNode={() => {}} onClose={() => {}} hiddenCount={0} /></I18nextProvider>);
}
describe('Lifemap comparison UI contracts', () => {
  it('renders independently derived 36/24/40 weights in a compact inspector', async () => {
    const html = await render({ mode: 'overview' });
    for (const s of ['36%', '24%', '40%', '重要度', '支撑网络']) expect(html).toContain(s);
    expect(html).not.toContain('lifeNetwork.');
  });
  it('keeps complete ranking unavailable with missing intrinsic ratings', async () => {
    const html = await render({ mode: 'overview' }, { incomplete: true });
    expect(html).not.toContain('36%'); expect(html).toContain('不把缺失值当成零');
  });
  it('shows an actual explanation with intrinsic value, contribution, alpha and rank range', async () => {
    const html = await render({ mode: 'node', nodeId: 'health' });
    expect(html).toContain('value="30"'); expect(html).toContain('36%'); expect(html).toContain('career'); expect(html).toContain('60%'); expect(html).toContain('分数从哪里来');
  });
  it('supports read-only inspection without mutation controls', async () => {
    const html = await render({ mode: 'node', nodeId: 'health' }, { readonly: true, lang: 'en' });
    expect(html).toContain('Read-only'); expect(html).toContain('type="submit" disabled');
  });
  it('allows both same-level and cross-level endpoints, never native reparenting', async () => {
    const html = await render({ mode: 'edge' });
    expect(html).toContain('value="health"'); expect(html).toContain('value="career"'); expect(html).toContain('不会改变原有归属');
  });
  it('has parity for new keys in every shipped locale', () => {
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]).sort();
    for (const lang of fs.readdirSync('public/locales')) {
      const f = `public/locales/${lang}/translation.json`; if (fs.existsSync(f)) expect(keys(JSON.parse(fs.readFileSync(f, 'utf8')).lifeNetwork)).toEqual(keys(en.lifeNetwork));
    }
  });
});
