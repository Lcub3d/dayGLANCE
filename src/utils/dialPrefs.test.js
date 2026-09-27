import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ALARM_PREFS, DIAL_ALARM_KEY, loadAlarmPrefs, saveAlarmPrefs } from './dialPrefs.js';

describe('dial alarm prefs', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('defaults to on, from 18:00', () => {
    expect(loadAlarmPrefs()).toEqual({ on: true, fromMin: 18 * 60 });
    expect(DEFAULT_ALARM_PREFS).toEqual({ on: true, fromMin: 1080 });
  });

  it('round-trips, and repairs a malformed from-time', () => {
    saveAlarmPrefs({ on: false, fromMin: 21 * 60 });
    expect(loadAlarmPrefs()).toEqual({ on: false, fromMin: 1260 });
    localStorage.setItem(DIAL_ALARM_KEY, JSON.stringify({ on: true, fromMin: 'late' }));
    expect(loadAlarmPrefs()).toEqual({ on: true, fromMin: 1080 });
    localStorage.setItem(DIAL_ALARM_KEY, '{nope');
    expect(loadAlarmPrefs()).toEqual(DEFAULT_ALARM_PREFS);
  });
});
