import { describe, it, expect } from 'vitest';
import { parseBriefingCache, isBriefingCurrent, readBriefingCache, writeBriefingCache } from './briefingCache.js';

const TODAY = '2026-09-23';
function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), dump: () => Object.fromEntries(m) };
}

describe('isBriefingCurrent', () => {
  it("is current for today's entry in the language shown now", () => {
    expect(isBriefingCurrent({ date: TODAY, language: 'de', text: 'x' }, TODAY, 'de')).toBe(true);
  });

  it('is stale on another day', () => {
    expect(isBriefingCurrent({ date: '2026-09-22', language: 'de', text: 'x' }, TODAY, 'de')).toBe(false);
  });

  // The whole reason the language is recorded (#1789): switching languages at
  // noon must regenerate, not keep serving the morning's English text.
  it('is stale in another language', () => {
    expect(isBriefingCurrent({ date: TODAY, language: 'en', text: 'x' }, TODAY, 'de')).toBe(false);
  });

  // Every briefing before this change was English, so an entry without a
  // language keeps working for English users and regenerates for the rest.
  it('treats an entry from before the language was recorded as English', () => {
    expect(isBriefingCurrent({ date: TODAY, text: 'x' }, TODAY, 'en')).toBe(true);
    expect(isBriefingCurrent({ date: TODAY, text: 'x' }, TODAY, 'zh-CN')).toBe(false);
  });

  it('is never current for nothing', () => {
    expect(isBriefingCurrent(null, TODAY, 'en')).toBe(false);
  });
});

describe('parseBriefingCache', () => {
  it('returns null for absent, empty, corrupt or shapeless values', () => {
    expect(parseBriefingCache(null)).toBeNull();
    expect(parseBriefingCache('')).toBeNull();
    expect(parseBriefingCache('{not json')).toBeNull();
    expect(parseBriefingCache('"just a string"')).toBeNull();
    expect(parseBriefingCache('{"text":"no date"}')).toBeNull();
  });
});

describe('read and write', () => {
  it('round-trips through storage with the language recorded', () => {
    const storage = memStorage();
    writeBriefingCache(storage, 'k', TODAY, 'fr', 'Bonjour');
    expect(JSON.parse(storage.dump().k)).toEqual({ date: TODAY, language: 'fr', text: 'Bonjour' });
    expect(readBriefingCache(storage, 'k', TODAY, 'fr')).toBe('Bonjour');
    expect(readBriefingCache(storage, 'k', TODAY, 'en')).toBeNull();
    expect(readBriefingCache(storage, 'k', '2026-09-24', 'fr')).toBeNull();
  });

  it('survives a storage that throws', () => {
    const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    expect(readBriefingCache(broken, 'k', TODAY, 'en')).toBeNull();
    expect(() => writeBriefingCache(broken, 'k', TODAY, 'en', 'x')).not.toThrow();
  });
});
