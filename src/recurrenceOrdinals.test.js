import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import { loaders } from './locales.js';
import { getRecurrenceLabel } from './utils/taskUtils.js';

/**
 * Italian ordinals select the `many` plural category for 8 and 11 — a category
 * English does not have at all, since its ordinals only run one/two/few/other.
 * The Italian bundle therefore carried four forms where its own rules select
 * five, and i18next fell through to the English `_other` for exactly those two
 * days: "Ogni mese il giorno 8th" against "Ogni mese il giorno 7" either side
 * of it.
 *
 * Asserted through getRecurrenceLabel rather than against the bundle, because
 * the bug was never in the JSON alone — it was in what i18next resolved when
 * the app asked for a label. A test that only checked the key existed would
 * have passed while the 8th still read as English.
 */
describe('Italian recurrence ordinals', () => {
  let t;

  beforeAll(async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'it',
      fallbackLng: 'en',
      resources: {
        it: { translation: await loaders['it']() },
        en: { translation: await loaders['en']() },
      },
      interpolation: { escapeValue: false },
    });
    t = instance.t.bind(instance);
  });

  // 8 and 11 are the regression; the rest pin the categories either side of
  // them so a future edit cannot "fix" these two by breaking the others.
  it.each([1, 2, 3, 7, 8, 9, 11, 12, 21, 23, 31])('renders day %i without an English suffix', (day) => {
    const label = getRecurrenceLabel({ type: 'monthly', monthDay: day }, t, 'it');
    expect(label).toBe(`Ogni mese il giorno ${day}`);
    expect(label).not.toMatch(/\d(st|nd|rd|th)\b/);
  });

  it('selects the many category for 8 and 11, and only those', () => {
    const rules = new Intl.PluralRules('it', { type: 'ordinal' });
    const many = [];
    for (let n = 1; n <= 31; n += 1) if (rules.select(n) === 'many') many.push(n);
    expect(many).toEqual([8, 11]);
  });
});
