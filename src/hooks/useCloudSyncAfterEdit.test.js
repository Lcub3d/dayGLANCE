import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The one effect, run the way React runs it: re-run (cleanup first) when a
// dependency changes, skipped otherwise.
const react = vi.hoisted(() => ({ slot: null }));
vi.mock('react', () => ({
  useEffect: (effect, deps) => {
    const slot = react.slot ??= {};
    if (!slot.deps || deps.length !== slot.deps.length || deps.some((d, n) => d !== slot.deps[n])) {
      slot.cleanup?.();
      slot.cleanup = effect();
      slot.deps = deps;
    }
  },
}));
import useCloudSyncAfterEdit, { SYNC_AFTER_EDIT_DELAY_MS } from './useCloudSyncAfterEdit.js';

// A plain alias, as useCalendarFileImport.test.js does: the stub above is not React.
const runHook = useCloudSyncAfterEdit;

function harness() {
  const engine = { download: vi.fn(), upload: vi.fn() };
  const refs = {
    syncKeyReadyRef: { current: true },
    suppressCloudUploadRef: { current: false },
    cloudSyncDebounceRef: { current: null },
    cloudSyncDownloadRef: { current: () => engine.download() },
  };
  let tasks = [];
  const render = (over = {}) => runHook({
    enabled: true, dataLoaded: true, syncKeyReady: true, ...refs, changeKeys: [tasks], ...over,
  });
  const edit = () => { tasks = [...tasks, { id: String(tasks.length) }]; render(); };
  render();
  return { engine, refs, render, edit };
}

beforeEach(() => { vi.useFakeTimers(); react.slot = null; });
afterEach(() => { vi.useRealTimers(); });

describe('useCloudSyncAfterEdit', () => {
  it('an edit runs the full sync cycle after the delay, never a bare upload', () => {
    const { engine, edit } = harness();
    vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS);
    engine.download.mockClear(); // the mount pass arms one cycle, as the inline effect did
    edit();
    vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS - 1);
    expect(engine.download).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(engine.download).toHaveBeenCalledTimes(1);
    expect(engine.upload).not.toHaveBeenCalled();
  });

  it('a burst of edits is one cycle, five seconds after the last', () => {
    const { engine, edit } = harness();
    for (let i = 0; i < 4; i++) { edit(); vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS - 1000); }
    expect(engine.download).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(engine.download).toHaveBeenCalledTimes(1);
  });

  it('a state change from applying remote data arms nothing', () => {
    const { engine, refs, edit } = harness();
    vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS);
    engine.download.mockClear();
    refs.suppressCloudUploadRef.current = true;
    edit();
    vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS * 2);
    expect(engine.download).not.toHaveBeenCalled();
  });

  it('nothing runs while sync is off, before data loads, or before the key is ready', () => {
    for (const over of [{ enabled: false }, { dataLoaded: false }]) {
      react.slot = null;
      const { engine, render } = harness();
      vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS);
      engine.download.mockClear();
      render({ ...over, changeKeys: [[{ id: 'x' }]] });
      vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS);
      expect(engine.download, JSON.stringify(over)).not.toHaveBeenCalled();
    }
    react.slot = null;
    const { engine, refs, edit } = harness();
    vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS);
    engine.download.mockClear();
    refs.syncKeyReadyRef.current = false;
    edit();
    vi.advanceTimersByTime(SYNC_AFTER_EDIT_DELAY_MS);
    expect(engine.download).not.toHaveBeenCalled();
  });
});
