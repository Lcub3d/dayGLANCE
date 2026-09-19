import { describe, it, expect } from 'vitest';
import { weekWindow, compactHourLabel, clippedCounts } from './weekWindow.js';

describe('weekWindow', () => {
  it('defaults to the whole day', () => {
    expect(weekWindow()).toEqual({ startHour: 0, endHour: 24, visibleHours: 24 });
  });

  it('trims both ends, which is the point', () => {
    // 15 rows in the space 24 used to take: every row 60% taller.
    expect(weekWindow({ startHour: 7, endHour: 22 }))
      .toEqual({ startHour: 7, endHour: 22, visibleHours: 15 });
  });

  it('trims one end on its own', () => {
    expect(weekWindow({ startHour: 0, endHour: 20 }).visibleHours).toBe(20);
    expect(weekWindow({ startHour: 6, endHour: 24 }).visibleHours).toBe(18);
  });

  it('restores the whole day for the gutter toggle, whatever the bounds say', () => {
    expect(weekWindow({ startHour: 7, endHour: 22, showAll: true }))
      .toEqual({ startHour: 0, endHour: 24, visibleHours: 24 });
  });
});

describe('weekWindow refuses a band that is not one', () => {
  // Both bounds come out of localStorage and can be anything.
  it('keeps at least one hour when the end is at or before the start', () => {
    expect(weekWindow({ startHour: 9, endHour: 9 })).toEqual({ startHour: 9, endHour: 10, visibleHours: 1 });
    expect(weekWindow({ startHour: 9, endHour: 4 })).toEqual({ startHour: 9, endHour: 10, visibleHours: 1 });
  });

  it('clamps bounds outside the day', () => {
    expect(weekWindow({ startHour: -5, endHour: 99 })).toEqual({ startHour: 0, endHour: 24, visibleHours: 24 });
    expect(weekWindow({ startHour: 30, endHour: 40 })).toEqual({ startHour: 23, endHour: 24, visibleHours: 1 });
  });

  it('falls back rather than producing NaN rows', () => {
    expect(weekWindow({ startHour: null, endHour: undefined })).toEqual({ startHour: 0, endHour: 24, visibleHours: 24 });
    expect(weekWindow({ startHour: 'seven', endHour: 'ten' })).toEqual({ startHour: 0, endHour: 24, visibleHours: 24 });
  });

  it('truncates fractional hours', () => {
    expect(weekWindow({ startHour: 7.8, endHour: 22.2 })).toEqual({ startHour: 7, endHour: 22, visibleHours: 15 });
  });
});

describe('compactHourLabel', () => {
  it('formats a 12-hour clock without a space', () => {
    expect(compactHourLabel(7, false)).toBe('7AM');
    expect(compactHourLabel(22, false)).toBe('10PM');
    expect(compactHourLabel(12, false)).toBe('12PM');
    expect(compactHourLabel(0, false)).toBe('12AM');
  });

  it('formats a 24-hour clock zero-padded', () => {
    expect(compactHourLabel(7, true)).toBe('07:00');
    expect(compactHourLabel(22, true)).toBe('22:00');
  });

  it('reads an end hour of 24 as midnight rather than 24:00', () => {
    expect(compactHourLabel(24, false)).toBe('12AM');
    expect(compactHourLabel(24, true)).toBe('00:00');
  });
});

describe('clippedCounts', () => {
  const t = (startTime, extra = {}) => ({ id: startTime, startTime, ...extra });

  it('counts nothing when the window is the whole day', () => {
    expect(clippedCounts([t('06:00'), t('23:30')], { startHour: 0, endHour: 24 }))
      .toEqual({ above: 0, below: 0 });
  });

  it('splits by which side of the window a task falls', () => {
    const tasks = [t('03:00'), t('06:30'), t('09:00'), t('21:00'), t('23:30')];
    expect(clippedCounts(tasks, { startHour: 7, endHour: 20 })).toEqual({ above: 2, below: 2 });
  });

  it('counts by START hour, so a task running past the end is not hidden', () => {
    // Its chip is on screen; only the tail is clipped.
    expect(clippedCounts([t('21:30', { duration: 120 })], { startHour: 7, endHour: 22 }))
      .toEqual({ above: 0, below: 0 });
  });

  it('treats the end hour as exclusive', () => {
    expect(clippedCounts([t('22:00')], { startHour: 7, endHour: 22 }).below).toBe(1);
    expect(clippedCounts([t('21:59')], { startHour: 7, endHour: 22 }).below).toBe(0);
  });

  it('ignores all-day items, which have their own row', () => {
    expect(clippedCounts([t('00:00', { isAllDay: true })], { startHour: 7, endHour: 22 }))
      .toEqual({ above: 0, below: 0 });
  });

  it('ignores anything without a usable start time', () => {
    expect(clippedCounts([null, {}, t(''), t('later')], { startHour: 7, endHour: 22 }))
      .toEqual({ above: 0, below: 0 });
  });

  it('tolerates a missing list', () => {
    expect(clippedCounts(undefined)).toEqual({ above: 0, below: 0 });
  });
});
