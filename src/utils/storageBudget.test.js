// The capacity target for local storage (#2141), held by the real save pass.
//
// The target the issue asked for, as ruled: five years of daily notes plus
// 5,000 tasks (500 of them in the Recycle Bin) stays under 70% of the ~5 MiB
// budget, in the storage gauge's own accounting. The daily notes live in
// IndexedDB (utils/dailyNotesStore.js), so they are not in this budget at
// all; habit logs are, and five years of them ride along. 10,000 tasks do not
// fit in local storage, at ~340 characters a task; past ~7,000, old completed
// tasks would have to move to IndexedDB too.
//
// A change that makes the persisted task row heavier, or puts something bulky
// back into local storage, fails this test before it reaches a user's quota.
import { describe, it, expect, vi } from 'vitest';
import { storageTotalBytes, STORAGE_LIMIT_BYTES } from './storageProjection.js';

vi.mock('./nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

const memory = () => {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i],
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
};

const day = (i) => new Date(Date.UTC(2021, 9, 20) + i * 86400000).toISOString().slice(0, 10);
const stamp = (i) => `${day(i)}T09:30:00.000Z`;
// A realistic row: what the app writes for a scheduled task with its plan
// history, a short note on some, completed on a third.
const task = (i, extra = {}) => ({
  id: `t-${i}-${(i * 2654435761 >>> 0).toString(36)}`,
  title: `Follow up with the team about item ${i} #work`,
  date: day(i % 1825), startTime: '09:00', duration: 30,
  completed: i % 3 === 0, ...(i % 3 === 0 ? { completedAt: `${day(i % 1825)}T10:12:00.000+02:00` } : {}),
  notes: i % 4 === 0 ? 'Short note about the task, a sentence or two.' : '',
  subtasks: [], color: 'bg-blue-500', priority: 0,
  originalPlan: { date: day(i % 1825), startTime: '09:00' },
  lastModified: stamp(i % 1825),
  ...extra,
});

describe('local storage capacity target (#2141)', () => {
  it('five years of use with 5,000 tasks stays under 70% of the budget', async () => {
    const storage = memory();
    globalThis.localStorage = storage;
    globalThis.window = { location: { search: '' } };
    try {
      const { default: useDataPersistence } = await import('../hooks/useDataPersistence.js');
      const scheduled = Array.from({ length: 3500 }, (_, i) => task(i));
      const inbox = Array.from({ length: 1000 }, (_, i) => {
        const { date, startTime, duration, originalPlan, ...rest } = task(10000 + i);
        return rest;
      });
      const bin = Array.from({ length: 500 }, (_, i) => task(20000 + i, { deletedAt: stamp(i), _deletedFrom: 'timeline' }));
      const habits = [1, 2, 3].map((n) => ({ id: `h${n}`, name: `Habit ${n}`, target: 1, scheduledDays: [0, 1, 2, 3, 4, 5, 6] }));
      const habitLogs = Object.fromEntries(Array.from({ length: 1825 }, (_, i) => [day(i), { h1: 1, h2: i % 2, h3: 1 }]));

      const noop = () => {};
      useDataPersistence({
        setTasks: noop, setUndoToast: noop, t: (k) => k,
        suppressTimestampRef: { current: true }, cloudSyncInitialDoneRef: { current: false }, cloudSyncConfig: null,
        tasks: scheduled, unscheduledTasks: inbox, recycleBin: bin, recurringTasks: [], todayRoutines: [],
        darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 30, completedTaskUids: new Set(),
        routineDefinitions: {}, routinesDate: day(1824), removedTodayRoutineIds: {},
        habits, habitLogs, habitsEnabled: true, routinesEnabled: false, gtdFrames: [],
        goals: [], projects: [], areas: [], goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
      }).saveData();

      const used = storageTotalBytes(storage);
      // The daily notes are not here: they live in IndexedDB.
      expect(storage.map.has('day-planner-daily-notes')).toBe(false);
      // 3.19 MiB, 64%, when this was written (October 2026).
      expect(used / STORAGE_LIMIT_BYTES).toBeLessThan(0.7);
    } finally {
      delete globalThis.localStorage;
      delete globalThis.window;
    }
  });
});
