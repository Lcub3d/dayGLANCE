import { describe, it, expect } from 'vitest';
import {
  DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES, VIEW_SCOPES, VIEW_SHORTCUT_KEYS,
  resolveStoredView, normalizeHiddenViews, enabledViews, homeView, cyclerStates, mobileToggleStates, nextState,
} from './views.js';

describe('view modes', () => {
  it('puts MONTH just before SCHED in every switcher', () => {
    for (const list of [DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES]) {
      expect(list.indexOf('sched') - list.indexOf('month')).toBe(1);
      expect(list.at(-1)).toBe('sched');
    }
    expect(DESKTOP_VIEW_MODES).toEqual(['multi', 'day', 'week', 'month', 'sched']);
  });

  it('falls back sanely on a persisted value from another build', () => {
    expect(resolveStoredView('month', DESKTOP_VIEW_MODES, 'multi')).toBe('month');
    expect(resolveStoredView('agenda', DESKTOP_VIEW_MODES, 'multi')).toBe('multi');
    expect(resolveStoredView(null, MOBILE_VIEW_MODES, 'grid')).toBe('grid');
    expect(resolveStoredView(undefined, MOBILE_VIEW_MODES, 'grid')).toBe('grid');
    expect(resolveStoredView('month', MOBILE_VIEW_MODES, 'grid')).toBe('month');
  });

  it('leaves MONTH out of the cyclers while the Day Dial is up', () => {
    expect(cyclerStates(true)).toEqual(['multi', 'day', 'week', 'month', 'sched']);
    expect(cyclerStates(false)).toEqual(['multi', 'month', 'sched']);
    expect(cyclerStates(true, true)).toEqual(['multi', 'day', 'week', 'sched']);
    expect(cyclerStates(false, true)).toEqual(['multi', 'sched']);
    expect(mobileToggleStates()).toEqual(['grid', 'list', 'month', 'sched']);
    expect(mobileToggleStates(true)).toEqual(['grid', 'list', 'sched']);
  });

  it('cycles with wrap-around and recovers from an unknown current state', () => {
    expect(nextState(DESKTOP_VIEW_MODES, 'week')).toBe('month');
    expect(nextState(DESKTOP_VIEW_MODES, 'month')).toBe('sched');
    expect(nextState(DESKTOP_VIEW_MODES, 'sched')).toBe('multi');
    expect(nextState(MOBILE_VIEW_MODES, 'sched')).toBe('grid');
    expect(nextState(MOBILE_VIEW_MODES, 'nope')).toBe('grid');
    // A stored MONTH while the dial is up cycles on from MULTI rather than crashing.
    expect(nextState(cyclerStates(true, true), 'month')).toBe('multi');
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
    expect(enabledViews(DESKTOP_VIEW_MODES, ['day', 'week'])).toEqual(['multi', 'month', 'sched']);
    expect(enabledViews(DESKTOP_VIEW_MODES, ['multi'])).toEqual(['day', 'week', 'month', 'sched']);
    expect(enabledViews(MOBILE_VIEW_MODES, ['grid', 'list', 'month'])).toEqual(['sched']);
    expect(cyclerStates(true, false, ['multi', 'sched'])).toEqual(['day', 'week', 'month']);
    expect(cyclerStates(false, false, ['month'])).toEqual(['multi', 'sched']);
    expect(cyclerStates(true, true, ['day'])).toEqual(['multi', 'week', 'sched']);
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
    expect(nextState(cyclerStates(true, false, ['day', 'week']), 'multi')).toBe('month');
    expect(nextState(cyclerStates(true, false, ['multi', 'day', 'week', 'month']), 'sched')).toBe('sched');
  });

  it('keys the desktop views 1 to 5 in switcher order', () => {
    expect(DESKTOP_VIEW_MODES.map((v) => VIEW_SHORTCUT_KEYS[v])).toEqual(['1', '2', '3', '4', '5']);
  });
});
