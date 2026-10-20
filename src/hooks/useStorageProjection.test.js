import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react', () => ({ useEffect: (fn) => { fn(); } }));
const { default: useStorageProjection } = await import('./useStorageProjection.js');
const { STORAGE_SAMPLES_KEY, STORAGE_WARNED_KEY } = await import('../utils/storageProjection.js');

const memory = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i],
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
};

describe('useStorageProjection', () => {
  let storage;
  const t = (key, opts) => `${key}${opts?.count != null ? `:${opts.count}` : ''}`;
  beforeEach(() => { storage = memory(); globalThis.localStorage = storage; });
  afterEach(() => { delete globalThis.localStorage; });

  it('records today\'s sample once the data has loaded, and nothing before', () => {
    const setUndoToast = vi.fn();
    useStorageProjection({ dataLoaded: false, isTrayMode: false, setUndoToast, t, storage, now: () => new Date(2026, 9, 19) });
    expect(storage.map.has(STORAGE_SAMPLES_KEY)).toBe(false);
    useStorageProjection({ dataLoaded: true, isTrayMode: false, setUndoToast, t, storage, now: () => new Date(2026, 9, 19) });
    expect(JSON.parse(storage.map.get(STORAGE_SAMPLES_KEY))).toEqual([{ date: '2026-10-19', bytes: expect.any(Number) }]);
    expect(setUndoToast).not.toHaveBeenCalled();
  });

  it('the tray records nothing', () => {
    useStorageProjection({ dataLoaded: true, isTrayMode: true, setUndoToast: vi.fn(), t, storage });
    expect(storage.map.size).toBe(0);
  });

  it('warns once a week when the store is filling fast', () => {
    // 3 weeks of history climbing 100 kB a day toward the limit.
    const samples = Array.from({ length: 21 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10),
      bytes: 2_500_000 + i * 100_000,
    }));
    storage.setItem(STORAGE_SAMPLES_KEY, JSON.stringify(samples));
    storage.setItem('day-planner-tasks', 'x'.repeat(2_200_000)); // ~4.4 MB in the gauge's accounting
    const setUndoToast = vi.fn();
    useStorageProjection({ dataLoaded: true, isTrayMode: false, setUndoToast, t, storage, now: () => new Date(2026, 9, 19) });
    expect(setUndoToast).toHaveBeenCalledTimes(1);
    expect(setUndoToast.mock.calls[0][0]).toMatchObject({ kind: 'warning', message: expect.stringMatching(/^storage\.projectionWarning/) });
    expect(storage.map.get(STORAGE_WARNED_KEY)).toBe('2026-10-19');

    // The next launch the same week stays quiet.
    useStorageProjection({ dataLoaded: true, isTrayMode: false, setUndoToast, t, storage, now: () => new Date(2026, 9, 20) });
    expect(setUndoToast).toHaveBeenCalledTimes(1);
  });
});
