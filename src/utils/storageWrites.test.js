import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeItem, getWriteFailures, subscribeWriteFailures, resetWriteFailures, isQuotaError } from './storageWrites.js';

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

describe('writeItem', () => {
  let full;
  beforeEach(() => {
    resetWriteFailures();
    full = false;
    globalThis.localStorage = { setItem: vi.fn(() => { if (full) throw quota(); }) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks(); });

  it('reports whether the write landed and never throws', () => {
    expect(writeItem('k', 'v')).toBe(true);
    full = true;
    expect(() => writeItem('k', 'v')).not.toThrow();
    expect(writeItem('k', 'v')).toBe(false);
  });

  it('records a quota failure until that key writes again', () => {
    const listener = vi.fn();
    subscribeWriteFailures(listener);
    full = true;
    writeItem('a', '1');
    writeItem('a', '1');
    expect(getWriteFailures()).toEqual(['a']);
    expect(listener).toHaveBeenCalledTimes(1);
    full = false;
    writeItem('a', '1');
    expect(getWriteFailures()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not count other errors as a full store', () => {
    globalThis.localStorage.setItem = () => { throw new Error('SecurityError'); };
    expect(writeItem('a', '1')).toBe(false);
    expect(getWriteFailures()).toEqual([]);
  });

  it('recognises the quota error names', () => {
    expect(isQuotaError(quota())).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
  });
});
