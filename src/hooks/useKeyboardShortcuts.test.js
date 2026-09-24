import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as useLocalStoragePersist.test.js: capture the effect the hook
// hands to useEffect and run it against a stand-in document, then feed the
// registered keydown listener synthetic events.
const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
}));
vi.mock('../components/month/MonthDaySheet.jsx', () => ({ isMonthDaySheetOpen: () => false }));

const { default: useKeyboardShortcuts, isCalendarOnlyShortcut } = await import('./useKeyboardShortcuts.js');

const listeners = [];
const fakeDocument = {
  addEventListener: (type, fn) => { if (type === 'keydown') listeners.push(fn); },
  removeEventListener: () => {},
};

const press = (key, extra = {}) => {
  const e = { key, target: { tagName: 'DIV' }, preventDefault: vi.fn(), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
  listeners.forEach((fn) => fn(e));
  return e;
};

function useMounted(overrides = {}) {
  effects.length = 0;
  listeners.length = 0;
  const props = {
    performUndo: vi.fn(), performRedo: vi.fn(),
    setShowSpotlight: vi.fn(), setSpotlightQuery: vi.fn(), setSpotlightSelectedIndex: vi.fn(), playUISound: vi.fn(),
    setShowShortcutHelp: vi.fn(),
    showAddTask: false, showFocusMode: false, showRoutinesDashboard: false, showShortcutHelp: false, showSpotlight: false,
    showSettings: false, showRemindersSettings: false, showWeeklyReview: false, showVoiceInput: false,
    showHabitModal: false, showFramesModal: false, frameAdjustModal: null, showRescheduleModal: false, showGoalsDashboard: false,
    showDayDial: false, setShowDayDial: vi.fn(),
    showBucketList: false, setShowBucketList: vi.fn(),
    selectedDate: new Date(2026, 8, 22), hoverPreviewTime: null, hoverPreviewDate: null,
    setNewTask: vi.fn(), setShowAddTask: vi.fn(), setHoverPreviewTime: vi.fn(), setHoverPreviewDate: vi.fn(),
    routinesEnabled: true, setRoutinesEnabled: vi.fn(), openRoutinesDashboardRef: { current: vi.fn() },
    focusModeAvailableRef: { current: true }, enterFocusModeRef: { current: vi.fn() },
    setDarkMode: vi.fn(),
    showMonthView: false, goToToday: vi.fn(), setViewedMonth: vi.fn(),
    setShowMonthView: vi.fn(),
    monthViewActive: false, openMonthDaySheetRef: { current: vi.fn() },
    setShowMobileTagFilter: vi.fn(),
    setShowBackupMenu: vi.fn(),
    isMobile: false, tabletActiveTab: 'glance', setTabletActiveTab: vi.fn(),
    aiConfig: null, setShowVoiceInput: vi.fn(),
    habitsEnabled: true, setHabitsEnabled: vi.fn(), setShowHabitModal: vi.fn(),
    goalsProjectsEnabled: true, setGoalsProjectsEnabled: vi.fn(), toggleDesktopSpace: vi.fn(),
    goalsSpaceKeysRef: { current: null },
    gtdFrames: [], setShowRescheduleModal: vi.fn(), setRescheduleResults: vi.fn(), setRescheduleError: vi.fn(),
    setMobileActiveTab: vi.fn(), setMobileSettingsView: vi.fn(), setShowSettings: vi.fn(),
    changeDate: vi.fn(), setSelectedDate: vi.fn(),
    setViewMode: vi.fn(), canShowViewCycler: true, schedOnlyCycler: false, effectiveViewMode: 'multi', hiddenViews: [],
    ...overrides,
  };
  useKeyboardShortcuts(props);
  expect(effects).toHaveLength(1);
  effects[0].fn();
  expect(listeners).toHaveLength(1);
  return props;
}

beforeEach(() => { vi.stubGlobal('document', fakeDocument); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('useKeyboardShortcuts — the g key', () => {
  it('toggles the desktop space from the Calendar space', () => {
    const p = useMounted();
    const e = press('g');
    expect(p.toggleDesktopSpace).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(p.setGoalsProjectsEnabled).not.toHaveBeenCalled();
  });

  it('toggles back while IN the Goals space (D2), which the old modal guard blocked', () => {
    const p = useMounted({ showGoalsDashboard: true });
    press('g');
    expect(p.toggleDesktopSpace).toHaveBeenCalledTimes(1);
  });

  it('still auto-enables the feature on first use', () => {
    const p = useMounted({ goalsProjectsEnabled: false });
    press('g');
    expect(p.setGoalsProjectsEnabled).toHaveBeenCalledWith(true);
    expect(p.toggleDesktopSpace).toHaveBeenCalledTimes(1);
  });

  it('opens the phone Goals tab rather than touching the desktop space', () => {
    const p = useMounted({ isMobile: true });
    press('g');
    expect(p.setMobileActiveTab).toHaveBeenCalledWith('goals');
    expect(p.toggleDesktopSpace).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — inside the Goals space', () => {
  it('lets the app-level shortcuts through: new task, settings, dark mode, help', () => {
    const p = useMounted({ showGoalsDashboard: true });
    press('n');
    expect(p.setShowAddTask).toHaveBeenCalledWith(true);
    press('s');
    expect(p.setShowSettings).toHaveBeenCalledWith(true);
    press('d');
    expect(p.setDarkMode).toHaveBeenCalled();
    press('?');
    expect(p.setShowShortcutHelp).toHaveBeenCalled();
    press('k', { metaKey: true });
    expect(p.setShowSpotlight).toHaveBeenCalled();
  });

  it('stands the calendar-only shortcuts down: dates, views, today, month, side panel', () => {
    const p = useMounted({ showGoalsDashboard: true });
    press('ArrowLeft');
    press('ArrowRight');
    expect(p.changeDate).not.toHaveBeenCalled();
    press('t');
    expect(p.goToToday).not.toHaveBeenCalled();
    press('m');
    expect(p.setShowMonthView).not.toHaveBeenCalled();
    press('2');
    press('c');
    expect(p.setViewMode).not.toHaveBeenCalled();
    press(',');
    press('.');
    expect(p.setTabletActiveTab).not.toHaveBeenCalled();
    press('f');
    expect(p.enterFocusModeRef.current).not.toHaveBeenCalled();
  });

  it('drives the space sidebar with the keys the calendar uses for dates and its panel', () => {
    const keys = { moveSelection: vi.fn(), setTab: vi.fn() };
    const p = useMounted({ showGoalsDashboard: true, goalsSpaceKeysRef: { current: keys } });
    expect(press('ArrowDown').preventDefault).toHaveBeenCalled();
    press('ArrowUp');
    expect(keys.moveSelection.mock.calls).toEqual([[1], [-1]]);
    press(',');
    press('.');
    expect(keys.setTab.mock.calls).toEqual([['goals'], ['projects']]);
    expect(p.changeDate).not.toHaveBeenCalled();
    expect(p.setTabletActiveTab).not.toHaveBeenCalled();
    // with nothing registered (space mounted but inactive) the keys simply stand down
    const q = useMounted({ showGoalsDashboard: true, goalsSpaceKeysRef: { current: null } });
    press('ArrowDown');
    press(',');
    expect(q.changeDate).not.toHaveBeenCalled();
    expect(q.setTabletActiveTab).not.toHaveBeenCalled();
  });

  it('keeps the calendar shortcuts working in the Calendar space', () => {
    const p = useMounted({ showGoalsDashboard: false });
    press('ArrowLeft');
    expect(p.changeDate).toHaveBeenCalledWith(-1);
    press('t');
    expect(p.goToToday).toHaveBeenCalled();
    press('2');
    expect(p.setViewMode).toHaveBeenCalledWith('day');
  });

  it('still blocks everything behind a real modal', () => {
    const p = useMounted({ showGoalsDashboard: true, showSettings: true });
    press('g');
    press('n');
    expect(p.toggleDesktopSpace).not.toHaveBeenCalled();
    expect(p.setShowAddTask).not.toHaveBeenCalled();
  });
});

describe('isCalendarOnlyShortcut', () => {
  const ev = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  it('names the calendar keys and nothing else', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 't', 'm', 'f', '/', ',', '.', 'c', 'C', '1', '2', '3', '4', '5', '6']) {
      expect(isCalendarOnlyShortcut(ev(key)), key).toBe(true);
    }
    for (const key of ['g', 'n', 'i', 's', 'd', 'b', 'v', 'o', 'u', 'h', 'r', 'e', '?', 'Escape']) {
      expect(isCalendarOnlyShortcut(ev(key)), key).toBe(false);
    }
  });
  it('never claims a modifier combo', () => {
    expect(isCalendarOnlyShortcut(ev('ArrowLeft', { metaKey: true }))).toBe(false);
    expect(isCalendarOnlyShortcut(ev('1', { ctrlKey: true }))).toBe(false);
  });
});
