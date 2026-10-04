import { describe, expect, it } from 'vitest';
import { createDoRecord, tombstoneDoRecord } from './core.js';
import { aggregateCheckSummaries, buildStatisticsReports, statisticsDatesForScope } from './checkStatistics.js';

const dates = ['2026-09-28', '2026-09-29', '2026-09-30'];
const plan = { date: dates[0], startTime: '09:00', duration: 60 };
const record = (patch = {}) => createDoRecord({
  id: 'r1', taskId: null, title: 'Work', source: 'manual', progress: 'partial', timing: 'timed',
  date: dates[0], startTime: '23:00', endDate: dates[1], endTime: '01:00', planSnapshot: null,
  createdAt: `${dates[0]}T23:00:00Z`, updatedAt: `${dates[0]}T23:00:00Z`, observedAt: `${dates[0]}T23:00:00Z`,
  ...patch,
});
const read = (records = [], options = {}) => aggregateCheckSummaries(buildStatisticsReports({
  records, dates, now: { date: dates[2], time: '12:00' }, ...options,
}));
const counts = summary => ({
  doCount: summary.doCount, single: summary.single, split: summary.split,
  progress: summary.progress, contexts: summary.contexts,
});

describe('Execution statistics over a range', () => {
  it('counts an overnight record and its execution once while adding both measured slices', () => {
    const value = read([record()]);
    expect(counts(value)).toEqual({
      doCount: 1, single: 1, split: 0,
      progress: { completed: 0, mostly: 0, partial: 1, started: 0 },
      contexts: { planned: 0, noPlan: 1, unknown: 0 },
    });
    expect(value.stats.recordedMinutes).toBe(120);
    expect(value.rawMinutes).toBe(120);
    expect(value.gapMinutes).toBeNull();
  });

  it.each(['day', 'week', 'month', 'allTime'])('provides Execution for %s without adding per-day counters', scope => {
    const scopeDates = statisticsDatesForScope({
      scope, anchorDate: dates[0], weekDates: dates, evidenceDates: dates,
    });
    const value = read([record()], { dates: scopeDates });
    expect(value.doCount).toBe(1);
    expect(value.single).toBe(1);
    expect(value.progress.partial).toBe(1);
    expect(value.contexts.noPlan).toBe(1);
  });

  it('counts a multi-day execution once, including full-group split classification outside the range', () => {
    const records = [
      record({ taskId: 'task', planSnapshot: { ...plan, date: '2026-09-27' } }),
      record({ id: 'later', taskId: 'task', planSnapshot: { ...plan, date: '2026-09-27' },
        date: dates[2], startTime: '09:00', endDate: dates[2], endTime: '10:00', progress: 'mostly' }),
    ];
    const full = read(records);
    expect(full).toMatchObject({ doCount: 2, single: 0, split: 1,
      progress: { partial: 1, mostly: 1 }, contexts: { planned: 1, noPlan: 0 } });
    const boundary = read(records, { dates: dates.slice(0, 2) });
    expect(boundary).toMatchObject({ doCount: 1, single: 0, split: 1,
      progress: { partial: 1, mostly: 0 }, contexts: { planned: 1, noPlan: 0 } });
    expect(boundary.stats.comparison.groupCount).toBe(0); // Captured plan is outside this range.
    expect(boundary.stats.recordedMinutes).toBe(120);
  });

  it('counts no-plan executions by group rather than by records or occupied days', () => {
    const records = [record({ source: 'completion', taskId: 'task' }),
      record({ id: 'retry', source: 'completion', taskId: 'task', date: dates[1], startTime: '10:00',
        endDate: dates[1], endTime: '11:00' })];
    expect(read(records)).toMatchObject({ doCount: 2, single: 0, split: 1,
      progress: { partial: 2 }, contexts: { planned: 0, noPlan: 1, unknown: 0 } });
  });

  it('preserves separate captured plans, unlinked records and recurring occurrence identities', () => {
    const records = [
      record({ id: 'plan-a', taskId: 'task', planSnapshot: plan }),
      record({ id: 'plan-b', taskId: 'task', planSnapshot: { ...plan, date: dates[1] } }),
      record({ id: 'unlinked-a' }), record({ id: 'unlinked-b' }),
      ...dates.slice(0, 2).map(date => record({ id: `do:daily:${date}:stamp`, source: 'completion',
        taskId: 'daily', timing: 'untimed', date, startTime: null, endDate: null, endTime: null,
        createdAt: `${date}T09:00:00Z`, updatedAt: `${date}T09:00:00Z`, observedAt: `${date}T09:00:00Z`, progress: 'completed' })),
    ];
    expect(read(records)).toMatchObject({ doCount: 6, single: 6, split: 0,
      progress: { completed: 2, partial: 4 }, contexts: { planned: 2, noPlan: 4, unknown: 0 } });
  });

  it('counts estimated and untimed evidence without turning them into measured minutes', () => {
    const records = [
      record({ id: 'estimate', taskId: 'task', planSnapshot: plan, timingBasis: 'planDuration', progress: 'started' }),
      record({ id: 'point', taskId: 'task', planSnapshot: plan, source: 'completion', progress: 'completed',
        timing: 'untimed', startTime: null, endDate: null, endTime: null }),
    ];
    const value = read(records);
    expect(value).toMatchObject({ doCount: 2, single: 0, split: 1,
      progress: { started: 1, completed: 1 }, contexts: { planned: 1, noPlan: 0 } });
    expect(value.stats.inferredCount).toBe(1);
    expect(value.stats.untimedCount).toBe(1);
    expect(value.stats.recordedMinutes).toBeNull();
    expect(value.stats.comparison.comparableCount).toBe(0);
  });

  it('uses corrected winners and rebuilds after reassessment, moves and deletion', () => {
    const original = record();
    const corrected = { ...original, progress: 'mostly', updatedAt: `${dates[2]}T09:00:00Z` };
    expect(read([original, corrected, corrected])).toMatchObject({ doCount: 1,
      progress: { partial: 0, mostly: 1 } });
    const moved = { ...corrected, date: '2026-10-01', endDate: '2026-10-02' };
    expect(read([original, moved])).toMatchObject({ doCount: 0, single: 0, split: 0 });
    expect(read([original, tombstoneDoRecord(original, corrected.updatedAt)]))
      .toMatchObject({ doCount: 0, single: 0, split: 0, contexts: { noPlan: 0 } });
  });

  it('filters household-hidden records and invalid winners but preserves orphan Do', () => {
    const orphan = record({ id: 'orphan', taskId: 'removed' });
    const hidden = record({ id: 'hidden', taskId: 'bob' });
    const invalid = { ...record({ id: 'invalid' }), startTime: 'bad' };
    const value = read([orphan, hidden, invalid, {}], {
      tasks: [{ id: 'bob', assignedUserSyncIds: ['bob'] }],
      isVisibleForUser: task => !task.assignedUserSyncIds?.includes('bob'),
    });
    expect(value).toMatchObject({ clean: false, doCount: 1, single: 1, split: 0,
      progress: { partial: 1 }, contexts: { noPlan: 1 } });
    expect(value.stats.recordedMinutes).toBeNull();
    expect(value.stats.comparison.comparableCount).toBeNull();
  });

  it('does not count an empty midnight endpoint or an execution seen only through its captured plan', () => {
    const endsAtBoundary = record({ endTime: '00:00' });
    const later = record({ id: 'later', taskId: 'task', planSnapshot: plan,
      date: '2026-10-01', endDate: '2026-10-02' });
    expect(read([endsAtBoundary], { dates: dates.slice(1) }).doCount).toBe(0);
    const capturedOnly = read([later]);
    expect(capturedOnly.doCount).toBe(0);
    expect(capturedOnly.single).toBe(0);
    expect(capturedOnly.stats.comparison.groupCount).toBe(1);
  });

  it('returns zero Execution counts for empty evidence and does not mutate reports or records', () => {
    expect(counts(read())).toEqual({
      doCount: 0, single: 0, split: 0,
      progress: { completed: 0, mostly: 0, partial: 0, started: 0 },
      contexts: { planned: 0, noPlan: 0, unknown: 0 },
    });
    const records = [record()];
    const reports = buildStatisticsReports({ records, dates });
    const before = JSON.stringify({ records, reports });
    expect(counts(aggregateCheckSummaries(reports.slice().reverse()))).toEqual(counts(aggregateCheckSummaries(reports)));
    expect(JSON.stringify({ records, reports })).toBe(before);
  });
});
