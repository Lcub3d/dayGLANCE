import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordLoadFailure, isLoadProtected, getLoadFailures, discardLoadFailures,
  subscribeLoadFailures, resetLoadFailures,
} from './loadFailures.js';

describe('loadFailures', () => {
  let store;
  beforeEach(() => {
    resetLoadFailures();
    store = { k: '{bad' };
    globalThis.localStorage = { getItem: vi.fn((key) => store[key] ?? null) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks(); });

  it('protects a key while it still holds the value that failed', () => {
    recordLoadFailure('k', new Error('bad'), '{bad');
    expect(isLoadProtected('k')).toBe(true);
    expect(isLoadProtected('other')).toBe(false);
    expect(getLoadFailures()).toEqual([{ key: 'k', raw: '{bad', message: 'bad' }]);
  });

  it('releases the key once something else has written there', () => {
    const listener = vi.fn();
    subscribeLoadFailures(listener);
    recordLoadFailure('k', new Error('bad'), '{bad');
    store.k = '[]';
    expect(isLoadProtected('k')).toBe(false);
    expect(getLoadFailures()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stays protected when storage cannot be read at all', () => {
    recordLoadFailure('k', new Error('bad'), '{bad');
    globalThis.localStorage.getItem = () => { throw new Error('SecurityError'); };
    expect(isLoadProtected('k')).toBe(true);
  });

  it('discard releases everything', () => {
    recordLoadFailure('k', new Error('bad'), '{bad');
    discardLoadFailures();
    expect(isLoadProtected('k')).toBe(false);
  });
});
