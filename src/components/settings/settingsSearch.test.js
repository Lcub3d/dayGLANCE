import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SECTION_SEARCH, foldText, searchSettings } from './settingsSearch.js';
import { TOPICS } from './settingsTopics.js';

const en = JSON.parse(readFileSync(new URL('../../../public/locales/en/translation.json', import.meta.url), 'utf8'));
const lookup = (key) => key.split('.').reduce((node, part) => node?.[part], en);
const t = (key) => lookup(key) ?? key;

const allShown = Object.fromEntries(TOPICS.flatMap((topic) => topic.sections).map((key) => [key, { show: true }]));

describe('settings search', () => {
  it('indexes every section of every topic, with keys that exist', () => {
    for (const key of TOPICS.flatMap((topic) => topic.sections)) {
      expect(SECTION_SEARCH[key], key).toBeTruthy();
    }
    for (const keys of Object.values(SECTION_SEARCH)) {
      for (const key of keys) expect(typeof lookup(key), key).toBe('string');
    }
  });

  it('finds Theme by "dark", naming the matching choice', () => {
    expect(searchSettings('dark', allShown, t)).toContainEqual({ topicId: 'appearance', sectionKey: 'theme', title: 'Theme', match: 'Dark' });
  });

  it('matches without case or accents', () => {
    expect(foldText('Réglages ')).toBe('reglages');
    expect(searchSettings('TRMNL', allShown, t).map((r) => r.sectionKey)).toEqual(['trmnl']);
  });

  it('skips sections this device does not show', () => {
    const shown = { ...allShown, globalShortcut: { show: false } };
    expect(searchSettings('shortcut', shown, t)).toEqual([]);
    expect(searchSettings('shortcut', allShown, t).map((r) => r.topicId)).toEqual(['advanced']);
  });

  it('finds the cards inside a page by their own titles', () => {
    expect(searchSettings('weekly review', allShown, t)).toContainEqual(expect.objectContaining({ topicId: 'notifications', match: 'Weekly Review' }));
    expect(searchSettings('encryption', allShown, t).map((r) => r.topicId)).toContain('sync');
  });

  it('a one-letter query matches nothing', () => {
    expect(searchSettings('a', allShown, t)).toEqual([]);
  });
});
