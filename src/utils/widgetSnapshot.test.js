import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWidgetSnapshot, readCachedSteps } from './widgetSnapshot.js';

// The home-screen widgets' snapshot (utils/widgetSnapshot.js), built from
// plain inputs. App.jsx's effect only gathers them and pushes the result; a
// Chromium run against a stubbed native bridge showed the pushed JSON
// byte-identical before and after the move. These cover the rules inside.

const TODAY = '2026-10-09';
const at = (time) => new Date(`${TODAY}T${time}:00`);
const t = (key, opts) => (opts?.count !== undefined ? `${key}:${opts.count}` : key);

const base = (patch = {}) => ({
  now: at('10:00'), todayStr: TODAY,
  overdueTasks: [], todayAgenda: [], tasks: [], unscheduledTasks: [],
  projects: [], goals: [], goalsProjectsEnabled: false, isVisibleForUser: () => true,
  habitsEnabled: false, activeHabits: [], getTodayHabitCount: () => 0,
  todayRoutines: [], routineCompletions: {},
  hgVisibleProjects: [], glanceAhead: { dayLabel: 'Tomorrow', taskCount: 2, eventCount: 1, deadlineCount: 0, firstStartTime: '09:00', committedMinutes: 90, isEmpty: false },
  steps: -1, use24Hour: false, liveActivityEnabled: true,
  projectedDays: { d: 1 }, monthWindow: { m: 1 }, weatherCoords: null,
  dialAlarm: { a: 1 }, timezone: 'UTC', updatedAt: 42, listEndOfDayTime: null,
  getFrameInstancesForDate: () => [], computeAvailableSlots: () => [],
  getTasksForDate: () => [], getDayWindow: () => null, dialFramesForDate: () => [],
  formatTime: (hhmm) => hhmm, t,
  ...patch,
});
const scheduled = (id, startTime, duration, extra = {}) =>
  ({ id, title: `Task ${id}`, date: TODAY, startTime, duration, color: 'bg-blue-500', _agendaType: 'scheduled', ...extra });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at('10:00')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('buildWidgetSnapshot', () => {
  it('reads nothing from storage: every stored value arrives as an input', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('read storage'); }, setItem: () => { throw new Error('wrote storage'); } });
    const snapshot = buildWidgetSnapshot(base({ steps: 1234 }));
    expect(snapshot).toMatchObject({ date: TODAY, steps: 1234, dialAlarm: { a: 1 }, timezone: 'UTC', updatedAt: 42, days: { d: 1 }, monthWindow: { m: 1 } });
  });

  it('splits overdue into prior days and today past its end, without tags or wikilinks', () => {
    const overdueTasks = [
      { id: 'old', title: 'Old [[Note]] #work', date: '2026-10-08', startTime: '09:00', duration: 30, color: 'bg-red-500', _overdueType: 'scheduled' },
      { id: 'early', title: 'Early', date: TODAY, startTime: '08:00', duration: 30, color: 'bg-red-500', _overdueType: 'scheduled' },
      { id: 'dl', title: 'Deadline', color: 'bg-red-500', _overdueType: 'deadline' },
    ];
    const snapshot = buildWidgetSnapshot(base({ overdueTasks, todayAgenda: [scheduled('early', '08:00', 30)] }));
    expect(snapshot.overdue.map(item => [item.id, item.title, item.overdueType])).toEqual([
      ['old', 'Old', 'scheduled'], ['dl', 'Deadline', 'deadline'],
    ]);
    expect(snapshot.overdueToday).toEqual([expect.objectContaining({ id: 'early', startTime: '08:00', duration: 30 })]);
    // An overdue task is not also scheduled.
    expect(JSON.stringify(snapshot.sections)).not.toContain('"early"');
  });

  it('habits: do-more fills toward its target; a limit is green until it is passed', () => {
    const counts = { water: 3, coffee: 3, tea: 1 };
    const snapshot = buildWidgetSnapshot(base({
      habitsEnabled: true,
      getTodayHabitCount: (id) => counts[id],
      activeHabits: [
        { id: 'water', name: 'Water', type: 'doMore', target: 8, color: 'blue' },
        { id: 'coffee', name: 'Coffee', type: 'limit', target: 2, color: 'amber' },
        { id: 'tea', name: 'Tea', type: 'limit', target: 2, color: 'green' },
      ],
    }));
    expect(snapshot.habits.map(h => [h.id, h.progress, h.complete, h.ringColorHex])).toEqual([
      ['water', 3 / 8, false, '#3b82f6'], ['coffee', 1, false, '#ef4444'], ['tea', 1, true, '#22c55e'],
    ]);
    expect(buildWidgetSnapshot(base({ habitsEnabled: false, activeHabits: [{ id: 'x' }] })).habits).toEqual([]);
  });

  it('Up Next is the first scheduled task not yet ended, and the rest follow in order', () => {
    const todayAgenda = [
      scheduled('ended', '08:00', 60),
      scheduled('later', '13:00', 30),
      scheduled('now', '09:30', 60, { title: 'Now #deep', notes: 'n'.repeat(400), subtasks: Array.from({ length: 9 }, (_, i) => ({ title: `s${i}` })) }),
      scheduled('done', '11:00', 30, { completed: true }),
    ];
    const snapshot = buildWidgetSnapshot(base({ todayAgenda }));
    expect(snapshot.nextTask).toMatchObject({ id: 'now', title: 'Now', tags: ['deep'] });
    expect(snapshot.nextTask.notes).toHaveLength(300);
    expect(snapshot.nextTask.subtasks).toHaveLength(7);
    expect(snapshot.upcomingTasks.map(item => item.id)).toEqual(['later']);
    expect(snapshot.nextUpNext).toMatchObject({ title: 'Now', startTime: '09:30', bodyPrefix: '' });
    expect(snapshot.daySummary.upNext).toMatchObject({ title: 'Now', inProgress: true });
  });

  it('GLANCEahead appears once the day is done or in the evening, not before', () => {
    const glanceAhead = base().glanceAhead;
    const busy = { todayAgenda: [scheduled('a', '09:00', 60), scheduled('b', '15:00', 60)] };
    expect(buildWidgetSnapshot(base({ ...busy, now: at('10:00') })).glanceAhead).toBeNull();
    expect(buildWidgetSnapshot(base({ ...busy, now: at('16:30') })).glanceAhead).toMatchObject({ dayLabel: glanceAhead.dayLabel, committedStr: expect.any(String) });
    expect(buildWidgetSnapshot(base({ todayAgenda: [scheduled('c', '20:00', 60)], now: at('19:05') })).glanceAhead).not.toBeNull();
    expect(buildWidgetSnapshot(base({ now: at('08:00') })).glanceAhead).not.toBeNull(); // an empty day is done
  });

  it('a hyperGLANCE session due before the next task leads Up Next, with its task count', () => {
    const project = {
      id: 'p1', title: 'Launch',
      hyperglance: { enabled: true, scheduledTime: '10:30', scheduledDuration: 45, scheduledDate: TODAY, templateTasks: [{ id: 'h1' }, { id: 'h2' }], color: '#123456' },
    };
    const snapshot = buildWidgetSnapshot(base({
      goalsProjectsEnabled: true, projects: [project], hgVisibleProjects: [project],
      tasks: [{ id: 'pt', projectId: 'p1', completed: false }],
      todayAgenda: [scheduled('t', '11:00', 30)],
    }));
    expect(snapshot.hyperGlance).toEqual([expect.objectContaining({ id: 'p1', startTime: '10:30', duration: 45, taskCount: 3, colorHex: '#123456', isOverdue: false })]);
    expect(snapshot.nextUpNext).toMatchObject({ title: 'hyperGLANCE', bodyPrefix: 'Launch · reminders.taskCount:3 · ' });
    // With goals and projects off, no sessions at all.
    expect(buildWidgetSnapshot(base({ hgVisibleProjects: [project] })).hyperGlance).toEqual([]);
  });

  it('goals due today report their progress over visible projects and tasks only', () => {
    const snapshot = buildWidgetSnapshot(base({
      goalsProjectsEnabled: true,
      goals: [{ id: 'g', title: 'Ship', status: 'active', targetDate: TODAY }, { id: 'g2', title: 'Later', status: 'active', targetDate: '2026-12-01' }],
      projects: [{ id: 'p', goalId: 'g', status: 'active' }],
      tasks: [{ id: 'a', projectId: 'p', completed: true }, { id: 'b', projectId: 'p', completed: false }, { id: 'hidden', projectId: 'p', completed: true, owner: 'bob' }],
      isVisibleForUser: (item) => item.owner !== 'bob',
    }));
    expect(snapshot.goals).toEqual([{ id: 'g', title: 'Ship', progressPct: expect.any(Number), totalTasks: 2, completedTasks: 1 }]);
  });

  it('frames end-filtered at now; routines carry completion; sky needs coordinates', () => {
    const snapshot = buildWidgetSnapshot(base({
      getFrameInstancesForDate: () => [{ frameId: 'past', start: '07:00', end: '09:00', label: 'Past' }, { frameId: 'open', start: '09:00', end: '12:00', label: 'Open' }],
      computeAvailableSlots: () => [{ minutes: 30 }],
      todayRoutines: [{ id: 'r1', name: 'Stretch', startTime: '07:30' }, { id: 'r2', name: 'Read' }],
      routineCompletions: { r1: true },
    }));
    expect(snapshot.sections.map(section => [section.type, section.name, section.availableMinutes])).toEqual([['frame', 'Open', 30]]);
    expect(snapshot.routines).toEqual([
      { id: 'r1', name: 'Stretch', startTime: '07:30', isAllDay: false, completed: true },
      { id: 'r2', name: 'Read', startTime: '', isAllDay: true, completed: false },
    ]);
    expect(snapshot.sky).toBeNull();
    expect(buildWidgetSnapshot(base({ weatherCoords: { lat: 41.88, lon: -87.63 } })).sky).toEqual(expect.objectContaining({ hours: expect.any(Array) }));
  });
});

describe('readCachedSteps', () => {
  it("today's cached count, otherwise -1", () => {
    expect(readCachedSteps(JSON.stringify({ date: TODAY, steps: 812 }), TODAY)).toBe(812);
    expect(readCachedSteps(JSON.stringify({ date: '2026-10-08', steps: 812 }), TODAY)).toBe(-1);
    expect(readCachedSteps(null, TODAY)).toBe(-1);
    expect(readCachedSteps('{not json', TODAY)).toBe(-1);
  });
});
