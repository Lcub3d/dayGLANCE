import { useEffect } from 'react';

// The phone's back button (and the browser's) on a tab other than GLANCE.
// Leaving GLANCE pushes one history entry, marked `appTab`; back pops it and
// returns to GLANCE. Things opened inside a tab push their own entry on top,
// copying the state below (MONTH's day sheet, see utils/sheetDismissal.js),
// so popping one of those lands back on the `appTab` entry.
//
// Landing on that entry therefore means "something inside this tab closed":
// the tab stays, whichever tab the entry names. It names the tab GLANCE was
// left for, and moving between other tabs does not push again, so it is
// often stale. Reading it as a destination sent a closed MONTH day sheet to
// Settings or the Inbox, whichever had been visited on the way to Timeline.

/**
 * Wires the back entry for the current tab. Pure apart from `win`, so it can
 * be tested without React or a browser. Returns the cleanup.
 *
 * @param {object} deps
 * @param {string} deps.tab           the active tab
 * @param {(tab: string) => void} deps.setTab
 * @param {object} deps.win           window-like: { history, addEventListener, removeEventListener }
 */
export function attachMobileTabBack({ tab, setTab, win }) {
  // Only push if there isn't already an app-tab history entry.
  if (!win.history.state?.appTab) {
    win.history.pushState({ appTab: tab }, '');
  }
  const onPopState = (e) => {
    if (e.state?.appTab) return;
    setTab('dayglance');
  };
  win.addEventListener('popstate', onPopState);
  return () => win.removeEventListener('popstate', onPopState);
}

export default function useMobileTabBack({ isMobile, mobileActiveTab, mobileSettingsView, setMobileActiveTab }) {
  useEffect(() => {
    if (!isMobile) return undefined;
    if (mobileActiveTab === 'dayglance') return undefined;
    // Don't interfere with settings sub-view back navigation
    if (mobileActiveTab === 'settings' && mobileSettingsView !== 'main') return undefined;
    return attachMobileTabBack({ tab: mobileActiveTab, setTab: setMobileActiveTab, win: window });
  }, [mobileActiveTab, mobileSettingsView, isMobile, setMobileActiveTab]);
}
