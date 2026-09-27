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
  it.each(['Z', '+08:00', '-07:00'])('uses the source clock for %s, not the observer timezone', offset => {
    const row = record({ createdAt: `2026-09-24T10:23:54${offset}`, updatedAt: `2026-09-25T10:23:54${offset}`, observedAt: `2026-09-26T10:23:54${offset}` });
    expect(completionMarker(row)).toEqual({ date: '2026-09-24', time: '10:23', startMinute: 623, endMinute: 623, point: true });
    expect(row.startTime).toBeNull();
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
