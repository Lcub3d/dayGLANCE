import { describe, expect, it } from 'vitest';
import { buildLauncherSnapshot, launcherSnapshotFingerprint, FRAME_WINDOW } from './launcherSnapshot.js';

// The GLANCElauncher's read model (utils/launcherSnapshot.js), built from plain
// inputs the way the widget snapshot is. These pin what the launcher relies on:
// ids kept, the three task sources merged without duplicates, inbox rows
// dateless, events marked, routines with today's completion, frames per day
// over the window, the day shape from the window and the sun, and a
// fingerprint that ignores the push's own stamp.

const TODAY = '2026-10-19';
const now = new Date(`${TODAY}T10:00:00`);
const base = (patch = {}) => ({
  now, todayStr: TODAY, timezone: 'America/Denver', updatedAt: 1,
  goalsProjectsEnabled: true, routinesEnabled: true,
  sunTimes: () => ({ sunriseMin: 7 * 60 + 12, sunsetMin: 18 * 60 + 24 }),
  ...patch,
});

describe('buildLauncherSnapshot', () => {
  it('merges scheduled, inbox and recurring rows, keeps ids, and never duplicates one', () => {
    const snap = buildLauncherSnapshot(base({
      tasks: [{ id: 't1', title: 'Run #training', date: TODAY, startTime: '07:30', duration: 45, color: 'bg-green-500', projectId: 'p1', clientId: 'w-9' }],
      unscheduledTasks: [{ id: 'i1', title: 'Call dentist', date: TODAY, duration: 15, priority: 2, deadline: '2026-10-21' }],
      expandedRecurringTasks: [
        { id: 'recurring-tpl-2026-10-19', title: 'Stretch', date: TODAY, startTime: '12:30', duration: 10 },
        { id: 't1', title: 'duplicate', date: TODAY },
      ],
    }));
    expect(snap.tasks.map(t => t.id)).toEqual(['t1', 'i1', 'recurring-tpl-2026-10-19']);
    const [run, inbox, occurrence] = snap.tasks;
    expect(run).toMatchObject({ title: 'Run #training', date: TODAY, startTime: '07:30', duration: 45, colorHex: '#22c55e', projectId: 'p1', source: 'dayglance', clientId: 'w-9', recurringId: null });
    // An inbox row is dateless whatever the stored row carries; its deadline and priority stay.
    expect(inbox).toMatchObject({ date: null, startTime: null, deadline: '2026-10-21', priority: 2, clientId: null });
    expect(occurrence.recurringId).toBe('tpl');
  });

  it('marks imported events, derives energy, and drops archived, example and invisible rows', () => {
    const snap = buildLauncherSnapshot(base({
      tasks: [
        { id: 'e1', title: 'Standup', date: TODAY, startTime: '10:00', duration: 15, imported: true },
        { id: 'c1', title: 'Task calendar', date: TODAY, startTime: '11:00', duration: 15, imported: true, isTaskCalendar: true },
        { id: 'r1', title: 'Lunch walk', date: TODAY, startTime: '12:00', duration: 30 },
        { id: 'x1', title: 'gone', date: TODAY, archived: true },
        { id: 'x2', title: 'demo', date: TODAY, isExample: true },
        { id: 'x3', title: 'theirs', date: TODAY },
      ],
      isVisibleForUser: t => t.id !== 'x3',
    }));
    expect(snap.tasks.map(t => [t.id, t.source])).toEqual([['e1', 'calendar'], ['c1', 'dayglance'], ['r1', 'dayglance']]);
    expect(snap.tasks[2].energy).toBe('restore');
  });

  it('lists goals and projects only while the feature is on', () => {
    const goals = [{ id: 'g1', title: 'Half marathon', color: 'bg-green-500', targetDate: '2027-01-10', status: 'active' }];
    const projects = [{ id: 'p1', title: 'Base', goalId: 'g1', color: 'bg-green-500' }];
    const on = buildLauncherSnapshot(base({ goals, projects }));
    expect(on.goals).toEqual([{ id: 'g1', title: 'Half marathon', description: '', colorHex: '#22c55e', targetDate: '2027-01-10', status: 'active' }]);
    expect(on.projects[0]).toMatchObject({ id: 'p1', goalId: 'g1', status: 'active' });
    const off = buildLauncherSnapshot(base({ goals, projects, goalsProjectsEnabled: false }));
    expect(off.goals).toEqual([]);
    expect(off.projects).toEqual([]);
  });

  it("routines carry today's completion; an unplaced routine is all-day", () => {
    const snap = buildLauncherSnapshot(base({
      todayRoutines: [{ id: 'r1', name: 'Morning pages', startTime: '06:45', duration: 15 }, { id: 'r2', name: 'Stretch' }],
      routineCompletions: { r1: TODAY, r2: '2026-10-18' },
    }));
    expect(snap.routines).toEqual([
      { id: 'r1', name: 'Morning pages', startTime: '06:45', duration: 15, isAllDay: false, completed: true },
      { id: 'r2', name: 'Stretch', startTime: null, duration: null, isAllDay: true, completed: false },
    ]);
    expect(buildLauncherSnapshot(base({ todayRoutines: [{ id: 'r1', name: 'x' }], routinesEnabled: false })).routines).toEqual([]);
  });

  it('lists frame instances per day across the window, exceptions included by construction', () => {
    const asked = [];
    const snap = buildLauncherSnapshot(base({
      frameInstancesForDate: (date) => {
        asked.push(date.getDate());
        return date.getDay() === 1 ? [{ frameId: 'f1', start: '09:00', end: '12:00', label: 'Deep work', color: '#c8c8d2' }] : [];
      },
    }));
    expect(asked.length).toBe(FRAME_WINDOW.daysBefore + 1 + FRAME_WINDOW.daysAfter);
    expect(snap.frames[0]).toEqual({ id: 'f1:2026-10-12', frameId: 'f1', date: '2026-10-12', start: '09:00', end: '12:00', name: 'Deep work', colorHex: '#c8c8d2' });
    expect(snap.frames.every(f => new Date(`${f.date}T12:00:00`).getDay() === 1)).toBe(true);
  });

  it('shapes the day from the window and the sun, null where the app has neither', () => {
    const shaped = buildLauncherSnapshot(base({
      getDayWindow: (d) => (d === TODAY ? { start: '07:00', stop: '22:30' } : null),
      weatherCoords: { lat: 39.7, lon: -104.9 }, use24Hour: true,
    }));
    expect(shaped.dayShape).toEqual({
      dayStartMin: 420, dayStopMin: 1350, sunriseMin: 432, sunsetMin: 1104, use24HourClock: true,
      lat: 39.7, lon: -104.9, dialAlarm: null,
    });
    const bare = buildLauncherSnapshot(base());
    expect(bare.dayShape).toEqual({ dayStartMin: null, dayStopMin: null, sunriseMin: null, sunsetMin: null, use24HourClock: false, lat: null, lon: null, dialAlarm: null });
    expect(bare.weather).toEqual([]);
  });

  it('carries the alarm-mark prefs, defaulted where they are malformed', () => {
    expect(buildLauncherSnapshot(base({ dialAlarm: { on: false, fromMin: 21 * 60 } })).dayShape.dialAlarm).toEqual({ on: false, fromMin: 1260 });
    expect(buildLauncherSnapshot(base({ dialAlarm: {} })).dayShape.dialAlarm).toEqual({ on: true, fromMin: 1080 });
  });

  it('ships the hourly weather one row per forecast date, in the user\'s unit, with the hours it has', () => {
    const hourlyByDate = {
      '2026-10-20': { 0: { temp: 41, code: 3, uv: 0 }, 1: { temp: 40, code: 61, uv: 0 } },
      [TODAY]: { 9: { temp: 55, code: 0, uv: 2.34 }, 12: { temp: 63, code: 1, uv: 5.5 }, 13: { temp: 'bad', code: null } },
    };
    const snap = buildLauncherSnapshot(base({ weatherHourlyByDate: hourlyByDate, weatherTempUnit: 'celsius' }));
    expect(snap.weather.map(w => w.id)).toEqual([TODAY, '2026-10-20']);
    expect(snap.weather[0]).toEqual({
      id: TODAY, date: TODAY, unit: 'celsius',
      hours: [{ hour: 9, temp: 55, code: 0, uv: 2.3 }, { hour: 12, temp: 63, code: 1, uv: 5.5 }, { hour: 13, temp: null, code: null, uv: null }],
    });
    expect(snap.weather[1].hours).toHaveLength(2);
    expect(buildLauncherSnapshot(base({ weatherHourlyByDate: hourlyByDate })).weather[0].unit).toBe('fahrenheit');
    expect(buildLauncherSnapshot(base({ weatherHourlyByDate: { [TODAY]: {} } })).weather).toEqual([]);
  });

  it('carries the handled-writes ledger and a fingerprint that ignores updatedAt', () => {
    const ledger = [{ clientId: 'w-1', taskId: 't1', action: 'create', at: '2026-10-19T09:00:00Z' }];
    const a = buildLauncherSnapshot(base({ handledWrites: ledger, updatedAt: 1 }));
    const b = buildLauncherSnapshot(base({ handledWrites: ledger, updatedAt: 2 }));
    expect(a.handledWrites).toEqual(ledger);
    expect(a).toMatchObject({ version: 1, today: TODAY, timezone: 'America/Denver' });
    expect(launcherSnapshotFingerprint(a)).toBe(launcherSnapshotFingerprint(b));
    expect(launcherSnapshotFingerprint(a)).not.toBe(launcherSnapshotFingerprint(buildLauncherSnapshot(base({ handledWrites: [] }))));
  });
});
