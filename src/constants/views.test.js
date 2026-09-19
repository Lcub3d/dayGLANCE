import { describe, it, expect } from 'vitest';
import {
  DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES, VIEW_SCOPES, VIEW_SHORTCUT_KEYS, VIEW_LABEL_KEYS,
  EXPERIMENTAL_DESKTOP_VIEWS,
  resolveStoredView, normalizeHiddenViews, enabledViews, homeView, cyclerStates, mobileToggleStates, nextState,
  gateExperimentalViews, offeredViews,
} from './views.js';

// What App puts in context for the desktop switchers: the user's hidden list
// with every experimental view whose flag is off folded in. The raw registry
// has six entries; the everyday app has five on show.
const gated = (hidden = [], flags = {}) => gateExperimentalViews({ desktop: hidden, mobile: [] }, flags).desktop;

describe('view modes', () => {
  it('puts MONTH just before SCHED in every switcher, with only experimental views after it', () => {
    for (const list of [DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES]) {
      expect(list.indexOf('sched') - list.indexOf('month')).toBe(1);
      for (const v of list.slice(list.indexOf('sched') + 1)) expect(EXPERIMENTAL_DESKTOP_VIEWS[v]).toBeDefined();
    }
    expect(DESKTOP_VIEW_MODES).toEqual(['multi', 'day', 'week', 'month', 'sched', 'jobo']);
    expect(NARROW_DESKTOP_VIEW_MODES.at(-1)).toBe('sched');
    expect(MOBILE_VIEW_MODES.at(-1)).toBe('sched');
  });

  it('falls back sanely on a persisted value from another build', () => {
    expect(resolveStoredView('month', DESKTOP_VIEW_MODES, 'multi')).toBe('month');
    expect(resolveStoredView('agenda', DESKTOP_VIEW_MODES, 'multi')).toBe('multi');
    expect(resolveStoredView(null, MOBILE_VIEW_MODES, 'grid')).toBe('grid');
    expect(resolveStoredView(undefined, MOBILE_VIEW_MODES, 'grid')).toBe('grid');
    expect(resolveStoredView('month', MOBILE_VIEW_MODES, 'grid')).toBe('month');
  });

  it('leaves MONTH out of the cyclers while the Day Dial is up', () => {
    expect(cyclerStates(true, false, gated())).toEqual(['multi', 'day', 'week', 'month', 'sched']);
    expect(cyclerStates(false)).toEqual(['multi', 'month', 'sched']);
    expect(cyclerStates(true, true, gated())).toEqual(['multi', 'day', 'week', 'sched']);
    expect(cyclerStates(false, true)).toEqual(['multi', 'sched']);
    expect(mobileToggleStates()).toEqual(['grid', 'list', 'month', 'sched']);
    expect(mobileToggleStates(true)).toEqual(['grid', 'list', 'sched']);
  });

  it('cycles with wrap-around and recovers from an unknown current state', () => {
    const everyday = enabledViews(DESKTOP_VIEW_MODES, gated());
    expect(nextState(everyday, 'week')).toBe('month');
    expect(nextState(everyday, 'month')).toBe('sched');
    expect(nextState(everyday, 'sched')).toBe('multi');
    // With JOBO on, SCHED cycles into it before wrapping.
    expect(nextState(DESKTOP_VIEW_MODES, 'sched')).toBe('jobo');
    expect(nextState(DESKTOP_VIEW_MODES, 'jobo')).toBe('multi');
    expect(nextState(MOBILE_VIEW_MODES, 'sched')).toBe('grid');
    expect(nextState(MOBILE_VIEW_MODES, 'nope')).toBe('grid');
    // A stored MONTH while the dial is up cycles on from MULTI rather than crashing.
    expect(nextState(cyclerStates(true, true, gated()), 'month')).toBe('multi');
  });
});

