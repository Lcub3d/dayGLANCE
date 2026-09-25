import { describe, it, expect } from 'vitest';
import { resolveDayLink, consumeMonthSheetRequest } from './dayLink.js';

const link = (query) => new URL(`dayglance://day?${query}`).searchParams;
const env = (over = {}) => ({
  phoneLayout: true,
  hiddenViews: { desktop: [], mobile: [] },
  defaultView: 'multi',
  mobileDefaultView: 'list',
  ...over,
});

describe('resolveDayLink', () => {
  describe('view=month (the month grid widget)', () => {
    it('phone layout: MONTH on the phone toggle, the sheet for the day', () => {
      expect(resolveDayLink(link('date=2026-10-01&view=month'), env())).toEqual({
        date: '2026-10-01', dial: false, desktopView: null, mobileView: 'month', mobileTab: null, monthSheet: '2026-10-01',
      });
    });

    it('wide layout: MONTH on the desktop cycler, the panel follows the day', () => {
      expect(resolveDayLink(link('date=2026-10-01&view=month'), env({ phoneLayout: false }))).toEqual({
        date: '2026-10-01', dial: false, desktopView: 'month', mobileView: null, mobileTab: null, monthSheet: '2026-10-01',
      });
    });

    it('MONTH off on the phone toggle: the phone default, scoped to the date, no sheet', () => {
      const r = resolveDayLink(link('date=2026-10-01&view=month'), env({ hiddenViews: { desktop: [], mobile: ['month'] } }));
      expect(r).toEqual({ date: '2026-10-01', dial: false, desktopView: null, mobileView: 'list', mobileTab: null, monthSheet: null });
    });

    it('MONTH off on the desktop cycler: the desktop default, scoped to the date', () => {
      const r = resolveDayLink(link('date=2026-10-01&view=month'),
        env({ phoneLayout: false, defaultView: 'sched', hiddenViews: { desktop: ['month'], mobile: [] } }));
      expect(r).toEqual({ date: '2026-10-01', dial: false, desktopView: 'sched', mobileView: null, mobileTab: null, monthSheet: null });
    });

    it('only the live switcher\'s setting counts', () => {
      // Off on desktop, on for the phone toggle, and the phone toggle is live.
      const r = resolveDayLink(link('date=2026-10-01&view=month'), env({ hiddenViews: { desktop: ['month'], mobile: [] } }));
      expect(r.mobileView).toBe('month');
      expect(r.monthSheet).toBe('2026-10-01');
    });

    it('a malformed date opens MONTH without selecting or opening anything', () => {
      const r = resolveDayLink(link('date=2026-1-1&view=month'), env());
      expect(r).toEqual({ date: null, dial: false, desktopView: null, mobileView: 'month', mobileTab: null, monthSheet: null });
    });
  });

  describe('on a phone, the timeline tab (MonthView is unmounted on the others)', () => {
    const phone = (over = {}) => env({ phone: true, ...over });

    it('a month link brings the timeline tab forward with MONTH, the day and its sheet', () => {
      expect(resolveDayLink(link('date=2026-10-14&view=month'), phone())).toEqual({
        date: '2026-10-14', dial: false, desktopView: null, mobileView: 'month', mobileTab: 'timeline', monthSheet: '2026-10-14',
      });
    });

    it('the MONTH-off fallback needs the tab too: the default view lives there as well', () => {
      const r = resolveDayLink(link('date=2026-10-14&view=month'), phone({ hiddenViews: { desktop: [], mobile: ['month'] } }));
      expect(r).toMatchObject({ mobileView: 'list', mobileTab: 'timeline', monthSheet: null });
    });

    it('a tablet in portrait uses the phone toggle but has no tab to switch', () => {
      expect(resolveDayLink(link('date=2026-10-14&view=month'), env({ phone: false })).mobileTab).toBeNull();
    });

    it('dial and no-view links are unchanged: no tab switch', () => {
      expect(resolveDayLink(link('date=2026-10-14&view=dial'), phone()).mobileTab).toBeNull();
      expect(resolveDayLink(link('date=2026-10-14'), phone()).mobileTab).toBeNull();
    });
  });

  it('view=dial is unchanged: the day, and the dial over it', () => {
    expect(resolveDayLink(link('date=2026-10-01&view=dial'), env())).toEqual({
      date: '2026-10-01', dial: true, desktopView: null, mobileView: null, mobileTab: null, monthSheet: null,
    });
  });

  it('no view is unchanged: the day view', () => {
    expect(resolveDayLink(link('date=2026-10-01'), env())).toEqual({
      date: '2026-10-01', dial: false, desktopView: 'day', mobileView: null, mobileTab: null, monthSheet: null,
    });
    expect(resolveDayLink(link('date=2026-10-01'), env({ phoneLayout: false })).desktopView).toBe('day');
  });

  it('an unknown view falls back to the day view', () => {
    expect(resolveDayLink(link('date=2026-10-01&view=bogus'), env()).desktopView).toBe('day');
  });
});

describe('consumeMonthSheetRequest', () => {
  it('opens the sheet for the requested day once it is selected', () => {
    expect(consumeMonthSheetRequest('2026-10-01', { selectedStr: '2026-10-01', docked: false }))
      .toEqual({ open: '2026-10-01', clear: true });
  });

  it('docked: no sheet — the panel follows the selection — but the request is used up', () => {
    expect(consumeMonthSheetRequest('2026-10-01', { selectedStr: '2026-10-01', docked: true }))
      .toEqual({ open: null, clear: true });
  });

  it('a request for a day that is not selected is dropped rather than left to fire later', () => {
    expect(consumeMonthSheetRequest('2026-10-01', { selectedStr: '2026-10-02', docked: false }))
      .toEqual({ open: null, clear: true });
  });

  it('no request, nothing to do', () => {
    expect(consumeMonthSheetRequest(null, { selectedStr: '2026-10-01', docked: false }))
      .toEqual({ open: null, clear: false });
  });
});
