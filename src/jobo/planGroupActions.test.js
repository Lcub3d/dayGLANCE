import { describe, expect, it } from 'vitest';
import {
  canGroupTask,
  formatPlanTime,
  isPlanGroupReadonly,
  nextDeletionStamp,
  samePlanVersion,
  shiftedPlanStart,
} from './planGroupActions.js';

const task = (overrides = {}) => ({
  id: 'task-1', date: '2026-09-27', startTime: '09:00', duration: 30, ...overrides,
});

describe('Plan group boundaries', () => {
  it('refuses rows that are not owned by the ordinary task collection', () => {
    for (const overrides of [
      { imported: true }, { nativeEventId: 'event-1' }, { readonly: true },
      { isJoboSyntheticOccurrence: true }, { synthetic: true },
    ]) {
      expect(canGroupTask(task(overrides))).toBe(false);
      expect(isPlanGroupReadonly(task(overrides))).toBe(true);
    }
    expect(canGroupTask(task(), { historical: true })).toBe(false);
  });

  it('shifts the entire interval without clamping a row at a day edge', () => {
    expect(shiftedPlanStart(task(), 60)).toBe('10:00');
    expect(shiftedPlanStart(task({ startTime: '23:30' }), 60)).toBeNull();
    expect(shiftedPlanStart(task({ startTime: '00:15' }), -30)).toBeNull();
    expect(formatPlanTime(1439)).toBe('23:59');
  });

  it('compares optimistic versions and stamps deletion after the source', () => {
    const current = task({ lastModified: '2026-09-27T10:00:00.000Z' });
    expect(samePlanVersion(current, { ...current })).toBe(true);
    expect(samePlanVersion(current, { ...current, lastModified: '2026-09-27T10:01:00.000Z' })).toBe(false);
    expect(Date.parse(nextDeletionStamp(current.lastModified, Date.parse(current.lastModified))))
      .toBeGreaterThan(Date.parse(current.lastModified));
  });
});