describe('views turned off per device', () => {
  it('cleans the persisted hidden lists per switcher: known views only, in order, never a whole switcher', () => {
    expect(normalizeHiddenViews({ desktop: ['sched', 'day', 'grid', 'agenda', 'day'], mobile: ['month', 'multi'] })).toEqual({ desktop: ['day', 'sched'], mobile: ['month'] });
    expect(normalizeHiddenViews(null)).toEqual({ desktop: [], mobile: [] });
    expect(normalizeHiddenViews('day')).toEqual({ desktop: [], mobile: [] });
    expect(normalizeHiddenViews({ desktop: [...DESKTOP_VIEW_MODES], mobile: ['list'] })).toEqual({ desktop: [], mobile: ['list'] });
    // The first build stored one flat list: its names apply to both switchers.
    expect(normalizeHiddenViews(['month', 'list', 'day'])).toEqual({ desktop: ['day', 'month'], mobile: ['list', 'month'] });
    expect(Object.keys(VIEW_SCOPES)).toEqual(['desktop', 'mobile']);
  });

  it('drops hidden views from every switcher, the home view included', () => {
    expect(enabledViews(DESKTOP_VIEW_MODES, gated(['day', 'week']))).toEqual(['multi', 'month', 'sched']);
    expect(enabledViews(DESKTOP_VIEW_MODES, gated(['multi']))).toEqual(['day', 'week', 'month', 'sched']);
    expect(enabledViews(MOBILE_VIEW_MODES, ['grid', 'list', 'month'])).toEqual(['sched']);
    expect(cyclerStates(true, false, gated(['multi', 'sched']))).toEqual(['day', 'week', 'month']);
    expect(cyclerStates(false, false, ['month'])).toEqual(['multi', 'sched']);
    expect(cyclerStates(true, true, gated(['day']))).toEqual(['multi', 'week', 'sched']);
    expect(mobileToggleStates(false, ['grid'])).toEqual(['list', 'month', 'sched']);
    expect(mobileToggleStates(true, ['sched'])).toEqual(['grid', 'list']);
  });

  it('lands on the first view still on, and on the first view regardless when a width leaves none', () => {
    expect(homeView(DESKTOP_VIEW_MODES, ['multi'])).toBe('day');
    expect(homeView(MOBILE_VIEW_MODES, ['grid', 'list'])).toBe('month');
    // Only DAY on: a narrow window offers none of MULTI, MONTH and SCHED, so MULTI shows anyway.
    const onlyDay = DESKTOP_VIEW_MODES.filter((v) => v !== 'day');
    expect(homeView(NARROW_DESKTOP_VIEW_MODES, onlyDay)).toBe('multi');
    expect(cyclerStates(false, false, onlyDay)).toEqual(['multi']);
    // Only MONTH on while the Day Dial is up: the switchers fall back the same way.
    expect(cyclerStates(true, true, DESKTOP_VIEW_MODES.filter((v) => v !== 'month'))).toEqual(['multi']);
    expect(mobileToggleStates(true, MOBILE_VIEW_MODES.filter((v) => v !== 'month'))).toEqual(['grid']);
    expect(resolveStoredView('week', enabledViews(DESKTOP_VIEW_MODES, ['week']), homeView(DESKTOP_VIEW_MODES, ['week']))).toBe('multi');
    expect(resolveStoredView('multi', enabledViews(DESKTOP_VIEW_MODES, ['multi']), homeView(DESKTOP_VIEW_MODES, ['multi']))).toBe('day');
  });

  it('cycles within the enabled views, and a single view cycles to itself', () => {
    expect(nextState(cyclerStates(true, false, gated(['day', 'week'])), 'multi')).toBe('month');
    expect(nextState(cyclerStates(true, false, gated(['multi', 'day', 'week', 'month'])), 'sched')).toBe('sched');
  });

  it('keys the desktop views 1 to 6 in switcher order, and labels every one', () => {
    expect(DESKTOP_VIEW_MODES.map((v) => VIEW_SHORTCUT_KEYS[v])).toEqual(['1', '2', '3', '4', '5', '6']);
    for (const v of DESKTOP_VIEW_MODES) expect(VIEW_LABEL_KEYS[v]).toMatch(/^sched\.view/);
  });
});

// JOBO exists behind a flag. Off, it has to be as absent as a view that is not
// in the registry, on every surface that lists views, without any of those
// surfaces knowing the flag exists. The gate expresses "off" as "hidden on this
// device", which they all already honour.
describe('experimental views behind a flag', () => {
  const stored = { desktop: ['month'], mobile: [] };

  it('folds an off view into the hidden list without touching the stored one', () => {
    const gated = gateExperimentalViews(stored, { joboEnabled: false });
    expect(gated.desktop).toEqual(['month', 'jobo']);
    expect(gated.mobile).toBe(stored.mobile);
    expect(stored.desktop).toEqual(['month']); // untouched
  });

  it('returns the list itself when every flag is on, so nothing re-renders for nothing', () => {
    expect(gateExperimentalViews(stored, { joboEnabled: true })).toBe(stored);
  });

  it('does not list a view twice when the user hid it AND the flag is off', () => {
    expect(gateExperimentalViews({ desktop: ['jobo'], mobile: [] }, {}).desktop).toEqual(['jobo']);
  });

  it('keeps the off view out of the cycler, the number keys and the home view', () => {
    const hidden = gateExperimentalViews({ desktop: [], mobile: [] }, {}).desktop;
    expect(cyclerStates(true, false, hidden)).toEqual(['multi', 'day', 'week', 'month', 'sched']);
    expect(resolveStoredView('jobo', enabledViews(DESKTOP_VIEW_MODES, hidden), 'multi')).toBe('multi');
    expect(homeView(DESKTOP_VIEW_MODES, ['multi', 'day', 'week', 'month', 'sched', ...hidden])).toBe('multi');
  });

  it('lets the view through everywhere once the flag is on', () => {
    const hidden = gateExperimentalViews({ desktop: [], mobile: [] }, { joboEnabled: true }).desktop;
    expect(cyclerStates(true, false, hidden)).toContain('jobo');
    expect(nextState(cyclerStates(true, false, hidden), 'sched')).toBe('jobo');
    expect(resolveStoredView('jobo', enabledViews(DESKTOP_VIEW_MODES, hidden), 'multi')).toBe('jobo');
  });

  it('never offers an off view as something to turn on or off per device', () => {
    expect(offeredViews(DESKTOP_VIEW_MODES, {})).toEqual(['multi', 'day', 'week', 'month', 'sched']);
    expect(offeredViews(DESKTOP_VIEW_MODES, { joboEnabled: true })).toEqual(DESKTOP_VIEW_MODES);
    expect(offeredViews(NARROW_DESKTOP_VIEW_MODES, {})).toEqual(NARROW_DESKTOP_VIEW_MODES);
  });

  it('is never offered on a narrow desktop, where DAY and WEEK do not fit either', () => {
    expect(NARROW_DESKTOP_VIEW_MODES).not.toContain('jobo');
    expect(MOBILE_VIEW_MODES).not.toContain('jobo');
  });
});
