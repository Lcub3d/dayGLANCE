import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DoTimeMeta from './DoTimeMeta.jsx';

const PLAN = { date: '2026-09-27', startTime: '09:00', duration: 60 };
const stamp = '2026-09-27T09:00:00.000Z';

function record(overrides = {}) {
  return {
    id: 'do:task-1:2026-09-27',
    taskId: 'task-1',
    title: 'Write the report',
    source: 'manual',
    progress: 'completed',
    deleted: false,
    createdAt: stamp,
    updatedAt: stamp,
    observedAt: stamp,
    date: '2026-09-27',
    timing: 'timed',
    startTime: '09:00',
    endDate: '2026-09-27',
    endTime: '10:00',
    planSnapshot: PLAN,
    ...overrides,
  };
}

const t = (key, values = {}) => {
  if (key === 'common.durationMinutes') return `${values.minutes}m`;
  if (key === 'common.durationHours') return `${values.hours}h`;
  if (key === 'common.durationHoursMinutes') return `${values.hours}h ${values.minutes}m`;
  if (key === 'jobo.view.untimed') return 'Untimed';
  return `${key}${values.minutes === undefined ? '' : `:${values.minutes}`}`;
};

const render = (item) => renderToStaticMarkup(<DoTimeMeta item={item} ctx={{ formatTime: (value) => value }} t={t} />);

describe('DoTimeMeta', () => {
  it('shows neutral timing for an exact single attempt', () => {
    const html = render({ record: record() });
    expect(html).toContain('data-plan-state="planned"');
    expect(html).toContain('data-jobo-time-dimension="start" data-state="neutral"');
    expect(html).toContain('data-jobo-time-dimension="finish" data-state="neutral"');
    expect(html).toContain('data-jobo-time-dimension="duration" data-state="neutral"');
    expect(html).toContain('09:00');
    expect(html).toContain('10:00');
    expect(html).toContain('1h');
    expect(html).toContain('title="jobo.view.timeStart.onTime:0"');
    expect(html).toContain('title="jobo.view.timeFinish.onTime:0"');
    expect(html).toContain('title="jobo.view.timeDuration.onEstimate:0"');
  });

  it('marks each late or overrun dimension red', () => {
    const html = render({ record: record({ startTime: '09:15', endTime: '10:30' }) });
    expect(html).toContain('data-jobo-time-dimension="start" data-state="late"');
    expect(html).toContain('data-jobo-time-dimension="finish" data-state="late"');
    expect(html).toContain('data-jobo-time-dimension="duration" data-state="late"');
    expect(html).toContain('is-late');
    expect(html).toContain('title="jobo.view.timeStart.late:15"');
    expect(html).toContain('title="jobo.view.timeFinish.late:30"');
    expect(html).toContain('title="jobo.view.timeDuration.longer:15"');
  });

  it('marks each early or shorter dimension green', () => {
    const html = render({ record: record({ startTime: '08:45', endTime: '09:30' }) });
    expect(html).toContain('data-jobo-time-dimension="start" data-state="early"');
    expect(html).toContain('data-jobo-time-dimension="finish" data-state="early"');
    expect(html).toContain('data-jobo-time-dimension="duration" data-state="early"');
    expect(html).toContain('is-early');
    expect(html).toContain('title="jobo.view.timeStart.early:15"');
    expect(html).toContain('title="jobo.view.timeFinish.early:30"');
    expect(html).toContain('title="jobo.view.timeDuration.shorter:15"');
  });

  it('compares only the displayed attempt, not item.attempts aggregate history', () => {
    const current = record();
    const lateHistory = record({ id: 'do:task-1:late', startTime: '11:00', endTime: '12:30' });
    const html = render({ record: current, attempts: [lateHistory] });
    expect(html).toContain('data-jobo-time-dimension="start" data-state="neutral"');
    expect(html).not.toContain('data-jobo-time-dimension="start" data-state="late"');
  });

  it('keeps arrows for a clipped cross-day attempt', () => {
    const html = render({
      record: record({ endDate: '2026-09-28', endTime: '00:30' }),
      clippedStart: true,
      clippedEnd: true,
    });
    expect(html).toContain('← ');
    expect(html).toContain(' →');
  });

  it('keeps an unplanned Do neutral without guessing a timing relation', () => {
    const html = render({ record: record({ planSnapshot: null, startTime: '11:00', endTime: '11:20' }) });
    expect(html).toContain('data-plan-state="unplanned"');
    expect(html).toContain('data-jobo-time-dimension="start" data-state="neutral"');
    expect(html).not.toContain('is-late');
    expect(html).not.toContain('is-early');
    expect(html).toContain('title="11:00"');
    expect(html).toContain('title="11:20"');
    expect(html).toContain('title="20m"');
    expect(html).not.toContain('jobo.view.timeStart.');
  });

  it('appends the per-attempt summary after duration without using another attempt', () => {
    const current = record({ startTime: '09:15', endTime: '10:30' });
    const lateHistory = record({ id: 'do:task-1:late', startTime: '11:00', endTime: '12:30' });
    const html = render({ record: current, attempts: [lateHistory] });
    expect(html).toContain('data-jobo-time-dimension="duration"');
    expect(html).toContain('data-jobo-time-status="late"');
    expect(html).toContain('data-jobo-time-status="longer"');
    expect(html.indexOf('data-jobo-time-dimension="duration"')).toBeLessThan(html.indexOf('data-jobo-time-status="late"'));
    expect(html).not.toContain('data-jobo-time-status="withinPlan"');
  });

  it('adds an on-plan summary for an exact planned attempt', () => {
    const html = render({ record: record() });
    expect(html).toContain('data-jobo-time-status="withinPlan"');
  });
});
