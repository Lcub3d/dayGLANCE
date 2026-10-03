import { describe, it, expect } from 'vitest';
import { attachMobileTabBack } from './useMobileTabBack.js';
import { createSheetController } from '../utils/sheetDismissal.js';
import { MONTH_DAY_SHEET_HISTORY_KEY } from '../components/month/MonthDaySheet.jsx';

// A window whose history is a stack: pushState adds an entry, back() pops one
// and fires popstate with the entry it lands on, as a browser and the
// Android WebView's goBack() do.
function fakeWindow() {
  const stack = [null];
  const listeners = new Set();
  const win = {
    history: {
      get state() { return stack[stack.length - 1]; },
      pushState: (state) => { stack.push(state); },
      back: () => {
        if (stack.length > 1) stack.pop();
        for (const fn of [...listeners]) fn({ state: win.history.state });
      },
    },
    addEventListener: (type, fn) => { if (type === 'popstate') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'popstate') listeners.delete(fn); },
    depth: () => stack.length,
  };
  return win;
}

// The app as far as the back button is concerned: the active tab, with the
// hook's effect re-run on every change of it, as React does.
function app(win) {
  let tab = 'dayglance';
  let cleanup = null;
  const setTab = (next) => {
    tab = next;
    cleanup?.();
    cleanup = tab === 'dayglance' ? null : attachMobileTabBack({ tab, setTab, win });
  };
  return { go: setTab, tab: () => tab };
}

const openDaySheet = (win) => {
  const sheet = createSheetController({ key: MONTH_DAY_SHEET_HISTORY_KEY, onClose: () => sheet.dispose(), win });
  sheet.open();
  return sheet;
};

describe('the back entry for a tab other than GLANCE', () => {
  it('back from a tab returns to GLANCE', () => {
    const win = fakeWindow();
    const a = app(win);
    a.go('timeline');
    win.history.back();
    expect(a.tab()).toBe('dayglance');
  });

  it('pushes one entry however many tabs are visited', () => {
    const win = fakeWindow();
    const a = app(win);
    a.go('settings');
    a.go('inbox');
    a.go('timeline');
    expect(win.depth()).toBe(2);
    win.history.back();
    expect(a.tab()).toBe('dayglance');
  });

  // MUTATION: read the entry's appTab as where to go and closing the sheet
  // lands on Settings, the tab visited on the way to Timeline.
  it.each([
    ['its close button', (sheet) => sheet.dismiss('close')],
    ['the back button', (_sheet, win) => win.history.back()],
  ])('closing MONTH\'s day sheet with %s stays on Timeline after a detour through another tab', (_how, close) => {
    const win = fakeWindow();
    const a = app(win);
    a.go('settings');
    a.go('timeline');
    const sheet = openDaySheet(win);
    close(sheet, win);
    expect(a.tab()).toBe('timeline');
    // and the next back still leaves the tab, for GLANCE
    win.history.back();
    expect(a.tab()).toBe('dayglance');
  });

  it('closing the sheet without a detour stays on Timeline too', () => {
    const win = fakeWindow();
    const a = app(win);
    a.go('timeline');
    openDaySheet(win).dismiss('close');
    expect(a.tab()).toBe('timeline');
  });
});
