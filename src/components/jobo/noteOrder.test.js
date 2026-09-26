import { describe, expect, it } from 'vitest';
import { sortNoteTasks } from './noteOrder.js';

const task = (id, date = '2026-09-26', startTime = '09:00') => ({ id, title: id, date, startTime, notes: id });

describe('sortNoteTasks', () => {
  it('follows live Plan vertical order instead of task or click order', () => {
    const items = [
      { id: 'current-b', noteKey: 'b', historical: false, startMinute: 720, plan: { date: '2026-09-26' } },
      { id: 'current-a', noteKey: 'a', historical: false, startMinute: 600, plan: { date: '2026-09-26' } },
    ];

    expect(sortNoteTasks([task('b'), task('a')], items).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('prefers the live instance over a captured historical instance', () => {
    const items = [
      { id: 'captured-a', noteKey: 'a', historical: true, startMinute: 420, plan: { date: '2026-09-26' } },
      { id: 'current-a', noteKey: 'a', historical: false, startMinute: 900, plan: { date: '2026-09-26' } },
      { id: 'current-b', noteKey: 'b', historical: false, startMinute: 840, plan: { date: '2026-09-26' } },
    ];

    expect(sortNoteTasks([task('a'), task('b')], items).map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('keeps every live Plan note ahead of old or unassociated notes', () => {
    const items = [
      { id: 'historical-old', noteKey: 'old', historical: true, startMinute: 420, plan: { date: '2026-09-26' } },
      { id: 'current-late', noteKey: 'live', historical: false, startMinute: 1320, plan: { date: '2026-09-26' } },
    ];

    expect(sortNoteTasks([
      task('old', '2026-09-25', '07:00'),
      task('isolated', '2026-09-26', '08:00'),
      task('live', '2026-09-26', '22:00'),
    ], items).map((entry) => entry.id)).toEqual(['live', 'old', 'isolated']);
  });

  it('uses a stable id for same-time Plans and falls back to historical task position', () => {
    const items = [
      { id: 'plan-z', noteKey: 'z', historical: true, startMinute: 600, plan: { date: '2026-09-26' } },
      { id: 'plan-a', noteKey: 'a', historical: true, startMinute: 600, plan: { date: '2026-09-26' } },
    ];
    const tasks = [task('z', '2026-09-26', '10:00'), task('a', '2026-09-26', '10:00'), task('fallback', '2026-09-26', '08:00')];

    expect(sortNoteTasks(tasks, items).map((entry) => entry.id)).toEqual(['fallback', 'a', 'z']);
  });

  it('sorts unassociated notes by date, time, then id', () => {
    const tasks = [
      task('later', '2026-09-27', '08:00'),
      task('same-time-z', '2026-09-26', '08:00'),
      task('same-time-a', '2026-09-26', '08:00'),
    ];

    expect(sortNoteTasks(tasks).map((entry) => entry.id)).toEqual(['same-time-a', 'same-time-z', 'later']);
  });
});
