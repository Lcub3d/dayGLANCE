import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// hasNativeCalendar() reaches for the native/Electron bridges, which don't
// exist under vitest's node environment. Pin it off so loadData takes the
// plain-web path; the subscription-import filter it gates is not under test.
vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

// isTrayMode is derived once at module load from window.location.search, so each
// mode needs its own module instance — set the URL, then import.
async function loadHookAs(mode) {
  vi.resetModules();
  globalThis.window = { location: { search: mode === 'tray' ? '?tray=1' : '' } };
  const mod = await import('./useDataPersistence.js');
  return mod.default;
}

// A task missing `notes`/`subtasks` — exactly what the normalization pass fills
// in, so the write-back has something real to persist.
const STORED_TASKS = JSON.stringify([{ id: 't1', title: 'Task', date: '2026-08-01' }]);
const STORED_UNSCHEDULED = JSON.stringify([{ id: 'u1', title: 'Inbox item' }]);
// A habit missing `scheduledDays`, the habits-branch normalization.
const STORED_HABITS = JSON.stringify([{ id: 'h1', name: 'Water', target: 8 }]);

function makeProps() {
  const setters = {};
  const noop = (name) => { setters[name] = vi.fn(); return setters[name]; };
  return {
    props: {
      setTasks: noop('setTasks'),
      setUnscheduledTasks: noop('setUnscheduledTasks'),
      setRecycleBin: noop('setRecycleBin'),
      setRecurringTasks: noop('setRecurringTasks'),
      setDarkMode: noop('setDarkMode'),
      setSyncUrl: noop('setSyncUrl'),
      setTaskCalendarUrl: noop('setTaskCalendarUrl'),
      setCompletedTaskUids: noop('setCompletedTaskUids'),
      setDailyNotes: noop('setDailyNotes'),
      setRoutineDefinitions: noop('setRoutineDefinitions'),
      setTodayRoutines: noop('setTodayRoutines'),
      setRoutinesDate: noop('setRoutinesDate'),
      setRemovedTodayRoutineIds: noop('setRemovedTodayRoutineIds'),
      setHabits: noop('setHabits'),
      setHabitLogs: noop('setHabitLogs'),
      setHabitsEnabled: noop('setHabitsEnabled'),
      setRoutinesEnabled: noop('setRoutinesEnabled'),
      setGoals: noop('setGoals'),
      setProjects: noop('setProjects'),
      setAreas: noop('setAreas'),
      setGoalsProjectsEnabled: noop('setGoalsProjectsEnabled'),
      setDataLoaded: noop('setDataLoaded'),
      setUnscheduledOrderTimestamp: noop('setUnscheduledOrderTimestamp'),
      setUndoToast: noop('setUndoToast'),
      suppressTimestampRef: { current: false },
      cloudSyncInitialDoneRef: { current: false },
      cloudSyncConfig: null,
    },
    setters,
  };
}

// Only the keys loadData reads; everything else returns null.
const STORE = {
  'day-planner-tasks': STORED_TASKS,
  'day-planner-unscheduled': STORED_UNSCHEDULED,
  'day-planner-habits': STORED_HABITS,
};

describe('loadData normalization write-back', () => {
  let setItem;
  let removeItem;

  beforeEach(() => {
    setItem = vi.fn();
    removeItem = vi.fn();
    globalThis.localStorage = {
      getItem: vi.fn((k) => STORE[k] ?? null),
      setItem,
      removeItem,
    };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('persists the normalized values in the main window', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();

    useDataPersistence(props).loadData();

    // All four write sites fire. Without this the normalization is lost and
    // stampTaskTimestamps re-stamps lastModified on every task at next load.
    const written = Object.fromEntries(setItem.mock.calls);
    expect(JSON.parse(written['day-planner-tasks'])[0])
      .toMatchObject({ id: 't1', notes: '', subtasks: [] });
    expect(JSON.parse(written['day-planner-unscheduled'])[0])
      .toMatchObject({ id: 'u1', notes: '', subtasks: [] });
    expect(JSON.parse(written['day-planner-habits'])[0])
      .toMatchObject({ id: 'h1', scheduledDays: [0, 1, 2, 3, 4, 5, 6] });
    // The removal receipts are rolled, not wiped: with nothing stored, the
    // rolled map is empty and is persisted as such (never removeItem).
    expect(removeItem).not.toHaveBeenCalled();
    expect(written['day-planner-removed-today-routine-ids']).toBe('{}');
  });

  it('on a new day keeps the removal receipts and stamps one at midnight per cleared chip', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props, setters } = makeProps();
    const store = {
      ...STORE,
      'day-planner-routines-date': '2000-01-01',
      'day-planner-today-routines': JSON.stringify([{ id: 'chip-a' }, { id: 7 }]),
      'day-planner-removed-today-routine-ids': JSON.stringify({ 'mid-day': '2000-01-01T15:00:00.000Z' }),
    };
    globalThis.localStorage.getItem = vi.fn((k) => store[k] ?? null);

    useDataPersistence(props).loadData();

    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const expected = {
      'mid-day': '2000-01-01T15:00:00.000Z',
      'chip-a': midnight.toISOString(),
      '7': midnight.toISOString(),
    };
    expect(setters.setTodayRoutines).toHaveBeenCalledWith([]);
    expect(setters.setRemovedTodayRoutineIds).toHaveBeenCalledWith(expected);
    const written = Object.fromEntries(setItem.mock.calls);
    expect(JSON.parse(written['day-planner-removed-today-routine-ids'])).toEqual(expected);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('writes nothing to localStorage in tray mode', async () => {
    const useDataPersistence = await loadHookAs('tray');
    const { props } = makeProps();

    useDataPersistence(props).loadData();

    // The tray holds a snapshot as of its last reload; persisting from it would
    // overwrite fresher main-window data (useSaveOnChange.js:5).
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('still reads and normalizes in tray mode, only skipping persistence', async () => {
    const useDataPersistence = await loadHookAs('tray');
    const { props, setters } = makeProps();

    useDataPersistence(props).loadData();

    // setTasks takes an updater; run it to see the value the tray would render.
    const tasksUpdater = setters.setTasks.mock.calls[0][0];
    expect(tasksUpdater([])[0]).toMatchObject({ id: 't1', notes: '', subtasks: [] });

    expect(setters.setUnscheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'u1', notes: '', subtasks: [] }),
    ]);
    expect(setters.setHabits).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'h1', scheduledDays: [0, 1, 2, 3, 4, 5, 6] }),
    ]);
    // The routine-id reset still updates React state; only the removeItem is skipped.
    expect(setters.setRemovedTodayRoutineIds).toHaveBeenCalledWith({});
    expect(setters.setDataLoaded).toHaveBeenCalledWith(true);
  });
});

