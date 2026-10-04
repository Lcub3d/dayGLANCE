import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The toast's time on screen: a "Schedule follow-up task" offer stays long
// enough to decide, and any toast the pointer or keyboard is on stays put.

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(fn) { runtime.effects.push(fn); },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = value;
    return [runtime.slots[i], (next) => {
      runtime.slots[i] = typeof next === 'function' ? next(runtime.slots[i]) : next;
    }];
  },
}));
const { default: useUndo } = await import('./useUndo.js');

// One render, then its toast effect (the fifth: four refs sync first), run
// as React would: only when the toast changed, after the last one's cleanup.
let cleanup = null;
let ranFor;
function render() {
  runtime.cursor = 0;
  runtime.effects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const api = useUndo({
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
    setTasks() {}, setUnscheduledTasks() {}, setRecycleBin() {}, setRecurringTasks() {},
  });
  if (api.undoToast !== ranFor) {
    ranFor = api.undoToast;
    cleanup?.();
    cleanup = runtime.effects[4]() || null;
  }
  return api;
}

beforeEach(() => { runtime.slots = []; cleanup = null; ranFor = undefined; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('undo toast timing', () => {
  it('an Undo toast goes after 4s', () => {
    render().setUndoToast({ message: 'Task completed', actionable: true });
    render();
    vi.advanceTimersByTime(3999);
    expect(render().undoToast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(render().undoToast).toBeNull();
  });

  it('a follow-up offer stays 10s', () => {
    render().setUndoToast({ message: 'Task completed', actionable: true, followUp: { id: 1 } });
    render();
    vi.advanceTimersByTime(9999);
    expect(render().undoToast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(render().undoToast).toBeNull();
  });

  it('a held toast stays, and gets its full time again once left', () => {
    render().setUndoToast({ message: 'Task completed', actionable: true, followUp: { id: 1 } });
    render().setUndoToast(prev => ({ ...prev, held: true }));
    render();
    vi.advanceTimersByTime(60000);
    expect(render().undoToast).not.toBeNull();
    render().setUndoToast(prev => ({ ...prev, held: false }));
    render();
    vi.advanceTimersByTime(9999);
    expect(render().undoToast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(render().undoToast).toBeNull();
  });
});
