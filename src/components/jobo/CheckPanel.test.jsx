import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CheckSummary } from './CheckPanel.jsx';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { createDoRecord } from '../../jobo/core.js';

const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { ...plan, id: 't1', title: 'Secret title #not-a-category', priority: 3, completed: true, originalPlan: plan };
const stamp = `${date}T11:00:00+08:00`;
const record = createDoRecord({ id: 'r1', taskId: 't1', title: task.title, source: 'completion', timing: 'timed',
  date, startTime: '09:10', endDate: date, endTime: '10:20', progress: 'mostly', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp });
const build = (records = [record]) => buildJoboDayModel({ date, records, tasks: [task], taskLookup: [task] });
async function render(lng = 'en', props = {}) {
  const bundle = JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><CheckSummary date={date} model={build()} loaded {...props} /></I18nextProvider>);
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Check as six short sections of prose', () => {
  it.each(['en', 'zh-CN', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'])('renders six sections from the %s bundle', async lng => {
    const html = await render(lng);
    expect([...html.matchAll(/data-check-section="([^"]+)"/g)].map(match => match[1]))
      .toEqual(['completion', 'time', 'planChanges', 'deviations', 'structure', 'evidence']);
    expect(html).not.toMatch(/jobo\.check\.|\{\{|NaN|undefined|Infinity/);
    expect(html).not.toMatch(/<table|<input|<textarea|<select|<button|<svg/);
    expect(text(html)).not.toContain('Secret title');
    expect(text(html)).not.toContain('#not-a-category');
    for (const priority of ['p1', 'p2', 'p3', 'p4', 'unknown']) expect(html).toContain(`data-check-priority="${priority}"`);
  });
  it('renders separate native completion, measured duration, timing differences and attempt progress', async () => {
    const words = text(await render('zh-CN'));
    expect(words).toContain('定时任务 1 / 1 完成');
    expect(words).toContain('开始：提前 0，准时 0，偏晚 1');
    expect(words).toContain('完成 0，大部分完成 1，部分完成 0，已开始 0');
    expect(words).toContain('P1 1 / 1');
    expect(words).toContain('真实计时覆盖');
  });
  it('explains current priorities, full groups and non-additive priority coverage', async () => {
    const words = text(await render());
    expect(words).toContain('not historical snapshots');
    expect(words).toContain('Priority coverages overlap');
    expect(words).toContain('including other days');
  });
  it('distinguishes loading and failed reads from loaded-empty', async () => {
    expect(await render('en', { loaded: false })).not.toContain('data-check-section');
    const failed = await render('en', { error: 'storageRead' });
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('data-check-section');
    const empty = text(await render('en', { model: build([]) }));
    expect(empty).toContain('No Do recorded');
    expect(empty).toContain('Measured coverage: —');
  });
  it('masks invalid-ledger execution totals rather than inventing complete figures', async () => {
    const words = text(await render('en', { model: build([record, { id: 'bad' }]) }));
    expect(words).toContain('invalid record');
    expect(words).toContain('Start: early —, on time —, late —');
    expect(words).toContain('Measured coverage: —');
  });
  it('changes with fresh committed input and never prints a cached earlier count', async () => {
    const first = text(await render());
    const next = text(await render('en', { model: build([{ ...record, progress: 'partial' }]) }));
    expect(first).toContain('mostly 1, partial 0');
    expect(next).toContain('mostly 0, partial 1');
  });
  it('integrates through the existing committed model and only passes display inputs', () => {
    const source = readFileSync(new URL('../JoboView.jsx', import.meta.url), 'utf8');
    const panel = source.match(/<CheckPanel[\s\S]*?\/>/)[0];
    expect(source).toContain('data-jobo-check-toggle');
    expect(panel).toContain('model={model}');
    expect(panel).not.toMatch(/ctx=|recordJobo|writer|workingSet|setTasks|reloadJobo|onEdit|onComplete/);
    for (const filename of ['CheckPanel.jsx', 'checkSummary.js']) {
      const s = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8');
      expect(s).not.toMatch(/localStorage|indexedDB|recordJobo|setTasks|fetch\(|dangerouslySetInnerHTML/);
    }
  });
});
