import { describe, expect, it } from 'vitest';
import { completionInterval, expandLegacyCompletions } from './completionInterval.js';
import { createDoRecord } from './core.js';

const old = (over = {}) => createDoRecord({ id: 'do:t:stamp', taskId: 't', title: 'Captured title', source: 'completion',
  progress: 'completed', timing: 'untimed', date: '2026-09-27', startTime: null, endTime: null, endDate: null,
  planSnapshot: { date: '2026-09-26', startTime: '23:30', duration: 45 },
  createdAt: '2026-09-27T00:15:44+08:00', updatedAt: '2026-09-27T00:15:44+08:00', observedAt: '2026-09-26T16:16:00Z', ...over });

describe('checkbox-created intervals', () => {
  it('ends at the source civil minute, crossing midnight without observer timezone conversion', () => {
    expect(completionInterval('2026-09-27T00:15:44+08:00', 45)).toEqual({ timing: 'timed', date: '2026-09-26', startTime: '23:30', endDate: '2026-09-27', endTime: '00:15' });
    expect(completionInterval('2026-09-27T00:15:44-05:00', 45)).toEqual(completionInterval('2026-09-27T00:15:44+08:00', 45));
  });
  it('uses 30 minutes when there is no usable duration', () => {
    for (const duration of [undefined, null, NaN, 0, -1]) expect(completionInterval('2026-09-27T10:30:00Z', duration)).toMatchObject({ startTime: '10:00', endTime: '10:30' });
  });
  it('upgrades old automatic points once, preserving their identities and captured history', () => {
    const original = old({ progress: 'partial' });
    const [upgraded] = expandLegacyCompletions([original]);
    expect(upgraded).toMatchObject({ id: original.id, title: original.title, progress: 'partial', createdAt: original.createdAt, planSnapshot: original.planSnapshot, timing: 'timed', startTime: '23:30' });
    expect(Date.parse(upgraded.updatedAt)).toBe(Date.parse(original.updatedAt) + 1);
    expect(expandLegacyCompletions([upgraded])).toEqual([]);
    expect(original.timing).toBe('untimed');
  });
  it('leaves explicit timed corrections, manual untimed records, tombstones and invalid rows alone', () => {
    expect(expandLegacyCompletions([old({ ...completionInterval('2026-09-27T12:00:00Z', 90) }), old({ source: 'manual' }), old({ deleted: true }), { id: 'bad' }])).toEqual([]);
  });
});
