import { describe, it, expect, vi } from 'vitest';

// Frame edits (skip a day, adjust its times, resize it) push undo steps like
// task edits do. The step has to carry the Frames, or Cmd+Z says "Undone" and
// the Frame stays as it was.

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(fn) { runtime.effects.push(fn); },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = value;
    return [runtime.slots[i], (next) => { runtime.slots[i] = next; }];
  },
}));
const { default: useUndo } = await import('./useUndo.js');

// App state the hook reads and writes, with React's functional updates.
function app(gtdFrames) {
  runtime.slots = [];
  const state = { tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], gtdFrames };
  const setter = (key) => (next) => { state[key] = typeof next === 'function' ? next(state[key]) : next; };
  const render = () => {
    runtime.cursor = 0;
    runtime.effects = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const api = useUndo({
      ...state,
      setTasks: setter('tasks'), setUnscheduledTasks: setter('unscheduledTasks'),
      setRecycleBin: setter('recycleBin'), setRecurringTasks: setter('recurringTasks'),
      setGtdFrames: setter('gtdFrames'), playUISound() {},
    });
    // The ref syncs, as React runs them after a render that changed state.
    runtime.effects.slice(0, 5).forEach((fn) => fn());
    return api;
  };
  return { state, render };
}

const frame = { id: 'f1', name: 'Deep work', start: '09:00', end: '11:00', lastModified: '2026-10-14T11:00:00.000Z' };

describe('undo of a Frame edit', () => {
  it('puts the Frame back, and redo takes it forward again', () => {
    const { state, render } = app([frame]);
    render().pushUndo();
    // skipFrameForDay, as App.jsx writes it.
    state.gtdFrames = state.gtdFrames.map((f) => ({
      ...f, lastModified: '2026-10-14T11:30:00.000Z', exceptions: { '2026-10-14': { deleted: true } },
    }));
    render().performUndo();
    expect(state.gtdFrames[0].exceptions).toBeUndefined();
    // A fresh stamp, so the next sync keeps the undo rather than the skip.
    expect(Date.parse(state.gtdFrames[0].lastModified)).toBeGreaterThan(Date.parse('2026-10-14T11:30:00.000Z'));

    render().performRedo();
    expect(state.gtdFrames[0].exceptions).toEqual({ '2026-10-14': { deleted: true } });
  });

  it('leaves Frames alone when the step changed only tasks', () => {
    const { state, render } = app([frame]);
    const before = state.gtdFrames;
    render().pushUndo();
    state.tasks = [{ id: 't1' }];
    render().performUndo();
    expect(state.tasks).toEqual([]);
    expect(state.gtdFrames).toBe(before);
  });
});
