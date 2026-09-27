import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareExecutionToPlan, createDoRecord } from '../../jobo/core.js';
import PlanExecutionBadges, { comparisonBadges, summaryBadges } from './PlanExecutionBadges.jsx';

const t = (key, values = {}) => `${key}${values.minutes === undefined ? '' : `:${values.minutes}`}${values.progress ? `:${values.progress}` : ''}`;
const plan = { date: '2026-09-26', startTime: '09:00', duration: 60 };
const timed = createDoRecord({ id: 'timed', taskId: 'task', title: 'Task', source: 'manual', progress: 'partial', timing: 'timed', date: plan.date, startTime: '09:15', endDate: plan.date, endTime: '10:30', planSnapshot: plan, createdAt: '2026-09-26T03:00:00.000Z', updatedAt: '2026-09-26T03:00:00.000Z', observedAt: '2026-09-26T03:00:00.000Z' });

describe('Plan execution badges', () => {
  it('keeps start, finish and duration comparisons distinct', () => {
    const comparison = compareExecutionToPlan(plan, [timed]);
    expect(comparisonBadges(comparison, t).map(badge => badge.text)).toEqual([
      'jobo.view.timeStartShort.late:15', 'jobo.view.timeFinishShort.late:30', 'jobo.view.timeDurationShort.longer:15',
    ]);
  });

  it('does not suggest a timing conclusion when an untimed attempt exists', () => {
    const untimed = createDoRecord({ ...timed, id: 'untimed', timing: 'untimed', startTime: null, endTime: null, endDate: null });
    const badges = comparisonBadges(compareExecutionToPlan(plan, [timed, untimed]), t);
    expect(badges).toHaveLength(1);
    expect(badges[0].text).toBe('jobo.view.timeIncompleteShort');
    expect(badges[0].title).toBe('jobo.view.timeIncomplete');
  });

  it('reports missing records rather than assuming a task has not started', () => {
    expect(comparisonBadges(compareExecutionToPlan(plan, [], { now: { date: plan.date, time: '11:00' } }), t)[0].text).toBe('jobo.view.noAttemptsShort');
  });

  it('shows an early finish instead of an on-time start when execution is shorter', () => {
    const shorter = createDoRecord({ ...timed, startTime: '09:00', endTime: '09:30' });
    const comparison = compareExecutionToPlan(plan, [shorter]);
    const html = renderToStaticMarkup(<PlanExecutionBadges item={{ labels: ['withinPlan'], latestAttempt: shorter, comparison }} t={t} onDetails={() => {}} availableHeight={22} />);
    expect(html).toContain('jobo.view.summary.withinPlan');
    expect(comparisonBadges(comparison, t).map((badge) => badge.text)).toContain('jobo.view.timeFinishShort.early:30');
    expect(html).not.toContain('jobo.view.timeStartShort.onTime:0');
  });

  it('keeps the latest execution progress separate from task completion and exposes all time dimensions', () => {
    const html = renderToStaticMarkup(<PlanExecutionBadges item={{ labels: ['late', 'longer'], latestAttempt: timed, comparison: compareExecutionToPlan(plan, [timed]) }} t={t} onDetails={() => {}} availableHeight={22} />);
    expect(html).toContain('data-progress="partial"');
    expect(html).toContain('jobo.view.latestAttempt:jobo.view.progress.partial');
    expect(html).toContain('<span>jobo.view.progress.partial</span>');
    expect(html).toContain('data-axis="progress"');
    expect(html).toContain('data-axis="timing"');
    expect(html).toContain('jobo.view.summary.late');
    expect(html).toContain('aria-label="jobo.view.summary.late. jobo.view.details"');
    expect(html).toContain('+1');
    expect(html).not.toContain('role="checkbox"');
  });

  it('keeps every canonical timing label available in the expanded card axis', () => {
    const item = { labels: ['withinPlan', 'split'], latestAttempt: timed };
    expect(summaryBadges(item, t).map((badge) => badge.text)).toEqual([
      'jobo.view.summary.withinPlan', 'jobo.view.summary.split',
    ]);
    const html = renderToStaticMarkup(<PlanExecutionBadges item={item} t={t} onDetails={() => {}} availableHeight={60} />);
    expect(html).toContain('jobo.view.summary.withinPlan');
    expect(html).toContain('jobo.view.summary.split');
    expect(html).not.toContain('+1');
  });
});
