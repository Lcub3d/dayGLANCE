import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CheckJournal } from './CheckPanel.jsx';
import { estimateCompletion } from './DoColumn.jsx';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { createDoRecord } from '../../jobo/core.js';

vi.mock('react-dom', async importOriginal => ({ ...await importOriginal(), createPortal: children => children }));

// A timed session and the checkbox ticked as it ended (core's
// closesLastSession): the views show the completion as that session's end.
const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { ...plan, id: 't1', title: 'Report', color: 'bg-green-500', priority: 0, completed: true };
const stamp = `${date}T11:00:00+08:00`;
const base = { taskId: 't1', title: 'Report', planSnapshot: plan, updatedAt: stamp, observedAt: stamp };
const session = (over = {}) => createDoRecord({ ...base, id: 'focus:a', source: 'focus', timing: 'timed', progress: 'partial',
  date, startTime: '09:00', endDate: date, endTime: '09:55', createdAt: stamp, ...over });
const done = (time) => createDoRecord({ ...base, id: `do:t1:${time}`, source: 'completion', timing: 'untimed', progress: 'completed',
  date, startTime: null, endDate: null, endTime: null, createdAt: `${date}T${time}:00+08:00` });
const build = records => buildJoboDayModel({ date, records, tasks: [task], taskLookup: [task], now: { date, time: '18:00' } });
const bundle = JSON.parse(readFileSync(new URL('../../../public/locales/en/translation.json', import.meta.url), 'utf8'));
async function journal(records) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><CheckJournal date={date} model={build(records)} loaded onOpenNotes={vi.fn()} /></I18nextProvider>);
}

describe('a closing completion is shown as its session\'s end', () => {
  // MUTATION: number every record again in CheckPanel and this fails.
  it('the journal lists one session and the moment it was marked complete', async () => {
    const html = await journal([session(), done('09:56')]);
    expect(html).toContain('data-check-closing');
    expect(html).not.toContain('Session 1');
    expect(html).not.toContain('Time not recorded');
    expect(html).toContain('Marked complete at');
  });

  it('a later completion is still listed as a session of unknown time', async () => {
    const html = await journal([session({ endTime: '09:15' }), done('09:30')]);
    expect(html).not.toContain('data-check-closing');
    expect(html).toContain('Session 2');
    expect(html).toContain('Time not recorded');
  });

  // MUTATION: drop the closingCompletionIds check in estimateCompletion and this fails.
  it('the Do column draws no estimate for it, and still does for a later one', () => {
    const point = (records, id) => {
      const item = build(records).untimedRecords.find(entry => entry.id === id);
      return estimateCompletion({ ...item, point: true, startMinute: item.startMinute, endMinute: item.endMinute });
    };
    expect(point([session(), done('09:56')], 'do:t1:09:56').estimate).toBeUndefined();
    expect(point([session({ endTime: '09:15' }), done('09:30')], 'do:t1:09:30').estimate).toBe(true);
  });
});
