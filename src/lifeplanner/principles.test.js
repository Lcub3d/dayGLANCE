import { describe, expect, it, vi } from 'vitest';
import {
  PRINCIPLE_ALIASES,
  PRINCIPLE_IDS,
  PRINCIPLE_KEYS,
  PRINCIPLE_TEXTS,
  defaultPrincipleText,
  isKnownDefaultPrinciple,
  localizedPrincipleText,
  principleDefaultsForLanguage,
  principleKeyFor,
} from './principles.js';

describe('seeded principle localization', () => {
  it('keeps a fixed five-key and id contract', () => {
    expect(PRINCIPLE_KEYS).toEqual(['longTerm', 'important', 'health', 'honesty', 'margin']);
    expect(PRINCIPLE_IDS).toEqual(['principle-0', 'principle-1', 'principle-2', 'principle-3', 'principle-4']);
    expect(Object.keys(PRINCIPLE_ALIASES)).toEqual(PRINCIPLE_KEYS);
    expect(Object.values(PRINCIPLE_ALIASES).every(values => values.length === 8)).toBe(true);
  });

  it('recognizes every shipped historical default by seeded id and exact text', () => {
    for (const texts of Object.values(PRINCIPLE_TEXTS)) {
      PRINCIPLE_KEYS.forEach((key, index) => {
        const principle = { id: `principle-${index}`, text: texts[key] };
        expect(principleKeyFor(principle)).toBe(key);
        expect(isKnownDefaultPrinciple(principle)).toBe(true);
      });
    }
  });

  it('switches a recognized historical default through the current translator', () => {
    const principle = { id: 'principle-0', text: PRINCIPLE_TEXTS.en.longTerm };
    const t = vi.fn(path => PRINCIPLE_TEXTS['zh-CN'][path.split('.').at(-1)]);
    expect(localizedPrincipleText(principle, t)).toBe(PRINCIPLE_TEXTS['zh-CN'].longTerm);
    expect(t).toHaveBeenCalledWith('lifeplanner.defaults.longTerm', { defaultValue: principle.text });
  });

  it('leaves user text unchanged even when its id is a seeded id', () => {
    const t = vi.fn(() => '应该不会显示');
    const custom = { id: 'principle-0', text: 'My own motto' };
    expect(principleKeyFor(custom)).toBeNull();
    expect(localizedPrincipleText(custom, t)).toBe(custom.text);
    expect(t).not.toHaveBeenCalled();
    expect(localizedPrincipleText({ id: 'principle-0', text: `${PRINCIPLE_TEXTS.en.longTerm} ` }, t))
      .toBe(`${PRINCIPLE_TEXTS.en.longTerm} `);
    expect(localizedPrincipleText({ id: 'principle-9', text: PRINCIPLE_TEXTS.en.longTerm }, t))
      .toBe(PRINCIPLE_TEXTS.en.longTerm);
  });

  it('supports language-only callers without importing locale bundles', () => {
    expect(principleDefaultsForLanguage('zh')).toEqual(Object.values(PRINCIPLE_TEXTS['zh-CN']));
    expect(principleDefaultsForLanguage('pt')).toEqual(Object.values(PRINCIPLE_TEXTS['pt-PT']));
    expect(defaultPrincipleText('margin', 'fr')).toBe(PRINCIPLE_TEXTS.fr.margin);
    expect(defaultPrincipleText('unknown', 'fr')).toBe('');
  });
});
