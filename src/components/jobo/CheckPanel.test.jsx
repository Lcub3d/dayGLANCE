import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CheckJournal } from './CheckPanel.jsx';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { createDoRecord } from '../../jobo/core.js';
import { summaryRows, timingRows } from './ExecutionAxes.jsx';

const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { ...plan, id: 't1', title: 'Report', color: 'bg-green-500', priority: 0, completed: true };
const stamp = `${date}T11:00:00+08:00`;
const row = (over = {}) => createDoRecord({ id: 'r1', taskId: 't1', title: task.title, source: 'completion', timing: 'timed',
  date, startTime: '09:10', endDate: date, endTime: '10:20', progress: 'mostly', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over });
const build = (records = [row()], extra = {}) => buildJoboDayModel({ date, records, tasks: [task], taskLookup: [task], ...extra });
const locales = ['en', 'zh-CN', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'];
const bundle = lng => JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
async function render(lng = 'en', props = {}) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle(lng) } }, interpolation: { escapeValue: false } });
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><CheckJournal date={date} model={build()} loaded onOpenNotes={vi.fn()} {...props} /></I18nextProvider>);
  return { html, t: i18n.t.bind(i18n) };
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Check reads as the execution journal from #1726 / #1882', () => {
  it.each(locales)('renders the actual %s translations and existing card terminology', async lng => {
    const { html, t } = await render(lng);
    expect(html).toContain('Report');
    expect(html).toContain('color:#22c55e');
    expect(html).toContain('09:00–10:00');
    expect(html).toContain('09:10–10:20');
    expect(html).toContain('data-check-progress="mostly"');
    expect(html).toContain('data-check-notes');
    expect(html).not.toMatch(/jobo\.(check|view)\.|\{\{|NaN|undefined|Infinity/);
    expect(html).not.toMatch(/<table|<input|<textarea|<select/);
    expect(text(html)).not.toMatch(/P[1-4]|Allen|captured-plan groups|measured pieces/);
    const item = build().plans[0];
    for (const r of [...summaryRows(item.labels, item.comparison, t), ...timingRows(item.comparison, t)]) {
      expect(text(html)).toContain(r.text);
    }
    const copy = bundle(lng).jobo.check;
    expect(Object.keys(copy).sort()).toEqual(Object.keys(bundle('en').jobo.check).sort());
    for (const [key, value] of Object.entries(copy)) {
      expect(value).not.toContain('—');
      expect(value.match(/\{\{\w+\}\}/g) || []).toEqual(bundle('en').jobo.check[key].match(/\{\{\w+\}\}/g) || []);
      if (lng !== 'en') expect(value).not.toBe(bundle('en').jobo.check[key]);
    }
  });
  it('lists sessions once with individual progress, without replacing it with native completion', async () => {
    const second = row({ id: 'r2', startTime: '11:00', endTime: '11:30', progress: 'partial', createdAt: `${date}T12:00:00+08:00`, updatedAt: `${date}T12:00:00+08:00` });
    const { html } = await render('en', { model: build([row(), second]) });
    expect([...html.matchAll(/data-check-entry=/g)]).toHaveLength(1);
    expect([...html.matchAll(/data-check-session=/g)]).toHaveLength(2);
    expect(html).toContain('Session 1'); expect(html).toContain('Session 2');
    expect(text(html)).toContain('Latest: Partial');
    expect(text(html)).not.toContain('Completed');
  });
  it('does not paint an untimed completion as an actual interval', async () => {
    const { html } = await render('en', { model: build([row({ timing: 'untimed', startTime: null, endDate: null, endTime: null })]) });
    expect(text(html)).toContain('Time not recorded');
    expect(html).toContain('data-check-completion');
    expect(text(html)).not.toContain('0 min');
    expect(html).not.toContain('data-check-timing');
  });
  it('does not present a manual untimed save timestamp as execution time', async () => {
    const { html } = await render('en', { model: build([row({ timing: 'untimed', source: 'manual', taskId: null, planSnapshot: null, startTime: null, endDate: null, endTime: null })]) });
    expect(html).not.toContain('data-check-completion'); expect(html).not.toContain('data-check-notes');
  });
  it('shows dates for off-day sessions and does not hide them behind today’s clock', async () => {
    const { html } = await render('en', { model: build([row({ date: '2026-09-27', startTime: '23:30', endTime: '00:30' })]) });
    expect(html).toContain('2026-09-27 23:30–2026-09-28 00:30');
    expect(text(html)).not.toContain('Includes sessions on other days.');
  });
  it('marks inferred intervals and suppresses exact timing comparisons', async () => {
    const { html } = await render('en', { model: build([row({ timingBasis: 'planDuration' })]) });
    expect(text(html)).toContain('Start time inferred'); expect(html).not.toContain('data-check-timing');
  });
  it('has no notes action for orphaned tasks and keeps their captured titles', async () => {
    const { html } = await render('en', { model: build([row()], { tasks: [], taskLookup: [] }) });
    expect(html).toContain('Report'); expect(html).not.toContain('data-check-notes');
  });
  it('escapes record titles instead of trusting them as markup', async () => {
    const { html } = await render('en', { model: build([row({ title: '<img src=x onerror=alert(1)>' })], { tasks: [], taskLookup: [] }) });
    expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  });
  it('retains load, error, empty and malformed evidence distinctions', async () => {
    expect((await render('en', { loaded: false })).html).toContain('Loading');
    const failed = (await render('en', { error: 'storageRead' })).html;
    expect(failed).toContain('role="alert"'); expect(failed).not.toContain('Report');
    const empty = (await render('en', { model: build([]) })).html;
    expect(text(empty)).toContain('No executions recorded'); expect(empty).not.toContain('data-check-entry');
    const broken = (await render('en', { model: build([row(), { id: 'broken' }]) })).html;
    expect(text(broken)).toContain('Some execution records could not be loaded.'); expect(broken).toContain('Report');
    expect(broken).not.toContain('data-check-timing'); expect(broken).not.toContain('data-check-summary');
  });
  it('does not claim an empty day when all execution records are unreadable', async () => {
    const { html, t } = await render('en', { model: build([{ id: 'broken' }]) });
    expect(text(html)).toContain(t('jobo.check.invalid'));
    expect(text(html)).not.toContain(t('jobo.check.noRecords'));
    expect(html).not.toContain('data-check-entry');
  });
  it('keeps copy limited to the journal and concise data states', async () => {
    for (const lng of locales) {
      const check = bundle(lng).jobo.check;
      expect(Object.keys(check).sort()).toEqual(['actual', 'button', 'invalid', 'noRecords', 'session', 'title', 'unavailable', 'untimed']);
    }
    expect(bundle('en').jobo.check.noRecords).toBe('No executions recorded for this day.');
    expect(bundle('zh-CN').jobo.check.noRecords).toBe('当天暂无执行记录。');
  });
  it('keeps statistics dormant, without importing their module into the panel', () => {
    const source = readFileSync(new URL('./CheckPanel.jsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/checkSummary|summarizeJoboDayModel|recordJobo|localStorage|updateTask/);
    expect(source).toContain("from './ExecutionAxes.jsx'");
    expect(source).toContain('event.stopImmediatePropagation()');
    expect(source).toContain('previous.focus()');
  });
});
