import { describe, expect, it } from 'vitest';
import { isPlanningGuideBlocked, isPlanningGuideDOMBusy } from './planningGuideGuard.js';

const ready = { dataLoaded: true, initialWelcomeChecked: true };
describe('optional guide yields to native application surfaces', () => {
  it('waits for a reactive native welcome decision, not only loaded data', () => {
    expect(isPlanningGuideBlocked()).toBe(true);
    expect(isPlanningGuideBlocked({ dataLoaded: true })).toBe(true);
    expect(isPlanningGuideBlocked(ready)).toBe(false);
  });
  it.each(['showWelcome', 'showSettings', 'showAddTask', 'mobileEditingTask',
    'mobileEditingNativeEvent', 'editingTaskId', 'dailyNotesModalDate', 'showDayDial',
    'showMonthView', 'showSpotlight', 'showHelpModal', 'taskContextMenu', 'draggedTask'])
  ('defers for the core surface %s', key => {
    expect(isPlanningGuideBlocked({ ...ready, [key]: true })).toBe(true);
  });
  it.each(['showLifePlanner', 'showGoalsDashboard', 'showWeeklyReview', 'showVoiceInput',
    'showFocusMode', 'showHabitModal', 'showFramesModal', 'showRescheduleModal'])
  ('defers for feature surface %s', key => {
    expect(isPlanningGuideBlocked(ready, { [key]: true })).toBe(true);
  });
  it.each(['showBackupMenu', 'showRestoreConfirm', 'syncNotification', 'cloudSyncConflict'])
  ('defers for sync surface %s', key => {
    expect(isPlanningGuideBlocked(ready, {}, { [key]: true })).toBe(true);
  });
  it('blocks mobile settings and phone landscape, not a landscape tablet', () => {
    expect(isPlanningGuideBlocked({ ...ready, isMobile: true, mobileActiveTab: 'settings' })).toBe(true);
    expect(isPlanningGuideBlocked({ ...ready, isPhone: true, isLandscape: true })).toBe(true);
    expect(isPlanningGuideBlocked({ ...ready, isTablet: true, isLandscape: true })).toBe(false);
  });
  it('allows explicit manual access after the modal tour even with inline onboarding', () => {
    expect(isPlanningGuideBlocked({ ...ready, showOnboarding: true })).toBe(false);
  });
});

describe('last-moment automatic guide DOM guard', () => {
  const doc = (activeElement = null, elements = []) => ({
    visibilityState: 'visible', activeElement, querySelectorAll: () => elements,
  });
  it('does not show in a hidden tab', () => {
    expect(isPlanningGuideDOMBusy({ ...doc(), visibilityState: 'hidden' })).toBe(true);
    expect(isPlanningGuideDOMBusy(doc())).toBe(false);
  });
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('does not interrupt a focused %s', tagName => {
    expect(isPlanningGuideDOMBusy(doc({ tagName }))).toBe(true);
  });
  it('recognizes rich text editing but not an ordinary button', () => {
    expect(isPlanningGuideDOMBusy(doc({ isContentEditable: true }))).toBe(true);
    expect(isPlanningGuideDOMBusy(doc({ tagName: 'BUTTON' }))).toBe(false);
  });
  it('defers for visible nested dialogs and ignores hidden/own dialog elements', () => {
    const element = (own, visible) => ({ closest: () => own, getClientRects: () => visible ? [{}] : [] });
    expect(isPlanningGuideDOMBusy(doc(null, [element(false, true)]))).toBe(true);
    expect(isPlanningGuideDOMBusy(doc(null, [element(false, false)]))).toBe(false);
    expect(isPlanningGuideDOMBusy(doc(null, [element(true, true)]))).toBe(false);
  });
});
