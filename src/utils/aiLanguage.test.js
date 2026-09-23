import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { LANGUAGE_NAMES, currentAiLanguage, languageInstruction, withLanguage } from './aiLanguage.js';
import { languages } from '../locales.js';

describe('LANGUAGE_NAMES', () => {
  // A language the app ships without a name here would get its bare tag in the
  // prompt ("Write every user-facing sentence in pt-BR"), which most models
  // handle but none should have to. Same enforcement idea as locales.test.js.
  it('names every language the app ships, and nothing else', () => {
    const shipped = readdirSync(new URL('../../public/locales', import.meta.url), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual(shipped);
    expect(shipped).toEqual([...languages].sort());
  });
});

describe('languageInstruction', () => {
  it('names the language in English and natively, and protects the JSON contract', () => {
    const text = languageInstruction('zh-CN');
    expect(text).toContain('Simplified Chinese (简体中文)');
    expect(text).toMatch(/JSON keys/);
    expect(text).toMatch(/HH:MM/);
  });

  it('does not repeat a name that is the same in both', () => {
    expect(languageInstruction('en')).toContain('in English.');
    expect(languageInstruction('en')).not.toContain('English (English)');
  });

  it('distinguishes the two Portuguese variants', () => {
    expect(languageInstruction('pt-BR')).toContain('Brazilian Portuguese');
    expect(languageInstruction('pt-PT')).toContain('European Portuguese');
  });

  // The same resolution the language picker and the detector use, so a stored
  // "pt" or a browser's "pt-br" lands on the bundle the app actually shows.
  it('resolves a loose tag the way the app does', () => {
    expect(languageInstruction('pt-br')).toContain('Brazilian Portuguese');
    expect(languageInstruction('de-AT')).toContain('German');
    expect(languageInstruction(undefined)).toContain('in English.');
  });
});

describe('withLanguage', () => {
  it('appends the instruction as the last paragraph, exactly once', () => {
    const out = withLanguage('You are a helper.\n\nRules:\n- be brief', 'de');
    expect(out.startsWith('You are a helper.\n\nRules:\n- be brief\n\n')).toBe(true);
    expect(out.endsWith(languageInstruction('de'))).toBe(true);
    expect(out.match(/Write every user-facing sentence/g)).toHaveLength(1);
  });
});

describe('currentAiLanguage', () => {
  it('reads the resolved language first, then the raw one', () => {
    expect(currentAiLanguage({ resolvedLanguage: 'fr', language: 'de' })).toBe('fr');
    expect(currentAiLanguage({ language: 'de' })).toBe('de');
  });

  it('falls back to English before i18next has initialised', () => {
    expect(currentAiLanguage({})).toBe('en');
    expect(currentAiLanguage(undefined)).toBe('en');
  });

  it('never returns a tag no bundle exists for', () => {
    expect(currentAiLanguage({ resolvedLanguage: 'pt' })).toBe('pt-PT');
    expect(currentAiLanguage({ resolvedLanguage: 'xx' })).toBe('en');
  });
});
