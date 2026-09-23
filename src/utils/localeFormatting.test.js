import { describe, expect, it } from 'vitest';
import {
  defaultUse24HourClock,
  defaultWeekStartDay,
  formatLocalizedDate,
  localizedList,
  localizedWeekdays,
  speechRecognitionLocale,
} from './localeFormatting.js';

describe('Simplified Chinese locale formatting', () => {
  it.each([['de', 1], ['fr', 1], ['es', 1], ['it', 1], ['pt-PT', 0], ['en-GB', 1]])('uses regional week and clock defaults for %s', (locale, firstDay) => {
    expect(defaultUse24HourClock(locale)).toBe(true);
    expect(defaultWeekStartDay(locale)).toBe(firstDay);
  });

  it('uses the Chinese clock and week defaults for a fresh profile', () => {
    expect(defaultUse24HourClock('zh-CN')).toBe(true);
    expect(defaultWeekStartDay('zh-CN')).toBe(1);
    expect(defaultUse24HourClock('en')).toBe(false);
    expect(defaultWeekStartDay('en')).toBe(0);
  });

  it('formats dates and weekdays in Chinese order', () => {
    const date = new Date(2026, 7, 31, 12);
    expect(formatLocalizedDate(date, { weekday: 'short', month: 'long', day: 'numeric' }, 'zh-CN'))
      .toBe('8月31日周一');
    expect(localizedWeekdays('short', 'zh-CN')).toEqual([
      '周日', '周一', '周二', '周三', '周四', '周五', '周六',
    ]);
  });

  // SpeechRecognition needs a regional tag ("uk-UA"), not the bare app
  // language ("uk") or a script-qualified one ("uk-Cyrl-UA").
  it.each([
    ['de', 'de-DE'], ['es', 'es-ES'], ['fr', 'fr-FR'], ['it', 'it-IT'],
    ['pl', 'pl-PL'], ['uk', 'uk-UA'], ['zh-CN', 'zh-CN'],
    ['pt-BR', 'pt-BR'], ['pt-PT', 'pt-PT'], ['en', 'en-US'],
  ])('gives %s a regional tag for speech recognition', (language, expected) => {
    expect(speechRecognitionLocale(language, null)).toBe(expected);
  });

  // The interesting axis is app language against browser tag: the browser
  // refines a bare app tag in the same language, and nothing else.
  it.each([
    ['en', 'en-GB', 'en-GB'], ['de', 'de-AT', 'de-AT'], ['es', 'es-MX', 'es-MX'], ['fr', 'fr-CA', 'fr-CA'],
    ['uk', 'en-US', 'uk-UA'], ['pl', 'de-DE', 'pl-PL'],
    ['pt-BR', 'pt-PT', 'pt-BR'], ['zh-CN', 'zh-TW', 'zh-CN'],
    ['en', 'en', 'en-US'], ['en', 'not a tag!', 'en-US'], ['en', null, 'en-US'],
  ])('app %s with browser %s listens as %s', (language, reported, expected) => {
    expect(speechRecognitionLocale(language, reported)).toBe(expected);
  });
});

describe('localizedList', () => {
  it('passes a single item through unchanged', () => {
    expect(localizedList(['3 events'], 'en')).toBe('3 events');
  });

  it('joins two items with the locale\'s own conjunction, not a hardcoded "and"', () => {
    expect(localizedList(['3 events', '2 tasks'], 'en')).toBe('3 events and 2 tasks');
    expect(localizedList(['3 Termine', '2 Aufgaben'], 'de')).toBe('3 Termine und 2 Aufgaben');
    expect(localizedList(['calendrier', 'calendrier de tâches'], 'fr')).toBe('calendrier et calendrier de tâches');
    expect(localizedList(['3 个事件', '2 个任务'], 'zh-CN')).toBe('3 个事件和2 个任务');
  });
});
