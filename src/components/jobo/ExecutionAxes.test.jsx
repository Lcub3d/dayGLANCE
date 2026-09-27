import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDoRecord, compareExecutionToPlan } from '../../jobo/core.js';
import ExecutionAxes, { metricRows, summaryRows, timingRows } from './ExecutionAxes.jsx';

const t = (key, values = {}) => `${key}${values.minutes == null ? '' : `:${values.minutes}`}`;
const plan = { date: '2026-09-26', startTime: '09:00', duration: 60 };

function record(overrides = {}) {
  return createDoRecord({
    id: 'attempt', taskId: 'task', title: 'Task', source: 'manual', progress: 'partial', timing: 'timed',
    date: plan.date, startTime: '09:15', endDate: plan.date, endTime: '10:30', planSnapshot: plan,
    createdAt: '2026-09-26T03:00:00.000Z', updatedAt: '2026-09-26T03:00:00.000Z', observedAt: '2026-09-26T03:00:00.000Z',
    ...overrides,
  });
}

describe('ExecutionAxes', () => {
  it('renders timing as start, finish and duration rows while retaining measured metrics', () => {
    const current = record();
    const comparison = compareExecutionToPlan(plan, [current]);
    const rows = timingRows(comparison, t);
    expect(rows.map((row) => row.key)).toEqual(['start', 'finish', 'duration']);
    expect(metricRows(comparison, { measured: comparison.metrics }, t).map((row) => row.key)).toEqual([
      'recordedMinutes', 'elapsedMinutes', 'gapMinutes', 'overlapMinutes',
    ].filter((key) => comparison.metrics[key] >= 0));
    const html = renderToStaticMarkup(<ExecutionAxes comparison={comparison} comparisonMeta={{ measured: comparison.metrics }} latestAttempt={current} records={[current]} t={t} />);
    expect(html).toContain('data-jobo-execution-axis="timing"');
    expect(html).toContain('data-jobo-timing-row="start"');
    expect(html).toContain('data-jobo-execution-axis="completion"');
    expect(html).toContain('data-progress="partial"');
  });

  it('keeps the mixed timed and untimed explanation visible', () => {
    const timed = record();
    const untimed = record({ id: 'untimed', timing: 'untimed', startTime: null, endTime: null, endDate: null });
    const comparison = compareExecutionToPlan(plan, [timed, untimed]);
    const html = renderToStaticMarkup(<ExecutionAxes comparison={comparison} comparisonMeta={{ hasUntimedAttempts: true, measured: { recordedMinutes: 75 } }} labels={['split']} latestAttempt={untimed} records={[untimed, timed]} t={t} />);
    expect(html).toContain('jobo.view.timeIncompleteShort');
    expect(html).toContain('title="jobo.view.timeIncomplete"');
    expect(html).toContain('jobo.view.summary.split');
    expect(html.match(/title="jobo.view.timeIncomplete"/g)).toHaveLength(1);
    expect(html).toContain('jobo.view.recordedMinutes:75');
    expect(html).toContain('data-jobo-execution-axis="completion"');
  });

  it('does not label a future plan or unknown history as not started', () => {
    const future = compareExecutionToPlan(plan, [], { now: { date: plan.date, time: '09:30' } });
    expect(timingRows(future, t)).toEqual([]);
    expect(summaryRows([], future, t)).toEqual([]);

    const unknown = compareExecutionToPlan(null, [], { knownUnplanned: false });
    expect(timingRows(unknown, t)).toEqual([]);
    expect(summaryRows([], unknown, t)).toEqual([]);
  });
});
