import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The TRMNL push and its auto-sync, moved out of App.jsx into useTrmnlSync.
// Same shape as useLocalStoragePersist.test.js: React is replaced so the hook
// runs as a plain function, its effects captured to be driven by hand.
const effects = [];
const setters = [];
vi.mock('react', () => ({
  useState: (init) => {
    const set = vi.fn();
    setters.push(set);
    return [typeof init === 'function' ? init() : init, set];
  },
  useRef: (init) => ({ current: init }),
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
}));
const gatherTrmnlData = vi.fn((args) => ({
  date: args.selectedDate,
  tasks: args.tasks.map(task => task.id),
  inbox: args.unscheduledTasks.map(task => task.id),
  weather: args.weatherSummary,
  current_time: String(Date.now()),
}));
const pushToTrmnl = vi.fn();
vi.mock('../trmnl.js', () => ({ gatherTrmnlData: (...a) => gatherTrmnlData(...a), pushToTrmnl: (...a) => pushToTrmnl(...a) }));
const tray = { value: false };
vi.mock('../utils/trayMode.js', () => ({ get isTrayMode() { return tray.value; } }));

const { default: useTrmnlSync } = await import('./useTrmnlSync.js');
const { TRMNL_PUSH_STATE_KEY } = await import('../utils/trmnlPushPolicy.js');

let store;
const deps = (patch = {}) => ({
  tasks: [{ id: 'mine' }, { id: 'bob', owner: 'bob' }],
  unscheduledTasks: [{ id: 'inbox' }, { id: 'bucket', bucketId: 'someday' }, { id: 'bobs', owner: 'bob' }],
  recurringTasks: [],
  isVisibleForUser: (task) => task.owner !== 'bob',
  selectedDate: new Date(2026, 9, 9, 12),
  use24HourClock: false,
  activeHabits: [], habits: [], habitLogs: {},
  weather: { temp: 18, description: 'Cloudy' }, weatherTempUnit: 'celsius',
  dailyNotes: {}, todayRoutines: [], routinesEnabled: false,
  dataLoaded: true, t: (key) => key,
  ...patch,
});
const render = (config, patch) => {
  if (config !== undefined) store.set('day-planner-trmnl-config', JSON.stringify(config));
  effects.length = 0; setters.length = 0;
  // React is mocked above, so the hook runs as a plain function here.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useTrmnlSync(deps(patch));
};
const ENABLED = { enabled: true, webhookUrl: 'https://trmnl.example/hook' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 9, 12));
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  gatherTrmnlData.mockClear();
  pushToTrmnl.mockReset().mockResolvedValue({ success: true });
  tray.value = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('useTrmnlSync: the push', () => {
  it('does nothing without an enabled webhook', async () => {
    await render({ enabled: false, webhookUrl: 'x' }).performTrmnlSync();
    await render({ enabled: true }).performTrmnlSync();
    expect(gatherTrmnlData).not.toHaveBeenCalled();
    expect(pushToTrmnl).not.toHaveBeenCalled();
  });

  it("a manual sync sends this user's day, without the Bucket List, and records success", async () => {
    const hook = render(ENABLED);
    await hook.performTrmnlSync();
    expect(pushToTrmnl).toHaveBeenCalledTimes(1);
    const [config, mergeVars] = pushToTrmnl.mock.calls[0];
    expect(config).toEqual(ENABLED);
    expect(mergeVars).toMatchObject({ date: '2026-10-09', tasks: ['mine'], inbox: ['inbox'], weather: '18°C Cloudy' });
    expect(hook.trmnlSyncStatus).toBe('idle');
    const setStatus = setters[1]; // useState order: config, status, last synced
    expect(setStatus.mock.calls.map(([value]) => value)).toEqual(['syncing', 'success']);
    expect(store.get('day-planner-trmnl-last-synced')).toBe(new Date().toISOString());
    expect(JSON.parse(store.get(TRMNL_PUSH_STATE_KEY))).toMatchObject({ lastPushAt: Date.now(), backoffCount: 0, lastFingerprint: expect.any(String) });
  });

  it('an auto sync with unchanged content sends nothing; a manual one always sends', async () => {
    const hook = render(ENABLED);
    await hook.performTrmnlSync();
    vi.advanceTimersByTime(60 * 1000);
    await hook.performTrmnlSync({ auto: true });
    expect(pushToTrmnl).toHaveBeenCalledTimes(1);
    await hook.performTrmnlSync();
    expect(pushToTrmnl).toHaveBeenCalledTimes(2);
  });

  it('a 429 backs off, persisted, and an auto sync waits it out', async () => {
    pushToTrmnl.mockResolvedValueOnce({ success: false, rateLimited: true, retryAfterSeconds: 600, error: '429' });
    const hook = render(ENABLED);
    await hook.performTrmnlSync();
    const state = JSON.parse(store.get(TRMNL_PUSH_STATE_KEY));
    expect(state).toMatchObject({ backoffCount: 1, backoffUntil: Date.now() + 600 * 1000 });
    vi.advanceTimersByTime(5 * 60 * 1000);
    await render(undefined, { tasks: [{ id: 'changed' }] }).performTrmnlSync({ auto: true });
    expect(pushToTrmnl).toHaveBeenCalledTimes(1);
  });

  it('never runs two pushes at once', async () => {
    let release;
    pushToTrmnl.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const hook = render(ENABLED);
    const first = hook.performTrmnlSync();
    await hook.performTrmnlSync();
    expect(pushToTrmnl).toHaveBeenCalledTimes(1);
    release({ success: true });
    await first;
  });
});

describe('useTrmnlSync: the auto-sync', () => {
  const runEffects = () => effects.forEach(({ fn }) => fn());

  it('offers a push 10 s after a data change and every minute after, as auto', () => {
    const hook = render(ENABLED);
    runEffects();
    const auto = vi.fn();
    hook.performTrmnlSyncRef.current = auto;
    vi.advanceTimersByTime(10 * 1000);
    expect(auto).toHaveBeenCalledWith({ auto: true });
    vi.advanceTimersByTime(60 * 1000);
    expect(auto.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('stays off in the tray, before data has loaded, and without a webhook', () => {
    for (const [config, patch, trayMode] of [[ENABLED, {}, true], [ENABLED, { dataLoaded: false }, false], [{ enabled: true }, {}, false]]) {
      tray.value = trayMode;
      const hook = render(config, patch);
      runEffects();
      const auto = vi.fn();
      hook.performTrmnlSyncRef.current = auto;
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(auto).not.toHaveBeenCalled();
    }
  });
});
