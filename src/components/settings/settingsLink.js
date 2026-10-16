// Links into Settings (docs/settings-redesign.md, Deep links): open Settings
// at a topic, scrolled to one of its sections. A red header dot, the MCP
// status modal and the Obsidian error toast use it to land on the setting
// that explains them.
import { useCallback, useState } from 'react';

/** The mobile Settings screen that shows a topic, or the topic list. */
export function mobileViewForTopic(topic) {
  return topic ? `topic:${topic}` : 'main';
}

/**
 * The pending link and the function that sets it. The desktop dialog and the
 * mobile tab each read `settingsLink` once, go to its topic and section, and
 * clear it, so a link opens Settings where it points and later visits open
 * where the user left off.
 */
export function useSettingsLink({ isMobile, setShowSettings, setMobileActiveTab, setMobileSettingsView }) {
  const [settingsLink, setSettingsLink] = useState(null);
  const openSettings = useCallback((topic = null, section = null) => {
    setSettingsLink(topic ? { topic, section } : null);
    if (isMobile) {
      setMobileActiveTab('settings');
      setMobileSettingsView(mobileViewForTopic(topic));
    } else {
      setShowSettings(true);
    }
  }, [isMobile, setShowSettings, setMobileActiveTab, setMobileSettingsView]);
  return { settingsLink, setSettingsLink, openSettings };
}

/**
 * Bring a section into view and mark it for a moment so the eye finds it. A
 * section whose card starts folded is opened, since the setting a link points
 * at is inside it. Returns a cleanup for the mark's timer.
 */
export function revealSettingsSection(key, doc = document) {
  const el = key ? doc.querySelector(`[data-settings-section="${key}"]`) : null;
  if (!el) return () => {};
  // Only the section's own card: its sub-cards stay as they are.
  const card = el.querySelector('[data-settings-card]');
  const toggle = card?.querySelector('[data-settings-card-toggle]');
  if (toggle && toggle.closest('[data-settings-card]') === card && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  el.scrollIntoView?.({ block: 'start' });
  el.setAttribute('data-settings-found', '');
  const timer = setTimeout(() => el.removeAttribute('data-settings-found'), 1600);
  return () => clearTimeout(timer);
}
