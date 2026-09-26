import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import JoboDayStats from './JoboDayStats.jsx';
import DraftDoCard from './DraftDoCard.jsx';
import { createDoRecord } from '../../jobo/core.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key, values = {}) => `${key}${Object.keys(values).length ? JSON.stringify(values) : ''}`,
  i18n: { language: 'en' },
}) }));
const date = '2026-09-27';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { id: 't1', title: 'Task', ...plan, completed: false };
const ctx = { textPrimary: '', textSecondary: '', borderClass: '', cardBg: '', formatTime: t => t };
const record = over => createDoRecord({
  id: 'a', taskId: 't1', title: 'Task', planSnapshot: plan,
  timing: 'timed', date, startTime: '09:10', endDate: date, endTime: '10:20',
  source: 'manual', progress: 'partial', createdAt: `${date}T11:00:00Z`,
  updatedAt: `${date}T11:00:00Z`, observedAt: `${date}T11:00:00Z`, ...over,
});
const render = props => renderToStaticMarkup(<JoboDayStats date={date} tasks={[task]} records={[]} loaded ctx={ctx} {...props} />);
const tile = (html, id) => html.match(new RegExp(`data-jobo-daily-tile="${id}"[^]*?</button>`))[0];

describe('JOBO header numbers at the actual rendering boundary', () => {
  it('renders all three dimensions with their common eligible denominator', () => {
    const html = render({ records: [record()] });
    for (const id of ['native', 'time', 'start', 'finish', 'duration']) expect(html).toContain(`data-jobo-daily-tile="${id}"`);
    for (const id of ['start', 'finish', 'duration']) expect(tile(html, id)).toContain('1 / 1');
    expect(tile(html, 'native')).toContain('0 / 1');
    expect(html).toContain('data-recorded-minutes="70"');
    expect(html).toContain('aria-haspopup="dialog"');
  });
  it('renders dashes, not a false zero or on-plan result, with no eligible history', () => {
    for (const props of [{ records: [] }, { records: undefined, loaded: false }, { records: [record({ timing: 'untimed', startTime: null, endDate: null, endTime: null })] }]) {
      const html = render(props);
      expect(tile(html, 'time')).toContain('>—</span>');
      for (const id of ['start', 'finish', 'duration']) expect(tile(html, id)).toContain('>—</span>');
      expect(html).not.toContain('data-recorded-minutes="0"');
    }
  });
  it('renders the interval union, not the record sum, and never changes native completion', () => {
    const html = render({ records: [record({ startTime: '09:00', endTime: '09:40', progress: 'completed' }), record({ id: 'b', startTime: '09:30', endTime: '10:00' })] });
    expect(html).toContain('data-recorded-minutes="60"');
    expect(tile(html, 'native')).toContain('0 / 1');
    expect(tile(html, 'duration')).toContain('0 / 1');
  });
  it('withholds comparative rates on invalid rows while preserving known measured coverage', () => {
    const html = render({ records: [record(), { id: 'bad' }] });
    expect(html).toContain('data-recorded-minutes="70"');
    expect(html).toContain('data-comparable-groups=""');
    expect(tile(html, 'start')).toContain('>—</span>');
  });
  it('does not display a fabricated completion label on a new manual draft', () => {
    const html = renderToStaticMarkup(<DraftDoCard draft={{ id: 'draft', startMinute: 540, endMinute: 570, duration: 30 }} ctx={ctx} t={key => key} />);
    expect(html).toContain('jobo.view.progress.started');
    expect(html).not.toContain('common.completed');
  });
});
