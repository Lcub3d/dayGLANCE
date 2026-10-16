import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Mobile on the shared pages (docs/settings-redesign.md, Mobile): the rows
// are the topics, each opening the page the desktop dialog draws, and what
// only a phone had lives in the shared sections. Read at the source level
// like the other Settings tests (the panel needs most of App's state).
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const panel = read('./MobileSettingsPanel.jsx');

describe('mobile Settings rows', () => {
  it('lists the topics from the shared sections and opens their pages', () => {
    expect(panel).toContain('const sections = useSettingsSections();');
    expect(panel).toContain('listedTopics.map((topic)');
    expect(panel).toMatch(/<SettingsTopicPage key=\{mobileTopic\.id\} topic=\{mobileTopic\} sections=\{sections\}/);
  });

  it('keeps no screen of its own for a topic', () => {
    for (const view of ['app', 'notifications', 'backups', 'ai', 'cloudsync', 'obsidian', 'intent', 'multiUser', 'todoist', 'localIntegrations']) {
      expect(panel, view).not.toContain(`mobileSettingsView === '${view}'`);
    }
    // The tiles' own screens stay.
    for (const view of ['frames', 'habits', 'routines']) expect(panel, view).toContain(`mobileSettingsView === '${view}'`);
  });
});

describe('what only a phone had, in the shared sections', () => {
  it('Live Activity is an iOS card on Notifications', () => {
    const reminders = read('./RemindersSettings.jsx');
    expect(reminders).toMatch(/\{isIOSApp && \(\s*<SettingsCard\s*cardId="liveActivity"/);
  });

  it('a phone sets its location on General, and its view defaults on Appearance', () => {
    expect(read('./settings/topics/useGeneralTopic.jsx')).toMatch(/\{isMobile && \(<>[\s\S]*?id="mobile-settings-location"/);
    expect(read('./settings/topics/useAppearanceTopic.jsx')).toMatch(/mobileViewDefaults: \{\s*show: isMobile,/);
  });

  it('a native app disconnects Obsidian through its bridge, and an Android phone picks the folder in app settings', () => {
    const integrations = read('./settings/topics/useIntegrationsTopic.jsx');
    expect(integrations).toContain('if (isNativeApp()) nativeClearVault?.();\n                        else await disconnectVault();');
    expect(integrations).toContain('{isNativeAndroid() && !isMobile ? (');
    expect(integrations).toContain("if (isNativeAndroid()) { window.DayGlanceNative.openSettings(); return; }");
  });
});
