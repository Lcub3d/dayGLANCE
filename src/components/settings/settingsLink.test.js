import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// useState/useCallback run once per call here, which is all the hook needs.
vi.mock('react', () => ({
  useState: (init) => { let v = init; return [v, (n) => { v = n; state.link = n; }]; },
  useCallback: (fn) => fn,
}));
const state = { link: undefined };
const { mobileViewForTopic, useSettingsLink, revealSettingsSection } = await import('./settingsLink.js');

const useSetup = (isMobile) => {
  const calls = { showSettings: [], tab: [], view: [] };
  const { openSettings } = useSettingsLink({
    isMobile,
    setShowSettings: (v) => calls.showSettings.push(v),
    setMobileActiveTab: (v) => calls.tab.push(v),
    setMobileSettingsView: (v) => calls.view.push(v),
  });
  return { openSettings, calls };
};

describe('openSettings', () => {
  it('opens the desktop dialog with the link set', () => {
    const { openSettings, calls } = useSetup(false);
    openSettings('sync', 'cloudSync');
    expect(state.link).toEqual({ topic: 'sync', section: 'cloudSync' });
    expect(calls.showSettings).toEqual([true]);
    expect(calls.view).toEqual([]);
  });

  it("opens the phone's Settings tab on the topic's page", () => {
    const { openSettings, calls } = useSetup(true);
    openSettings('integrations', 'obsidian');
    expect(calls.tab).toEqual(['settings']);
    expect(calls.view).toEqual(['topic:integrations']);
    expect(calls.showSettings).toEqual([]);
  });

  it('with no topic, opens Settings where it is and sets no link', () => {
    const { openSettings, calls } = useSetup(true);
    openSettings();
    expect(state.link).toBe(null);
    expect(calls.view).toEqual([mobileViewForTopic(null)]);
    expect(mobileViewForTopic(null)).toBe('main');
  });
});

describe('revealSettingsSection', () => {
  afterEach(() => vi.useRealTimers());
  const build = ({ expanded, nested = false }) => {
    const toggle = { click: vi.fn(), getAttribute: () => String(expanded) };
    const card = { querySelector: () => toggle };
    toggle.closest = () => (nested ? {} : card);
    const attrs = new Set();
    const section = {
      querySelector: () => card,
      scrollIntoView: vi.fn(),
      setAttribute: (name) => attrs.add(name),
      removeAttribute: (name) => attrs.delete(name),
    };
    const doc = { querySelector: (sel) => (sel === '[data-settings-section="obsidian"]' ? section : null) };
    return { doc, toggle, section, attrs };
  };

  it("opens the section's folded card, scrolls to it and marks it for a moment", () => {
    vi.useFakeTimers();
    const { doc, toggle, section, attrs } = build({ expanded: false });
    revealSettingsSection('obsidian', doc);
    expect(toggle.click).toHaveBeenCalledTimes(1);
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(attrs.has('data-settings-found')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(attrs.has('data-settings-found')).toBe(false);
  });

  it('leaves an open card, and a sub-card, as they are', () => {
    const open = build({ expanded: true });
    revealSettingsSection('obsidian', open.doc);
    expect(open.toggle.click).not.toHaveBeenCalled();
    const nested = build({ expanded: false, nested: true });
    revealSettingsSection('obsidian', nested.doc);
    expect(nested.toggle.click).not.toHaveBeenCalled();
  });

  it('does nothing for a section that is not on the page', () => {
    const { doc } = build({ expanded: false });
    expect(() => revealSettingsSection('missing', doc)()).not.toThrow();
  });
});

describe('where the links come from', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('a red header dot opens the settings that explain it', () => {
    const header = read('../DesktopHeader.jsx');
    expect(header).toContain("effSyncStatus === 'error' ? openSettings('sync', 'cloudSync') : triggerSync()");
    expect(header).toMatch(/obsidianVaultAccess === 'lost'\s*\? openSettings\('integrations', 'obsidian'\)/);
    expect(header).toContain("openSettings('integrations', 'localIntegrations')");
    expect(header).toContain("openSettings('integrations', 'calendarSync')");
  });

  it('the Obsidian error toast links to its settings', () => {
    expect(read('../ObsidianSyncToast.jsx')).toContain("openSettings('integrations', 'obsidian')");
  });

  it('the dialog and the phone both read the link and clear it', () => {
    expect(read('../SettingsModal.jsx')).toMatch(/if \(!settingsLink\) return;\s*setSettingsLink\(null\);/);
    expect(read('../MobileSettingsPanel.jsx')).toContain('setSettingsLink(null);');
  });
});
