import { describe, it, expect } from 'vitest';
import { createDoRecord, compareExecutionToPlan, updateDoRecord } from './core.js';
import { completionMarker, intervalFromMarker } from './completionMarker.js';
import { buildJoboDayModel } from './viewModel.js';
const record = (overrides = {}) => createDoRecord({ id: 'do:t:stamp', taskId: 't', source: 'completion',
  title: 'Recorded work', progress: 'completed', timing: 'untimed', date: '2026-09-24',
  startTime: null, endDate: null, endTime: null, planSnapshot: { date: '2026-09-24', startTime: '09:00', duration: 60 },
  createdAt: '2026-09-24T10:23:54+08:00', updatedAt: '2026-09-24T10:23:54+08:00',
  observedAt: '2026-09-24T04:00:00Z', ...overrides });
describe('completion point projection', () => {
  it.each(['+08:00', '-07:00'])('keeps the source civil clock for an explicit %s offset', offset => {
    const row = record({ createdAt: `2026-09-24T10:23:54${offset}`, updatedAt: `2026-09-25T10:23:54${offset}`, observedAt: `2026-09-26T10:23:54${offset}` });
    expect(completionMarker(row)).toEqual({ date: '2026-09-24', time: '10:23', startMinute: 623, endMinute: 623, point: true });
    expect(row.startTime).toBeNull();
  });
  it('projects a recurring Z stamp into viewer-local time without rewriting occurrence identity', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const row = record({
        date: '2026-09-18',
        createdAt: '2026-09-19T02:00:00Z',
        updatedAt: '2026-09-19T02:00:00Z',
        observedAt: '2026-09-19T02:00:01Z',
        planSnapshot: { date: '2026-09-18', startTime: '20:00', duration: 60 },
      });
      expect(completionMarker(row)).toEqual({ date: '2026-09-18', time: '21:00', startMinute: 1260, endMinute: 1260, point: true });
      expect(buildJoboDayModel({ date: '2026-09-18', records: [row] }).untimedRecords[0])
        .toMatchObject({ startMinute: 1260, endMinute: 1260, point: true });
      expect(buildJoboDayModel({ date: '2026-09-19', records: [row] }).untimedRecords).toHaveLength(0);
      expect(row.date).toBe('2026-09-18');
      expect(row.id).toBe('do:t:stamp');
      expect(row.createdAt).toBe('2026-09-19T02:00:00Z');
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });
  it('projects an old/recurring record on its completion day without rewriting the occurrence date', () => {
    const row = record({ createdAt: '2026-09-25T00:10:00+08:00', updatedAt: '2026-09-25T00:10:00+08:00', observedAt: '2026-09-25T00:10:01+08:00' });
    expect(buildJoboDayModel({ date: '2026-09-24', records: [row] }).untimedRecords).toHaveLength(0);
    const model = buildJoboDayModel({ date: '2026-09-25', records: [row] });
    expect(model.untimedRecords[0]).toMatchObject({ startMinute: 10, endMinute: 10, point: true });
    expect(model.untimedRecords[0].record).toBe(row);
    expect(row.date).toBe('2026-09-24');
  });
  it('does not turn a point into measured duration or change immutable fields when explicitly corrected', () => {
    const row = record();
    const before = compareExecutionToPlan(row.planSnapshot, [row]);
    expect(before.comparable).toBe(false);
    expect(before.metrics.recordedMinutes).toBeNull();
    const patch = intervalFromMarker(completionMarker(row), 600);
    const next = updateDoRecord(row, patch, '2026-09-25T00:00:00Z');
    expect(next).toMatchObject({ id: row.id, date: '2026-09-24', startTime: '10:00', endDate: '2026-09-24', endTime: '10:23', timing: 'timed' });
    for (const key of ['id', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt', 'progress']) expect(next[key]).toEqual(row[key]);
    expect(compareExecutionToPlan(row.planSnapshot, [next]).metrics.recordedMinutes).toBe(23);
  });
  it('handles midnight without zero-minute sentinel records', () => {
    const point = { date: '2026-09-24', startMinute: 1435 };
    expect(intervalFromMarker(point, 1440)).toMatchObject({ startTime: '23:55', endDate: '2026-09-25', endTime: '00:00' });
    expect(intervalFromMarker(point, 1435)).toBeNull();
    expect(intervalFromMarker(point, NaN)).toBeNull();
  });
  it('does not draw timed rows, tombstones or malformed data as completion points', () => {
    expect(completionMarker(record({ deleted: true }))).toBeNull();
    expect(completionMarker({ id: 'bad' })).toBeNull();
    expect(completionMarker(record({ timing: 'timed', startTime: '09:00', endDate: '2026-09-24', endTime: '10:00' }))).toBeNull();
  });
});

describe('completionMoment', () => {
  it('keeps an offset stamp on its own clock and projects a UTC stamp into local time, for display only', async () => {
    const { completionMoment } = await import('./completionMarker.js');
    expect(completionMoment('2026-09-18T21:00:00-05:00')).toEqual({ date: '2026-09-18', time: '21:00' });
    const utc = completionMoment('2026-09-19T02:00:00.000Z');
    const local = new Date('2026-09-19T02:00:00.000Z');
    expect(utc.time).toBe(`${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
    expect(completionMoment('not a stamp')).toBe(null);
  });
});
