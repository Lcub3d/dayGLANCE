import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task snapshots and action steps (a JOBO Do edit) share one history, so
// Cmd+Z reverses whatever was done last, whichever kind it was.

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect() {},
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = value;
    return [runtime.slots[i], (next) => { runtime.slots[i] = next; }];
  },
}));
const { default: useUndo } = await import('./useUndo.js');

function harness() {
  runtime.slots = []; runtime.cursor = 0;
  const log = [];
  const props = {
    tasks: [{ id: 'a' }], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
    setTasks: vi.fn(() => log.push('tasks')), setUnscheduledTasks: vi.fn(), setRecycleBin: vi.fn(), setRecurringTasks: vi.fn(),
    playUISound: vi.fn(),
  };
  const render = () => {
    runtime.cursor = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useUndo(props);
  };
  const api = render();
  const toast = () => render().undoToast;
  const action = (name, result = { ok: true }) => ({
    undo: vi.fn(async () => { log.push(`undo ${name}`); return typeof result === 'function' ? result('undo') : result; }),
    redo: vi.fn(async () => { log.push(`redo ${name}`); return typeof result === 'function' ? result('redo') : result; }),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { api, log, props, action, settle, toast };
}

beforeEach(() => { runtime.slots = []; runtime.cursor = 0; });

describe('one history for tasks and Do edits', () => {
  it('undoes the most recent step first, whichever kind', async () => {
    const h = harness();
    const edit = h.action('do');
    h.api.pushUndo();               // a task change
    h.api.pushUndoAction(edit);     // then a Do edit
    h.api.performUndo();
    await h.settle();
    expect(h.log).toEqual(['undo do']);
    h.api.performUndo();
    await h.settle();
    expect(h.log).toEqual(['undo do', 'tasks']);
  });

  it('redoes an undone action, and a new step clears the redo side', async () => {
    const h = harness();
    const edit = h.action('do');
    h.api.pushUndoAction(edit);
    h.api.performUndo();
    await h.settle();
    h.api.performRedo();
    await h.settle();
    expect(h.log).toEqual(['undo do', 'redo do']);
    h.api.performUndo();
    await h.settle();
    h.api.pushUndo();
    h.api.performRedo();
    await h.settle();
    expect(h.log).toEqual(['undo do', 'redo do', 'undo do']);
  });

  it('runs action steps one at a time, in the order pressed', async () => {
    const h = harness();
    let release;
    const slow = { undo: vi.fn(() => new Promise((resolve) => { release = () => { h.log.push('undo slow'); resolve({ ok: true }); }; })), redo: vi.fn() };
    const fast = h.action('fast');
    h.api.pushUndoAction(fast);
    h.api.pushUndoAction(slow);
    h.api.performUndo();
    h.api.performUndo();
    await h.settle();
    expect(fast.undo).not.toHaveBeenCalled();
    release();
    await h.settle();
    expect(h.log).toEqual(['undo slow', 'undo fast']);
  });

  // MUTATION: leave a failed step on the redo stack and a later redo replays
  // a change that never happened.
  it('drops a step that could not run, and shows why', async () => {
    const h = harness();
    const stale = h.action('stale', { ok: false, message: 'This Do has changed since' });
    h.api.pushUndoAction(stale);
    h.api.performUndo();
    await h.settle();
    expect(h.toast()).toEqual({ message: 'This Do has changed since', actionable: false });
    h.api.performRedo();
    await h.settle();
    expect(stale.redo).not.toHaveBeenCalled();
    expect(h.props.playUISound).not.toHaveBeenCalled();
  });
});
