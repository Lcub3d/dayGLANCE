import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Render-free: useState hands back a value and a spy setter.
vi.mock('react', () => ({ useState: (init) => [init, vi.fn()] }));

const { default: useRecycleBin } = await import('./useRecycleBin.js');
const { resetWriteFailures, getWriteFailures } = await import('../utils/storageWrites.js');

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

describe('confirmEmptyBin when storage is full (#2139)', () => {
  let store;
  let deps;
  beforeEach(() => {
    resetWriteFailures();
    store = { 'day-planner-deleted-task-ids': '{}' };
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
    };
    globalThis.window = {};
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deps = {
      recycleBin: [{ id: 'b1' }, { id: 'b2' }],
      setRecycleBin: vi.fn(),
      pushUndo: vi.fn(),
      setTasks: vi.fn(),
      setUnscheduledTasks: vi.fn(),
      playUISound: vi.fn(),
      onStorageFull: vi.fn(),
    };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  it('empties the bin after writing its tombstones', () => {
    useRecycleBin(deps).confirmEmptyBin();
    expect(Object.keys(JSON.parse(store['day-planner-deleted-task-ids']))).toEqual(['b1', 'b2']);
    expect(deps.setRecycleBin).toHaveBeenCalledWith([]);
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'binEmptied' });
  });

  it('stops before deleting anything when the tombstones cannot be written', () => {
    globalThis.localStorage.setItem = vi.fn(() => { throw quota(); });
    expect(() => useRecycleBin(deps).confirmEmptyBin()).not.toThrow();
    expect(deps.setRecycleBin).not.toHaveBeenCalled();
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.onStorageFull).toHaveBeenCalled();
    expect(getWriteFailures()).toEqual(['day-planner-deleted-task-ids']);
  });
});
