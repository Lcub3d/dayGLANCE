import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  slots: [],
  cursor: 0,
  now: 0,
  useState(initial) {
    const index = this.cursor++;
    if (!Object.prototype.hasOwnProperty.call(this.slots, index)) {
      this.slots[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [this.slots[index], next => {
      this.slots[index] = typeof next === 'function' ? next(this.slots[index]) : next;
    }];
  },
  useRef(initial) {
    const index = this.cursor++;
    if (!Object.prototype.hasOwnProperty.call(this.slots, index)) this.slots[index] = { current: initial };
    return this.slots[index];
  },
  useEffect() {
    this.cursor++;
  },
  reset() {
    this.slots = [];
    this.cursor = 0;
    this.now = 0;
  },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useState: runtime.useState.bind(runtime),
    useRef: runtime.useRef.bind(runtime),
    useEffect: runtime.useEffect.bind(runtime),
  };
});

const { default: PlanEdgeHandle, EDGE_SNAP_HOVER_MS } = await import('./PlanEdgeHandle.jsx');

function createWindowHarness() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    emit(type, event = {}) {
      [...(listeners.get(type) || [])].forEach(listener => listener(event));
    },
  };
}

const TARGET = { startTime: '11:30', duration: 25, targetTime: '11:30' };

function event(overrides = {}) {
  return {
    button: 0,
    clientY: 100,
    detail: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

function render(overrides = {}) {
  runtime.cursor = 0;
  return PlanEdgeHandle({
    edge: 'start',
    target: TARGET,
    label: 'Resize start',
    hint: 'Snap to 11:30',
    onSnap: vi.fn(),
    onResize: vi.fn(),
    onEdit: vi.fn(),
    ...overrides,
  });
}

describe('PlanEdgeHandle', () => {
  let windowHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    runtime.reset();
    windowHarness = createWindowHarness();
    vi.stubGlobal('window', windowHarness);
    vi.stubGlobal('performance', { now: () => runtime.now });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not snap when double-clicked before the 350ms hover threshold, then snaps after it', () => {
    const onSnap = vi.fn();
    const handle = render({ onSnap });

    handle.props.onMouseEnter();
    vi.advanceTimersByTime(EDGE_SNAP_HOVER_MS - 1);
    runtime.now = EDGE_SNAP_HOVER_MS - 1;
    handle.props.onDoubleClick(event({ detail: 2 }));
    expect(onSnap).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    runtime.now = EDGE_SNAP_HOVER_MS;
    handle.props.onDoubleClick(event({ detail: 2 }));
    expect(onSnap).toHaveBeenCalledTimes(1);
    expect(onSnap).toHaveBeenCalledWith(TARGET);
  });

  it('cancels the armed edge when the pointer leaves', () => {
    const onSnap = vi.fn();
    const handle = render({ onSnap });

    handle.props.onMouseEnter();
    handle.props.onMouseLeave();
    vi.advanceTimersByTime(EDGE_SNAP_HOVER_MS);
    runtime.now = EDGE_SNAP_HOVER_MS;
    handle.props.onDoubleClick(event({ detail: 2 }));

    expect(onSnap).not.toHaveBeenCalled();
  });

  it('keeps a bottom click inert and starts resize only after moving at least 4px', () => {
    const onSnap = vi.fn();
    const onResize = vi.fn();
    const onEdit = vi.fn();
    const handle = render({ edge: 'end', onSnap, onResize, onEdit });

    handle.props.onMouseDown(event({ clientY: 100 }));
    handle.props.onClick(event({ detail: 1 }));
    expect(onResize).not.toHaveBeenCalled();
    expect(onSnap).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();

    windowHarness.emit('mousemove', { clientY: 103 });
    expect(onResize).not.toHaveBeenCalled();
    windowHarness.emit('mousemove', { clientY: 104 });

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0][0]).toMatchObject({ clientY: 100 });
  });

  it('snaps on a keyboard click with detail zero', () => {
    const onSnap = vi.fn();
    const onEdit = vi.fn();
    const handle = render({ onSnap, onEdit });

    handle.props.onClick(event({ detail: 0 }));

    expect(onSnap).toHaveBeenCalledTimes(1);
    expect(onSnap).toHaveBeenCalledWith(TARGET);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
