import { describe, it, expect } from 'vitest';
import {
  DIRECT_ACCESS_INTENTS_ENABLED_KEY, getDirectAccessIntentsEnabledFlag, setDirectAccessIntentsEnabled, isDirectAccessIntentsEnabled,
} from './directAccessIntentsConfig.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('the Direct Access intents opt-in (Phase 7)', () => {
  it('is off by default, stored as "true" when on, and removed when off', () => {
    const s = mem();
    expect(getDirectAccessIntentsEnabledFlag(s)).toBe(false);
    setDirectAccessIntentsEnabled(true, s);
    expect(s.getItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY)).toBe('true');
    expect(getDirectAccessIntentsEnabledFlag(s)).toBe(true);
    setDirectAccessIntentsEnabled(false, s);
    expect(s.getItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY)).toBeNull();
    expect(getDirectAccessIntentsEnabledFlag({ getItem: () => { throw new Error('no'); } })).toBe(false);
  });

  it('gates on the flag AND a supported, connected transport', () => {
    global.localStorage = mem();
    try {
      const t = (supported, connected) => ({ isSupported: () => supported, isConnected: () => connected });
      expect(isDirectAccessIntentsEnabled(t(true, true))).toBe(false);          // flag off
      localStorage.setItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY, 'true');
      expect(isDirectAccessIntentsEnabled(t(true, true))).toBe(true);
      expect(isDirectAccessIntentsEnabled(t(false, true))).toBe(false);
      expect(isDirectAccessIntentsEnabled(t(true, false))).toBe(false);
      expect(isDirectAccessIntentsEnabled({ isSupported: () => true })).toBe(false);
      expect(isDirectAccessIntentsEnabled(null)).toBe(false);
    } finally { delete global.localStorage; }
  });
});
