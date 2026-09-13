import { describe, it, expect } from 'vitest';
import {
  DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES,
  resolveStoredView, cyclerStates, mobileToggleStates, nextState,
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
