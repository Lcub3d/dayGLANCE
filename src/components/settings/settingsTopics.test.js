import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TOPICS, visibleSectionKeys, visibleTopics, initialTopicId, readRememberedTopic, rememberTopic, SETTINGS_TOPIC_KEY,
} from './settingsTopics.js';

// Step 1 of the Settings redesign (#2075): every block of the dialog moves,
// unchanged, onto exactly one topic page. These pin the mapping against the
// dialog's own section list, so a block can neither be dropped nor shown twice.

const modal = readFileSync(new URL('../SettingsModal.jsx', import.meta.url), 'utf8');
const sectionsBlock = modal.slice(modal.indexOf('  const sections = {'), modal.indexOf('\n  };\n', modal.indexOf('  const sections = {')));
const modalSectionKeys = [...sectionsBlock.matchAll(/^ {4}(\w+): \{\n {6}show:/gm)].map((m) => m[1]);
const en = JSON.parse(readFileSync(new URL('../../../public/locales/en/translation.json', import.meta.url), 'utf8'));

describe('the topic map', () => {
  it('places every block of the dialog on exactly one topic', () => {
    expect(modalSectionKeys.length).toBe(27);
    const placed = TOPICS.flatMap((topic) => topic.sections);
    expect([...placed].sort()).toEqual([...modalSectionKeys].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('labels every topic in the locale bundle', () => {
    const lookup = (path) => path.split('.').reduce((node, part) => node?.[part], en);
    for (const topic of TOPICS) expect(lookup(topic.labelKey), topic.id).toBe(topic.fallback);
  });

  it('puts sync and integrations on their own topics, as agreed', () => {
    const of = (id) => TOPICS.find((topic) => topic.id === id).sections;
    expect(of('sync')).toEqual(['cloudSync']);
    expect(of('integrations')).toContain('calendarSync');
    expect(of('features')).toContain('multiUser');
  });

  it('holds what were the header bell and save icon as their own topics', () => {
    const ids = TOPICS.map((topic) => topic.id);
    expect(ids).toEqual(['general', 'appearance', 'features', 'notifications', 'ai', 'sync', 'integrations', 'backup', 'advanced']);
    expect(TOPICS.find((topic) => topic.id === 'notifications').sections).toEqual(['notifications']);
    expect(TOPICS.find((topic) => topic.id === 'backup').sections).toEqual(['backup']);
  });
});

describe('visibility', () => {
  const sections = {
    localization: { show: true }, sound: { show: true }, weather: { show: false }, dailyContent: { show: false },
    globalShortcut: { show: false }, cloudSync: { show: true },
  };

  it('a page lists only the blocks that render here, in topic order', () => {
    expect(visibleSectionKeys(TOPICS[0], sections)).toEqual(['localization', 'sound']);
  });

  it('a topic with nothing to show is not listed (Advanced off macOS)', () => {
    const ids = visibleTopics(sections).map((topic) => topic.id);
    expect(ids).toEqual(['general', 'sync']);
    expect(ids).not.toContain('advanced');
  });
});

describe('the remembered topic', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('opens on the topic last used, when it is listed here', () => {
    const listed = [{ id: 'general' }, { id: 'sync' }];
    rememberTopic('sync');
    expect(store.get(SETTINGS_TOPIC_KEY)).toBe('sync');
    expect(initialTopicId(readRememberedTopic(), listed)).toBe('sync');
  });

  it('falls back to the first topic when the remembered one is not listed or storage fails', () => {
    expect(initialTopicId('advanced', [{ id: 'general' }])).toBe('general');
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readRememberedTopic()).toBeNull();
    expect(() => rememberTopic('sync')).not.toThrow();
    expect(initialTopicId(null, [])).toBeNull();
  });
});
