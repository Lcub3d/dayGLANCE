import { describe, it, expect } from 'vitest';
import {
  DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES, ALWAYS_ON_VIEWS, HIDEABLE_VIEWS, VIEW_SHORTCUT_KEYS,
  resolveStoredView, normalizeHiddenViews, enabledViews, cyclerStates, mobileToggleStates, nextState,
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
  it('cleans a persisted hidden list: known and hideable only, in canonical order, never a home view', () => {
    expect(normalizeHiddenViews(['sched', 'day', 'multi', 'grid', 'agenda', 'day'])).toEqual(['day', 'sched']);
    expect(normalizeHiddenViews(null)).toEqual([]);
    expect(normalizeHiddenViews('day')).toEqual([]);
    expect(HIDEABLE_VIEWS.some((v) => ALWAYS_ON_VIEWS.includes(v))).toBe(false);
  });

  it('drops hidden views from every switcher but never the home view', () => {
    expect(enabledViews(DESKTOP_VIEW_MODES, ['day', 'week'])).toEqual(['multi', 'month', 'sched']);
    expect(enabledViews(MOBILE_VIEW_MODES, ['list', 'month', 'sched'])).toEqual(['grid']);
    // A hidden list that names the home views (a hand-edited value) changes nothing.
    expect(enabledViews(DESKTOP_VIEW_MODES, ['multi'])).toEqual(DESKTOP_VIEW_MODES);
    expect(cyclerStates(true, false, ['sched'])).toEqual(['multi', 'day', 'week', 'month']);
    expect(cyclerStates(false, false, ['month'])).toEqual(['multi', 'sched']);
    expect(cyclerStates(true, true, ['day'])).toEqual(['multi', 'week', 'sched']);
    expect(mobileToggleStates(false, ['list'])).toEqual(['grid', 'month', 'sched']);
    expect(mobileToggleStates(true, ['sched'])).toEqual(['grid', 'list']);
  });

  it('cycles within the enabled views, and a home view alone still cycles to itself', () => {
    expect(nextState(cyclerStates(true, false, ['day', 'week']), 'multi')).toBe('month');
    expect(nextState(cyclerStates(true, false, ['day', 'week', 'month', 'sched']), 'multi')).toBe('multi');
    // A stored view that is now hidden resolves to the home view.
    expect(resolveStoredView('week', enabledViews(DESKTOP_VIEW_MODES, ['week']), 'multi')).toBe('multi');
    expect(resolveStoredView('sched', enabledViews(MOBILE_VIEW_MODES, ['sched']), 'grid')).toBe('grid');
  });

  it('keys the desktop views 1 to 5 in switcher order', () => {
    expect(DESKTOP_VIEW_MODES.map((v) => VIEW_SHORTCUT_KEYS[v])).toEqual(['1', '2', '3', '4', '5']);
  });
});
