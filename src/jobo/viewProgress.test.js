import { describe, expect, it } from 'vitest';
import { DO_PROGRESS, createDoRecord, validateDoRecord } from './core.js';
import { createManualDo, prepareDoEdit } from './viewActions.js';
import { createViewDo, copyViewDo, prepareViewDoEdit } from './viewProgress.js';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');
const options = (patch = {}) => ({ id: 'manual:one', title: 'Captured title', date: '2026-09-27', startMinute: 600, duration: 30, now: NOW, ...patch });

describe('explicit Do progress experiment', () => {
  it('defaults independent and linked newly authored Do to completed', () => {
    const independent = createViewDo(options());
    const linked = createViewDo(options({ task: { id: 't1' }, planSnapshot: { date: '2026-09-27', startTime: '09:00', duration: 30 } }));
    expect(independent).toMatchObject({ taskId: null, source: 'manual', progress: 'completed' });
    expect(linked).toMatchObject({ taskId: 't1', source: 'manual', progress: 'completed' });
    expect(validateDoRecord(independent).ok).toBe(true);
    expect(validateDoRecord(linked).ok).toBe(true);
  });

  it.each(Object.values(DO_PROGRESS))('preserves explicitly selected %s for new Do', progress => {
    expect(createViewDo(options({ progress })).progress).toBe(progress);
  });

  it('leaves the original manual adapter and core reassessment contracts intact', () => {
    const old = createManualDo(options());
    expect(old.progress).toBe('started');
    expect(() => createManualDo(options({ progress: 'completed' }))).toThrow(/started, partial, or mostly/);
    expect(() => prepareDoEdit({ records: [old], record: old, progress: 'completed', now: NOW })).toThrow(/cannot restore completed/);
  });

  it.each(Object.values(DO_PROGRESS))('accepts an explicit %s judgement while preserving captured identity and interval', progress => {
    const original = createViewDo(options({ progress: progress === 'completed' ? 'mostly' : 'completed' }));
    const edited = prepareViewDoEdit({ records: [original], record: original, progress, now: 0 });
    expect(edited.progress).toBe(progress);
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(Date.parse(original.updatedAt));
    for (const key of ['id', 'title', 'taskId', 'source', 'createdAt', 'observedAt', 'date', 'startTime', 'endDate', 'endTime', 'planSnapshot']) expect(edited[key]).toEqual(original[key]);
    expect(validateDoRecord(edited).ok).toBe(true);
  });

  it.each(Object.values(DO_PROGRESS))('keeps existing %s when only correcting the actual interval', progress => {
    const original = createViewDo(options({ progress }));
    const edited = prepareViewDoEdit({ records: [original], record: original, patch: { startTime: '10:05', endTime: '10:35' }, now: NOW });
    expect(edited).toMatchObject({ progress, startTime: '10:05', endTime: '10:35' });
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(NOW);
  });

  it('supports interval correction and reassessment to completed as one canonical result', () => {
    const original = createViewDo(options({ progress: 'started' }));
    const edited = prepareViewDoEdit({ records: [original], record: original, progress: 'completed', patch: { startTime: '10:10' }, now: NOW });
    expect(edited).toMatchObject({ progress: 'completed', startTime: '10:10', endTime: '10:30' });
    expect(edited.updatedAt).toBe('2026-09-27T10:00:00.002Z');
  });

  it('preserves no-ops and rejects stale or deleted opened records', () => {
    const original = createViewDo(options());
    expect(prepareViewDoEdit({ records: [original], record: original, progress: 'completed', now: NOW })).toBe(original);
    const remote = createDoRecord({ ...original, updatedAt: '2026-09-27T10:01:00.000Z' });
    expect(prepareViewDoEdit({ records: [remote], record: original, progress: 'completed', now: NOW })).toBeNull();
    expect(prepareViewDoEdit({ records: [{ ...original, deleted: true }], record: original, progress: 'completed', now: NOW })).toBeNull();
  });

  it('copies into a fresh completed manual attempt and never changes the source attempt', () => {
    const original = createViewDo(options({ progress: 'partial', task: { id: 't1' }, planSnapshot: { date: '2026-09-27', startTime: '09:00', duration: 30 } }));
    const copy = copyViewDo({ records: [original], record: original, id: 'manual:copy', date: '2026-09-28', startMinute: 660, duration: 45, now: NOW + 1 });
    expect(copy).toMatchObject({ id: 'manual:copy', progress: 'completed', source: 'manual', taskId: 't1', title: original.title, planSnapshot: original.planSnapshot, date: '2026-09-28', startTime: '11:00', endTime: '11:45' });
    expect(original.progress).toBe('partial');
    expect(copyViewDo({ records: [], record: original, id: 'manual:copy', now: NOW })).toBeNull();
  });
});
