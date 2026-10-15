import { describe, it, expect } from 'vitest';
import { readThemePref, resolveDarkMode, nextThemePref, restoredThemePref, systemPrefersDark, THEME_PREF_KEY, LEGACY_DARK_KEY } from './themePref.js';

const storage = (entries = {}) => ({ getItem: (k) => (k in entries ? entries[k] : null) });

describe('readThemePref', () => {
  it('keeps every existing device on its explicit light or dark', () => {
    expect(readThemePref(storage({ [LEGACY_DARK_KEY]: 'true' }))).toBe('dark');
    expect(readThemePref(storage({ [LEGACY_DARK_KEY]: 'false' }))).toBe('light');
  });

  it('starts a fresh install on system', () => {
    expect(readThemePref(storage())).toBe('system');
  });

  it('prefers the stored preference, and ignores garbage', () => {
    expect(readThemePref(storage({ [THEME_PREF_KEY]: 'system', [LEGACY_DARK_KEY]: 'true' }))).toBe('system');
    expect(readThemePref(storage({ [THEME_PREF_KEY]: 'blue', [LEGACY_DARK_KEY]: 'true' }))).toBe('dark');
    expect(readThemePref({ getItem: () => { throw new Error('blocked'); } })).toBe('system');
  });
});

describe('resolveDarkMode', () => {
  it('follows the OS only on system', () => {
    expect(resolveDarkMode('system', true)).toBe(true);
    expect(resolveDarkMode('system', false)).toBe(false);
    expect(resolveDarkMode('dark', false)).toBe(true);
    expect(resolveDarkMode('light', true)).toBe(false);
  });

  it('reads the OS preference, and is light without matchMedia', () => {
    expect(systemPrefersDark({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(systemPrefersDark({})).toBe(false);
  });
});

describe('nextThemePref', () => {
  it('cycles Light → Dark → System → Light for the mobile tile', () => {
    expect(nextThemePref('light')).toBe('dark');
    expect(nextThemePref('dark')).toBe('system');
    expect(nextThemePref('system')).toBe('light');
  });
});

describe('restoredThemePref', () => {
  it('restores a backup\'s own preference first, then its device settings, then its resolved theme', () => {
    expect(restoredThemePref({ themePref: 'system', darkMode: true })).toBe('system');
    expect(restoredThemePref({ deviceSettings: { [THEME_PREF_KEY]: 'system' }, darkMode: true })).toBe('system');
    expect(restoredThemePref({ darkMode: true })).toBe('dark');
    expect(restoredThemePref({ darkMode: false })).toBe('light');
    expect(restoredThemePref({})).toBeNull();
  });
});
