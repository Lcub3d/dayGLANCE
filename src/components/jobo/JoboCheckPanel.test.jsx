import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { createInstance } from 'i18next';
import en from '../../../public/locales/en/translation.json';
import zh from '../../../public/locales/zh-CN/translation.json';
import { createDoRecord } from '../../jobo/core.js';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { readFileSync } from 'node:fs';

vi.mock('react-dom', () => ({ createPortal: node => node }));
vi.mock('../../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({ openInObsidian: vi.fn() }) }));
import JoboCheckPanel from './JoboCheckPanel.jsx';

const date = '2026-09-24';
const task = { id: 't', title: 'New title [[Project note]]', date, startTime: '09:00', duration: 60, notes: '**Useful** notes', completed: true };
const make = (extra = {}) => createDoRecord({ id: 'a', title: 'Captured #work', taskId: 't', source: 'manual', progress: 'partial', timing: 'timed',
  date, startTime: '09:00', endDate: date, endTime: '09:30', planSnapshot: { date, startTime: '09:00', duration: 60 },
  createdAt: `${date}T10:00:00+08:00`, updatedAt: `${date}T10:00:00+08:00`, observedAt: `${date}T10:00:00+08:00`, ...extra });
const i18n = createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en }, 'zh-CN': { translation: zh } }, interpolation: { escapeValue: false } });
const ctx = { formatTime: value => value, darkMode: false, cardBg: 'bg-white', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', borderClass: 'border-stone-200' };
function render(rows = [make()], extra = {}, tasks = [task]) {
  const model = buildJoboDayModel({ date, tasks, records: rows });
  // The Node suite renders the portal inline, matching other component tests.
  vi.stubGlobal('document', { body: {} });
  try { return renderToStaticMarkup(<JoboCheckPanel model={model} date={date} loaded error={null} onClose={() => {}} ctx={ctx} t={i18n.getFixedT('en')} {...extra} />); }
  finally { vi.unstubAllGlobals(); }
}

describe('read-only Check panel', () => {
  it('has an accessible modal shell with a labelled close control', () => {
    const html = render();
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close"'); expect(html).toContain('Daily check');
  });
  it('shows captured plan, actual interval, tags and per-attempt progress', () => {
    const html = render();
    expect(html).toContain('Captured'); expect(html).toContain('#work'); expect(html).toContain('09:00'); expect(html).toContain('09:30');
    expect(html).toContain('data-jobo-check-progress="partial"');
    expect(html).not.toContain('data-jobo-check-progress="completed"');
    expect(html).toContain('Measured sessions');
  });
  it.each(['en', 'zh-CN'])('labels all group duration figures in %s', (language) => {
    const t = i18n.getFixedT(language);
    const html = render([make()], { t });
    expect(html).toContain('data-jobo-check-metrics');
    for (const key of ['recordedLabel', 'elapsedLabel', 'gapLabel', 'overlapLabel']) {
      expect(html).toContain(`>${t(`jobo.view.${key}`)}</dt>`);
    }
  });
  it('exposes only navigation/disclosure, no editing or completion controls', () => {
    const html = render();
    for (const tag of ['<input', '<textarea', '<select', '<form', 'contenteditable']) expect(html).not.toContain(tag);
    expect(html).not.toContain('Complete task'); expect(html).not.toContain('Carry Forward');
  });
  it('renders current notes through the existing formatter and native Obsidian link', () => {
    const html = render();
    expect(html).toContain('<strong>Useful</strong>'); expect(html).toContain('Current task notes');
    expect(html).toContain('Open Project note in Obsidian');
  });
  it('does not invent notes or drop an orphan record', () => {
    const html = render([make()], {}, []);
    expect(html).toContain('Captured'); expect(html).toContain('The linked task is no longer available');
    expect(html).not.toContain('data-jobo-check-notes');
  });
  it('keeps not-loaded and failed-read states distinct from an empty day', () => {
    for (const error of [null, 'storageRead']) {
      const html = render([], { loaded: false, error });
      expect(html).not.toContain('No Do recorded for this day'); expect(html).not.toContain('data-jobo-check-record=');
      expect(html).toContain(error ? 'role="alert"' : 'role="status"');
    }
  });
  it('shows loaded empty evidence without claiming the task was not done', () => {
    const html = render([]);
    expect(html).toContain('No Do recorded for this day'); expect(html).not.toContain('Not started');
  });
  it('does not label an invalid-only ledger as an empty day', () => {
    const html = render([{ id: 'bad' }]);
    expect(html).toContain('role="alert"'); expect(html).not.toContain('No Do recorded for this day');
  });
  it('keeps committed entries visible with a write-error warning', () => {
    const html = render([make()], { error: 'storageWrite' });
    expect(html).toContain('role="alert"'); expect(html).toContain('data-jobo-check-record="a"');
  });
  it('shows untimed as a moment, never a planned-duration measurement', () => {
    const html = render([make({ timing: 'untimed', startTime: null, endDate: null, endTime: null, source: 'completion', progress: 'completed' })]);
    expect(html).toContain('Completion recorded at'); expect(html).toContain('duration not measured');
    expect(html).not.toContain('data-jobo-check-measured');
  });
  it('uses creation wording rather than completion for untimed manual work', () => {
    const html = render([make({ taskId: null, timing: 'untimed', startTime: null, endDate: null, endTime: null })]);
    expect(html).toContain('Record created at'); expect(html).not.toContain('Completion recorded at');
  });
  it('escapes task and note markup rather than inserting HTML', () => {
    const html = render([make({ title: '<script>alert(1)</script>' })], {}, [{ ...task, notes: '<img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x'); expect(html).toContain('&lt;script&gt;');
  });
  it('renders Chinese without falling back for new journal strings', () => {
    const html = render([make()], { t: i18n.getFixedT('zh-CN') });
    expect(html).toContain('每日复盘'); expect(html).toContain('当前任务笔记'); expect(html).not.toContain('jobo.check.');
  });
  it('is integrated in JOBO only and consumes the existing model without a writer', () => {
    const view = readFileSync(new URL('../JoboView.jsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('./JoboCheckPanel.jsx', import.meta.url), 'utf8');
    expect(view).toContain('data-jobo-check-open'); expect(view).toContain('model={model}');
    for (const forbidden of ['recordJobo', 'workingSet', 'localStorage', 'sessionStorage', 'toggleComplete', 'updateTaskNotes']) expect(panel).not.toContain(forbidden);
  });
});