// ── The original-plan baseline (utils/originalPlan.js) ──────────────────────
// Recorded in the persist pass because only there are both the new state and the
// stored copy it replaces visible at once, which is what tells a task being
// scheduled apart from one being rescheduled.
describe('saveData records the original plan', () => {
  let setItem;

  const saveProps = (over = {}) => ({
    ...makeProps().props,
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: [], routinesDate: '',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: {}, goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    ...over,
  });

  const written = (key) => JSON.parse(Object.fromEntries(setItem.mock.calls)[key]);

  beforeEach(() => {
    setItem = vi.fn();
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('stamps a task that is newly scheduled', async () => {
    const useDataPersistence = await loadHookAs('main');
    const tasks = [{ id: 't1', title: 'Report', date: '2026-09-17', startTime: '09:00', duration: 60 }];

    useDataPersistence(saveProps({ tasks })).saveData();

    expect(written('day-planner-tasks')[0].originalPlan)
      .toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('does not stamp a task that storage already had scheduled', async () => {
    const useDataPersistence = await loadHookAs('main');
    const stored = [{ id: 't1', title: 'Report', date: '2026-09-10', startTime: '14:00', lastModified: '2026-09-10T00:00:00Z' }];
    globalThis.localStorage.getItem = vi.fn((k) =>
      k === 'day-planner-tasks' ? JSON.stringify(stored) : null);
    const tasks = [{ ...stored[0], date: '2026-09-17', startTime: '09:00' }];

    useDataPersistence(saveProps({ tasks })).saveData();

    expect(written('day-planner-tasks')[0].originalPlan).toBeUndefined();
  });

  it('leaves the other four task stores alone', async () => {
    // Only the scheduled-task store opts in. The fixtures below are deliberately
    // given a full date and time, which real routines and recurring templates do
    // not have, so this fails if the flag is ever added to another store rather
    // than passing because the fixture happened to look unscheduled.
    const useDataPersistence = await loadHookAs('main');
    const timed = (id) => ({ id, title: id, date: '2026-09-17', startTime: '09:00' });

    useDataPersistence(saveProps({
      unscheduledTasks: [timed('u1')],
      recycleBin: [timed('r1')],
      recurringTasks: [timed('rec1')],
      todayRoutines: [timed('rt1')],
    })).saveData();

    for (const key of ['day-planner-unscheduled', 'day-planner-recycle-bin',
      'day-planner-recurring-tasks', 'day-planner-today-routines']) {
      expect(written(key)[0].originalPlan).toBeUndefined();
    }
  });

  it('records nothing while remote data is being applied', async () => {
    // suppressTimestampRef is set during an apply pass. This device did not
    // witness the scheduling, so claiming a baseline from whatever arrived would
    // invent one from a schedule that may already have been changed elsewhere.
    const useDataPersistence = await loadHookAs('main');
    const tasks = [{ id: 't1', title: 'Report', date: '2026-09-17', startTime: '09:00' }];

    useDataPersistence(saveProps({ tasks, suppressTimestampRef: { current: true } })).saveData();

    expect(written('day-planner-tasks')[0].originalPlan).toBeUndefined();
  });
});
