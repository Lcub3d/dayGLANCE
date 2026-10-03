import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoRecord, compareExecutionToPlan, tombstoneDoRecord } from './core.js';
import { buildJoboDayModel, createJoboDayModelReader } from './viewModel.js';
import { aggregateCheckSummaries, buildStatisticsDayReport, buildStatisticsReports } from './checkStatistics.js';

vi.mock('./core.js', async original => {
  const core = await original();
  return { ...core, compareExecutionToPlan: vi.fn(core.compareExecutionToPlan) };
});
afterEach(() => vi.clearAllMocks());
const modelData = model => ({ ...model, resolveRecordTask: null });

const dayAt = offset => new Date(Date.UTC(2025, 0, 1 + offset)).toISOString().slice(0, 10);
const row = (patch = {}) => createDoRecord({
  id: 'r1', taskId: null, title: 'Work', source: 'manual', progress: 'partial', timing: 'timed',
  date: '2025-01-01', startTime: '23:00', endDate: '2025-01-03', endTime: '01:00', planSnapshot: null,
  createdAt: '2025-01-01T23:00:00Z', updatedAt: '2025-01-01T23:00:00Z', observedAt: '2025-01-01T23:00:00Z',
  ...patch,
});

describe('range reader preserves the existing day model', () => {
  it('keeps complete cross-day groups, invalid evidence and date/scale reads independent', () => {
    const task = { id: 't1', title: 'Work', date: dayAt(0), startTime: '23:00', duration: 120, completed: false };
    const records = [row({ taskId: task.id, planSnapshot: { date: task.date, startTime: task.startTime, duration: task.duration } }), {}];
    const source = { records, taskLookup: [task] };
    const readDay = createJoboDayModelReader({ ...source, dates: [dayAt(0), dayAt(1), dayAt(2)] });
    const before = JSON.stringify({ task, records });
    for (const date of [dayAt(2), dayAt(0), dayAt(1), dayAt(2)]) {
      for (const scale of [undefined, 60, 180]) {
        const input = { date, tasks: date === task.date ? [task] : [], now: { date: dayAt(2), time: '12:00' }, scale };
        expect(modelData(readDay(input))).toEqual(modelData(buildJoboDayModel({ ...source, ...input })));
        expect(readDay(input).resolveRecordTask(records[0])).toEqual(task);
        expect(readDay(input).invalidRecordCount).toBe(1);
      }
    }
    expect(JSON.stringify({ task, records })).toBe(before);
  });

  it('reads a date outside its prepared index and excludes an empty midnight endpoint', () => {
    const source = { records: [row({ endDate: dayAt(2), endTime: '00:00' })] };
    const readDay = createJoboDayModelReader({ ...source, dates: [dayAt(0)] });
    expect(modelData(readDay({ date: dayAt(1) }))).toEqual(modelData(buildJoboDayModel({ ...source, date: dayAt(1) })));
    expect(readDay({ date: dayAt(2) }).timedRecords).toEqual([]);
  });

  it('indexes only requested dates even for a very long civil interval', () => {
    const source = { records: [row({ endDate: '9999-12-31', endTime: '01:00' })] };
    const readDay = createJoboDayModelReader({ ...source, dates: [dayAt(0), dayAt(1)] });
    expect(readDay({ date: dayAt(1) }).timedRecords[0].durationMinutes).toBe(1440);
  });

  it('keeps saved recurring occurrences native on each date in a batch', () => {
    const recurringTasks = [{ id: 'daily', title: 'Read', startTime: '09:00', duration: 60,
      recurrence: { type: 'daily', startDate: dayAt(0) }, completedDates: [dayAt(0), dayAt(1)] }];
    const records = [row({ taskId: 'daily', date: dayAt(0), startTime: '09:00', endDate: dayAt(0), endTime: '10:00',
      title: 'Read', planSnapshot: { date: dayAt(0), startTime: '09:00', duration: 60 } })];
    const source = { recurringTasks, records, now: { date: dayAt(2), time: '12:00' } };
    const dates = [dayAt(1), dayAt(0), dayAt(1)];
    expect(buildStatisticsReports({ ...source, dates })).toEqual(dates.map(date => buildStatisticsDayReport({ ...source, date })));
    expect(buildStatisticsReports({ ...source, dates }).map(report => report.stats.native.completed)).toEqual([1, 1, 1]);
  });

  it('rebuilds from corrected winners, tombstones and changed household visibility', () => {
    const task = { id: 't1', title: 'Work', date: dayAt(0), startTime: '09:00', duration: 60, assignedUserSyncIds: ['alice'] };
    const first = row({ taskId: task.id, startTime: '09:00', endDate: dayAt(0), endTime: '10:00' });
    const corrected = { ...first, endTime: '11:00', updatedAt: '2025-01-02T12:00:00Z' };
    const source = { dates: [dayAt(0)], tasks: [task], now: { date: dayAt(2), time: '12:00' } };
    expect(buildStatisticsReports({ ...source, records: [first, corrected] })[0].stats.recordedMinutes).toBe(120);
    expect(buildStatisticsReports({ ...source, records: [first, tombstoneDoRecord(first, corrected.updatedAt)] })[0].stats.recordedMinutes).toBeNull();
    expect(buildStatisticsReports({ ...source, records: [first], isVisibleForUser: () => false })[0].stats.recordedMinutes).toBeNull();
  });
});

describe('All time does not repeat whole-ledger comparisons for every day', () => {
  it('compares a full execution group once even when its sessions occupy a year', () => {
    const dates = Array.from({ length: 365 }, (_, index) => dayAt(index));
    const records = dates.map((date, index) => row({ id: `r${index}`, taskId: 't1',
      date, startTime: '09:00', endDate: date, endTime: '10:00',
      planSnapshot: { date: dates[0], startTime: '09:00', duration: 60 },
    }));
    const summary = aggregateCheckSummaries(buildStatisticsReports({
      dates, records, now: { date: dates.at(-1), time: '12:00' },
    }));
    expect(summary.stats.recordedMinutes).toBe(365 * 60);
    expect(summary.stats.comparison.comparableCount).toBe(1);
    expect(compareExecutionToPlan.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('prepares a year of ordinary Do once while preserving all measured minutes', () => {
    const dates = Array.from({ length: 365 }, (_, index) => dayAt(index));
    const records = dates.map((date, index) => row({ id: `r${index}`, date, startTime: '09:00', endDate: date, endTime: '10:00' }));
    const reports = buildStatisticsReports({ dates, records, now: { date: dates.at(-1), time: '12:00' } });
    expect(aggregateCheckSummaries(reports).stats.recordedMinutes).toBe(365 * 60);
    // A structural budget, not a machine-dependent stopwatch assertion.
    // Rebuilding the full ledger on every date exceeds this by two orders of magnitude.
    expect(compareExecutionToPlan.mock.calls.length).toBeLessThanOrEqual(records.length * 3);
  });
});
