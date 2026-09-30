import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CheckJournal } from './CheckPanel.jsx';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { createDoRecord } from '../../jobo/core.js';
import { summaryRows, timingRows } from './ExecutionAxes.jsx';

const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { ...plan, id: 't1', title: 'Current title #work', color: 'bg-red-500', priority: 3, completed: true };
const stamp = `${date}T11:00:00+08:00`;
const record = (over = {}) => createDoRecord({ id: 'r1', taskId: 't1', title: 'Recorded report #work', source: 'completion', timing: 'timed',
  date, startTime: '09:10', endDate: date, endTime: '10:20', progress: 'mostly', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over });
const build = (records = [record()], extra = {}) => buildJoboDayModel({ date, records, tasks: [task], taskLookup: [task], ...extra });
const locales = ['en', 'zh-CN', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'];
const bundle = lng => JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
async function translation(lng = 'en') {
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle(lng) } }, interpolation: { escapeValue: false } });
  return i18n;
}
async function render(lng = 'en', props = {}) {
  const i18n = await translation(lng);
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><CheckJournal date={date} model={build()} loaded onOpenNotes={() => {}} {...props} /></I18nextProvider>);
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('Check is an execution journal, not a second statistics report', () => {
  it.each(locales)('renders a localized journal from %s, with recorded titles and native notes links', async lng => {
    const html = await render(lng);
    expect(html).toContain('data-jobo-check-journal');
    expect(html.match(/data-check-entry=/g)).toHaveLength(1);
    expect(html).toContain('Recorded report'); expect(html).not.toContain('Current title');
    expect(html).toContain('color:#ef4444'); expect(html).toContain('data-check-notes="r1"');
    expect(html).not.toMatch(/jobo\.check\.|jobo\.view\.|\{\{|NaN|undefined|Infinity/);
    expect(html).not.toMatch(/data-check-priority|<table|<input|<textarea|<select/);
    expect(text(html)).not.toMatch(/P1|P2|P3|P4|Allen|captured-plan groups|measured pieces|#work/);
  });
  it('shows Plan versus actual, progress, and exact shared timing text', async () => {
    const m = build(), i18n = await translation();
    const words = text(await render('en', { model: m }));
    for (const value of ['09:00', '10:00', '09:10', '10:20', 'Mostly']) expect(words).toContain(value);
    for (const row of [...summaryRows(m.timedRecords[0].labels, m.timedRecords[0].comparison, i18n.t.bind(i18n)),
      ...timingRows(m.timedRecords[0].comparison, i18n.t.bind(i18n))]) expect(words).toContain(row.text);
  });
  it('shows each session progress without erasing a prior Partial when the task completes later', async () => {
    const second = record({ id: 'r2', startTime: '10:40', endTime: '11:00', progress: 'completed', createdAt: `${date}T11:30:00+08:00`, updatedAt: `${date}T11:30:00+08:00` });
    const html = await render('en', { model: build([record({ progress: 'partial' }), second]) });
    expect(html.match(/data-check-entry=/g)).toHaveLength(1);
    expect(html.match(/data-check-session=/g)).toHaveLength(2);
    expect(html).toContain('data-progress="partial"'); expect(html).toContain('data-progress="completed"');
    expect(text(html)).toContain('Sessions: 2'); expect(text(html)).toContain('Latest');
  });
  it('dates full-history sessions rather than treating off-day work as today', async () => {
    const other = record({ id: 'r2', date: '2026-09-29', endDate: '2026-09-29' });
    const html = await render('en', { model: build([record(), other]) });
    expect(html).toContain('dateTime="2026-09-29T09:10"');
    expect(text(html)).toContain('Sep 29, 2026'); expect(text(html)).toContain('comparisons use the full history');
  });
  it('shows a completion moment without inventing a duration', async () => {
    const point = record({ timing: 'untimed', startTime: null, endDate: null, endTime: null });
    const html = await render('en', { model: build([point]) });
    expect(text(html)).toContain('Marked complete at 11:00'); expect(text(html)).toContain('Time to add');
    expect(html).not.toMatch(/Measured coverage|0m|11:00–11:00/);
  });
  it('labels inferred intervals as estimates and does not render a precise comparison', async () => {
    const html = await render('en', { model: build([record({ timingBasis: 'planDuration' })]) });
    expect(text(html)).toContain('Estimated');
    expect(html).not.toContain('data-check-timing'); expect(html).not.toContain('data-check-summary');
  });
  it('does not offer notes for a missing task or an unlinked Do', async () => {
    expect(await render('en', { model: build([record()], { taskLookup: [], tasks: [] }) })).not.toContain('data-check-notes');
    const html = await render('en', { model: build([record({ taskId: null, source: 'manual', planSnapshot: null })]) });
    expect(html).not.toContain('data-check-notes'); expect(html).toContain('data-check-section="unplanned"');
  });
  it('retains loading, error and empty distinctions', async () => {
    expect(await render('en', { loaded: false })).not.toContain('data-check-entry');
    const failed = await render('en', { error: 'storageRead' });
    expect(failed).toContain('role="alert"'); expect(failed).not.toContain('data-check-entry');
    const empty = await render('en', { model: build([]) });
    expect(text(empty)).toContain('No Do recorded'); expect(empty).not.toContain('data-check-section');
  });
  it('warns about unreadable records without asserting full comparisons or an empty day', async () => {
    const html = await render('en', { model: build([record(), { id: 'bad' }]) });
    expect(text(html)).toContain('journal may be incomplete'); expect(html).toContain('data-check-session="r1"');
    expect(html).not.toContain('data-check-summary'); expect(html).not.toContain('data-check-timing');
    expect(text(await render('en', { model: build([{ id: 'bad' }]) }))).not.toContain('No Do recorded');
  });
  it('uses fresh committed inputs and the app time formatter', async () => {
    const html = await render('en', { model: build([record({ progress: 'partial' })]), formatTime: time => `native:${time}` });
    expect(html).toContain('data-progress="partial"'); expect(html).not.toContain('data-progress="mostly"');
    expect(html).toContain('native:09:00'); expect(html).toContain('native:09:10');
  });
  it('localizes the entire namespace and preserves interpolation', () => {
    const en = bundle('en').jobo.check;
    const vars = value => (value.match(/\{\{\w+\}\}/g) || []).sort();
    for (const lng of locales) {
      const strings = bundle(lng).jobo.check;
      expect(Object.keys(strings)).toEqual(Object.keys(en));
      for (const [key, value] of Object.entries(strings)) {
        expect(value.trim()).not.toBe(''); expect(vars(value)).toEqual(vars(en[key]));
        if (lng !== 'en') expect(value, `${lng}:${key}`).not.toBe(en[key]);
      }
    }
  });
  it('reuses the model and axes without introducing writes or statistical rollups', () => {
    const view = readFileSync(new URL('../JoboView.jsx', import.meta.url), 'utf8');
    const panel = view.match(/<CheckPanel[\s\S]*?\/>/)[0];
    expect(panel).toContain('model={model}'); expect(panel).toContain('formatTime={ctx.formatTime}');
    expect(panel).toContain('onOpenNotes=');
    expect(panel).not.toMatch(/recordJobo|writer|workingSet|setTasks|reloadJobo|onEdit|onComplete/);
    for (const filename of ['CheckPanel.jsx', 'checkJournal.js']) {
      const source = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/localStorage|indexedDB|recordJobo|setTasks|fetch\(|dangerouslySetInnerHTML|checkSummary|summarizeJoboDayModel/);
    }
    const notes = readFileSync(new URL('./CheckTaskNotes.jsx', import.meta.url), 'utf8');
    expect(notes).toContain('<DoTaskNotes'); expect(notes).not.toMatch(/onChange|textarea|updateTaskNotes|saveWikiNote/);
  });
});
