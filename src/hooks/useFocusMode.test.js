import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = typeof value === 'function' ? value() : value;
    return [runtime.slots[i], next => { runtime.slots[i] = typeof next === 'function' ? next(runtime.slots[i]) : next; }];
  },
  useEffect(effect, deps) {
    const i = runtime.cursor++;
    const previous = runtime.slots[i];
    if (previous && deps.every((dep, index) => Object.is(dep, previous.deps[index]))) return;
    runtime.effects.push(() => {
      previous?.cleanup?.();
      runtime.slots[i] = { deps, cleanup: effect() };
    });
  },
}));
vi.mock('../native.js', () => ({ isNativeAndroid: () => false }));
const { default: useFocusMode } = await import('./useFocusMode.js');
function render() {
  runtime.cursor = 0; runtime.effects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const timer = useFocusMode();
  runtime.effects.forEach(effect => effect());
  return timer;
}
function start(seconds) {
  const timer = render();
  timer.setShowFocusMode(true); timer.setFocusShowSettings(false);
  timer.setFocusTimerSeconds(seconds); timer.setFocusTimerRunning(true);
  return render();
}
beforeEach(() => {
  runtime.slots = []; runtime.cursor = 0; runtime.effects = [];
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('focus countdown deadlines', () => {
  it('catches up after a throttled tab and completes once using the actual deadline', () => {
    const timer = start(5);
    const finished = vi.fn(); timer.handleFocusTimerEndRef.current = finished;
    const deadline = Date.now() + 5000;
    vi.setSystemTime(Date.now() + 8000);
    vi.advanceTimersByTime(1000);
    expect(render().focusTimerSeconds).toBe(0);
    expect(finished).toHaveBeenCalledExactlyOnceWith(deadline);
    render(); vi.advanceTimersByTime(10000); render();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('does not charge paused time and resumes with the remaining work', () => {
    let timer = start(5);
    vi.advanceTimersByTime(2000); timer = render();
    expect(timer.focusTimerSeconds).toBe(3);
    timer.setFocusTimerRunning(false); render();
    vi.advanceTimersByTime(10000); timer = render();
    expect(timer.focusTimerSeconds).toBe(3);
    timer.setFocusTimerRunning(true); render();
    vi.advanceTimersByTime(1000);
    expect(render().focusTimerSeconds).toBe(2);
  });

  it('starts a new deadline when skipping from work to a break', () => {
    let timer = start(3);
    vi.advanceTimersByTime(2000); timer = render();
    timer.setFocusPhase('shortBreak'); timer.setFocusTimerSeconds(7); render();
    vi.advanceTimersByTime(1000);
    expect(render().focusTimerSeconds).toBe(6);
  });
});
