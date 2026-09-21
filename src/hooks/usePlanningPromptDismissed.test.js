import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const external = vi.hoisted(() => ({}));
vi.mock('react', () => ({ useSyncExternalStore: (subscribe, snapshot) => {
  Object.assign(external, { subscribe, snapshot });
  return snapshot();
} }));
import usePlanningPromptDismissed, { PLANNING_PROMPT_CHANGED } from './usePlanningPromptDismissed.js';
import { dismissPlanningChoicesForToday, PLANNING_PROMPT_DISMISSED_KEY } from '../lifeplanner/planningChoicesPrompt.js';

let data, target;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 21, 12));
  data = new Map();
  target = new EventTarget();
  Object.assign(target, {
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
    setInterval, clearInterval,
  });
  vi.stubGlobal('window', target);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('planning question mark visibility', () => {
  it('updates immediately in the current tab and remains dismissed on remount', () => {
    expect(usePlanningPromptDismissed()).toBe(false);
    const notify = vi.fn();
    const cleanup = external.subscribe(notify);
    expect(dismissPlanningChoicesForToday(target.localStorage)).toBe(true);
    target.dispatchEvent(new Event(PLANNING_PROMPT_CHANGED));
    expect(notify).toHaveBeenCalledOnce();
    expect(external.snapshot()).toBe(true);
    expect(usePlanningPromptDismissed()).toBe(true);
    cleanup();
    target.dispatchEvent(new Event(PLANNING_PROMPT_CHANGED));
    expect(notify).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('follows other tabs and restores the entry after the local day changes', () => {
    usePlanningPromptDismissed();
    const notify = vi.fn();
    const cleanup = external.subscribe(notify);
    data.set(PLANNING_PROMPT_DISMISSED_KEY, '2026-09-21');
    target.dispatchEvent(Object.assign(new Event('storage'), { key: PLANNING_PROMPT_DISMISSED_KEY }));
    expect(notify).toHaveBeenCalledOnce();
    expect(external.snapshot()).toBe(true);
    vi.setSystemTime(new Date(2026, 8, 22));
    vi.advanceTimersByTime(60_000);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(external.snapshot()).toBe(false);
    cleanup();
  });
  it('does not hide the entry if dismissal storage fails', () => {
    target.localStorage.setItem = () => { throw new Error('quota'); };
    expect(dismissPlanningChoicesForToday(target.localStorage)).toBe(false);
    expect(usePlanningPromptDismissed()).toBe(false);
  });
});
