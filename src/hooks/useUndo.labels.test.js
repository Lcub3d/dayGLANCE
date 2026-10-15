import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';

// An undo step says what it did, and the toasts say it back: the action's
// own toast, then "Undone: …" and "Redone: …" for as long as the step is
// walked back and forth. A step with no label still says a plain "Undone".

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(fn) { runtime.effects.push(fn); },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = value;
    return [runtime.slots[i], (next) => { runtime.slots[i] = typeof next === 'function' ? next(runtime.slots[i]) : next; }];
  },
}));
const { default: useUndo } = await import('./useUndo.js');

let t;
beforeAll(async () => {
  const en = JSON.parse(readFileSync(join(process.cwd(), 'public', 'locales', 'en', 'translation.json'), 'utf8'));
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  t = i18n.t.bind(i18n);
});

function app(tasks) {
  runtime.slots = [];
  const state = { tasks, unscheduledTasks: [], recycleBin: [], recurringTasks: [] };
  const setter = (key) => (next) => { state[key] = typeof next === 'function' ? next(state[key]) : next; };
  const render = () => {
    runtime.cursor = 0;
    runtime.effects = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const api = useUndo({
      ...state,
      setTasks: setter('tasks'), setUnscheduledTasks: setter('unscheduledTasks'),
      setRecycleBin: setter('recycleBin'), setRecurringTasks: setter('recurringTasks'),
      playUISound() {}, t,
    });
    runtime.effects.slice(0, 5).forEach((fn) => fn());
    return api;
  };
  return { state, render };
}

describe('undo toasts that say what was undone', () => {
  it('a labelled step is named by its action toast, its undo and its redo', () => {
    const { state, render } = app([{ id: 't1', title: 'Write report', completed: false }]);
    // toggleComplete: the label is said before the change, so the toast the
    // action shows reads the same as the undo that follows.
    const said = render().pushUndo({ key: 'completed', taskId: 't1' });
    expect(said).toBe('Completed "Write report"');
    state.tasks = [{ id: 't1', title: 'Write report', completed: true }];

    render().performUndo();
    expect(state.tasks[0].completed).toBe(false);
    expect(render().undoToast.message).toBe('Undone: Completed "Write report"');

    render().performRedo();
    expect(state.tasks[0].completed).toBe(true);
    expect(render().undoToast.message).toBe('Redone: Completed "Write report"');

    render().performUndo();
    expect(render().undoToast.message).toBe('Undone: Completed "Write report"');
  });

  it('names the task as it was before the step, not after', () => {
    const { state, render } = app([{ id: 't1', title: 'Old name' }]);
    render().pushUndo({ key: 'renamed', taskId: 't1' });
    state.tasks = [{ id: 't1', title: 'New name' }];
    render().performUndo();
    expect(render().undoToast.message).toBe('Undone: Renamed "Old name"');
  });

  it('says a plain "Undone" for a step with no label', () => {
    const { state, render } = app([{ id: 't1', title: 'Write report' }]);
    expect(render().pushUndo()).toBeNull();
    state.tasks = [];
    render().performUndo();
    expect(render().undoToast.message).toBe('Undone');
    render().performRedo();
    expect(render().undoToast.message).toBe('Redone');
  });

  it('an action step (a JOBO Do edit) is named the same way', async () => {
    const { render } = app([]);
    render().pushUndoAction({ undo: async () => ({ ok: true }), redo: async () => ({ ok: true }) }, 'Do added');
    render().performUndo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render().undoToast.message).toBe('Undone: Do added');
    render().performRedo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render().undoToast.message).toBe('Redone: Do added');
  });

  it('a failed action step still says why, not what', async () => {
    const { render } = app([]);
    render().pushUndoAction({ undo: async () => ({ ok: false, message: 'This Do has changed since.' }) }, 'Do saved');
    render().performUndo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render().undoToast.message).toBe('This Do has changed since.');
  });
});
