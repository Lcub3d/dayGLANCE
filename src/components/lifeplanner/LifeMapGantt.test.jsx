import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import LifeMapGantt from './LifeMapGantt.jsx';
import { createLifeNode } from '../../lifeplanner/entities.js';
import { lifeNodesGraph } from '../../jobu/lifeNodeStore.js';
const resource = lng => JSON.parse(readFileSync(`public/locales/${lng}/translation.json`, 'utf8'));
const node = createLifeNode({ id: 'scheduled', title: 'My plan', type: 'wish', details: { schedule: { startDate: '2026-09-01', targetDate: '2027-09-30' } } });
const empty = createLifeNode({ id: 'undated', title: 'No dates' });
const native = createLifeNode({ id: 'g', title: 'Deadline only', type: 'goal', bindings: { goalId: 'g' }, details: { goal: { id: 'g', targetDate: '2026-09-30' } } });
async function render({ lng = 'en', ready = true, nodes = [node, empty, native], active = true, darkMode = false } = {}) {
  const i18n = createInstance(), bundle = resource(lng);await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle } } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><DayPlannerContext.Provider value={{ darkMode, textPrimary: 'text-slate-900', textSecondary: 'text-slate-500' }}>
    <LifeMapGantt graph={lifeNodesGraph(nodes)} nodes={nodes} ready={ready} active={active} />
  </DayPlannerContext.Provider></I18nextProvider>);
}
describe('LifeMap Gantt uses the native roadmap presentation', () => {
  it.each(readdirSync('public/locales'))('renders translated controls from the real %s bundle', async lng => {
    const html = await render({ lng });expect(html).toContain(resource(lng).lifeGantt.title);
    expect(html).not.toMatch(/lifeGantt\.|lifeMap\.|lifeBoard\.|goals\./);
    expect(html).toContain('data-gantt-row="undated"');expect(html).toContain('data-gantt-row="scheduled"');
    expect(html).toContain('aria-pressed="true"');
  });
  it('distinguishes an unread graph from an empty loaded graph', async () => {
    expect(await render({ ready: false })).toContain(resource('en').lifeBoard.preparing);
    expect(await render({ ready: false })).not.toContain('data-gantt-row');
    expect(await render({ nodes: [] })).toContain(resource('en').lifeGantt.empty);
  });
  it('is hidden rather than resetting its viewport state when the canvas is selected', async () => {
    expect(await render({ active: false })).toContain('hidden=""');
  });
  it('shares the actual grid/bar components, without importing any write path or a second timeline library', () => {
    const nativeSource = readFileSync('src/components/goals/GoalTimeline.jsx', 'utf8');
    const ganttSource = readFileSync('src/components/lifeplanner/LifeMapGantt.jsx', 'utf8');
    for (const source of [nativeSource, ganttSource]) { expect(source).toContain('RoadmapBar');expect(source).toContain('RoadmapGrid'); }
    expect(ganttSource).not.toMatch(/recordJobo|localStorage|\.save\(|patchLifeNode|\.transact\(/);
  });
  it('keeps all new keys and interpolation placeholders in parity', () => {
    const flatten = o => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? flatten(v).map(([x,y]) => [`${k}.${x}`, y]) : [[k,v]]);
    const en = flatten(resource('en').lifeGantt);
    for (const lng of readdirSync('public/locales')) {
      const bundle = flatten(resource(lng).lifeGantt);
      expect(bundle.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
      for (const [k,v] of en) {
        const value = bundle.find(([key]) => key === k)[1];expect(value.trim()).not.toBe('');
        expect((value.match(/\{\{[^}]+\}\}/g) || []).sort()).toEqual((v.match(/\{\{[^}]+\}\}/g) || []).sort());
      }
    }
  });
});
