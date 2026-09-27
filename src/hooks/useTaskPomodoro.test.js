import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(effect) { runtime.effects.push(effect); },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = value;
    return [runtime.slots[i], next => { runtime.slots[i] = typeof next === 'function' ? next(runtime.slots[i]) : next; }];
  },
}));
const { default: useTaskPomodoro } = await import('./useTaskPomodoro.js');
const task = { id: 't1', title: 'Focused task' };
const now = new Date(2026, 8, 27, 10, 0).getTime();
function harness() {
  const props = { records: [], loaded: true, writable: true };
  props.readWorkingSet = () => props.records;
  props.recordJobo = vi.fn(async rows => { props.records = rows; return { ok: true, value: rows }; });
  const render = () => {
    runtime.cursor = 0; runtime.effects = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = useTaskPomodoro(props);
    runtime.effects.forEach(effect => effect());
    return result;
  };
  return { props, render };
}
beforeEach(() => { runtime.slots = []; runtime.cursor = 0; runtime.effects = []; });

describe('task pomodoro lifecycle', () => {
  it('counts only finished work rounds, persists once, and ignores skipped or abandoned rounds', async () => {
    const h = harness();
    let timer = h.render();
    expect(timer.bind(task)).toBe(true);
    timer.startCycle(25, now);
    timer.skipCycle();
    timer.finishCycle(now + 25 * 60000);
    expect(h.props.recordJobo).not.toHaveBeenCalled();
    timer.startCycle(25, now);
    timer.finishCycle(now + 25 * 60000);
    timer.finishCycle(now + 25 * 60000);
    await Promise.resolve();
    expect(h.props.recordJobo).toHaveBeenCalledTimes(1);
    timer = h.render();
    timer.startCycle(25, now + 30 * 60000);
    expect(timer.finishSession()).toBe(true);
    expect(timer.finishSession()).toBe(false);
    timer.finishCycle(now + 55 * 60000);
    expect(h.props.recordJobo).toHaveBeenCalledTimes(1);
    expect(h.props.records[0].pomodoroSessions).toHaveLength(1);
  });

  it('retains a failed save for retry and refuses to discard it when binding another task', async () => {
    const h = harness();
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, error: 'storageWrite' });
    let timer = h.render();
    timer.bind(task); timer.startCycle(1, now); timer.finishCycle(now + 60000);
    await Promise.resolve();
    timer = h.render();
    expect(timer.saveState).toBe('error');
    expect(timer.bind({ id: 't2', title: 'Other' })).toBe(false);
    await timer.retry();
    expect(h.props.records[0].pomodoroSessions).toHaveLength(1);
    expect(h.props.recordJobo).toHaveBeenCalledTimes(2);
  });

  it('blocks starting on an unloaded or read-only store', () => {
    const h = harness(); h.props.loaded = false;
    expect(h.render().bind(task)).toBe(false);
    h.props.loaded = true; h.props.writable = false;
    expect(h.render().bind(task)).toBe(false);
    expect(h.props.recordJobo).not.toHaveBeenCalled();
  });
});
