import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No renderer: the hook is called once and its callbacks are driven directly,
// so a plain ref object persists across clicks just as React's would.
vi.mock('react', () => ({
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (init) => ({ current: init }),
}));

const aiComplete = vi.fn();
vi.mock('../ai.js', () => ({ aiComplete: (...args) => aiComplete(...args) }));
vi.mock('../utils/aiLanguage.js', () => ({ currentAiLanguage: () => 'en' }));

const { default: useDailyBriefings } = await import('./useDailyBriefings.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const setters = {
    setMorningGlanceText: vi.fn(), setMorningGlanceLoading: vi.fn(),
    setMorningGlanceError: vi.fn(), setMorningGlanceDismissed: vi.fn(),
    setEveningGlanceText: vi.fn(), setEveningGlanceLoading: vi.fn(),
    setEveningGlanceError: vi.fn(), setEveningGlanceDismissed: vi.fn(),
  };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const hook = useDailyBriefings({
    aiConfig: {
      enabled: true, provider: 'ollama',
      features: { morningSummary: true, eveningReflection: true },
    },
    tasks: [], recurringTasks: [], unscheduledTasks: [],
    goalsProjectsEnabled: false,
    isVisibleForUser: () => true,
    getOverdueTasks: () => [],
    ...setters,
  });
  return { hook, setters };
}

describe('useDailyBriefings refresh guard', () => {
  beforeEach(() => {
    aiComplete.mockReset();
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it.each([
    ['generateMorningSummary', 'setMorningGlanceText'],
    ['generateEveningReflection', 'setEveningGlanceText'],
  ])('%s sends one request while one is in flight', async (fn, setText) => {
    const { hook, setters } = setup();
    const first = deferred();
    aiComplete.mockReturnValueOnce(first.promise);

    const a = hook[fn](true);
    const b = hook[fn](true);
    const c = hook[fn](true);
    expect(aiComplete).toHaveBeenCalledTimes(1);

    first.resolve(' briefing ');
    await Promise.all([a, b, c]);
    expect(setters[setText]).toHaveBeenCalledWith('briefing');

    // Once it settles, a refresh goes out again.
    aiComplete.mockResolvedValueOnce('again');
    await hook[fn](true);
    expect(aiComplete).toHaveBeenCalledTimes(2);
  });

  it('releases the guard after a failed request', async () => {
    const { hook, setters } = setup();
    aiComplete.mockRejectedValueOnce(new Error('boom'));
    await hook.generateMorningSummary(true);
    expect(setters.setMorningGlanceError).toHaveBeenCalledWith('boom');

    aiComplete.mockResolvedValueOnce('ok');
    await hook.generateMorningSummary(true);
    expect(aiComplete).toHaveBeenCalledTimes(2);
    expect(setters.setMorningGlanceLoading).toHaveBeenLastCalledWith(false);
  });

  it('the morning and evening guards are independent', async () => {
    const { hook } = setup();
    const morning = deferred();
    aiComplete.mockReturnValueOnce(morning.promise).mockResolvedValueOnce('evening');

    const m = hook.generateMorningSummary(true);
    await hook.generateEveningReflection(true);
    expect(aiComplete).toHaveBeenCalledTimes(2);

    morning.resolve('morning');
    await m;
  });
});
