import { describe, expect, it } from 'vitest';
import { resolveDesktopSpace, spaceFromDashboardFlag } from './useGoalsProjects.js';

// The callers that "open the Goals dashboard" (goal rings, the GLANCE pill,
// future hyperGLANCE sessions, the notes portal guard) keep calling
// setShowGoalsDashboard; every one of them now means the Goals SPACE.
describe('spaceFromDashboardFlag', () => {
  it('opens the Goals space for true and returns to the Calendar space for false', () => {
    expect(spaceFromDashboardFlag('calendar', true)).toBe('goals');
    expect(spaceFromDashboardFlag('goals', true)).toBe('goals');
    expect(spaceFromDashboardFlag('goals', false)).toBe('calendar');
    expect(spaceFromDashboardFlag('calendar', false)).toBe('calendar');
  });

  it('feeds an updater the boolean the old state held, so prev => !prev toggles', () => {
    expect(spaceFromDashboardFlag('calendar', (prev) => !prev)).toBe('goals');
    expect(spaceFromDashboardFlag('goals', (prev) => !prev)).toBe('calendar');
  });
});

// The Settings switch gates the space: off means the Goals space cannot be
// entered by any caller (switcher, `g`, goal rings, the GLANCE pill…).
describe('resolveDesktopSpace', () => {
  it('enters and leaves the Goals space while the feature is on', () => {
    expect(resolveDesktopSpace('calendar', 'goals', true)).toBe('goals');
    expect(resolveDesktopSpace('goals', 'calendar', true)).toBe('calendar');
    expect(resolveDesktopSpace('calendar', (prev) => (prev === 'goals' ? 'calendar' : 'goals'), true)).toBe('goals');
  });

  it('refuses the Goals space while the feature is off, for values and updaters alike', () => {
    expect(resolveDesktopSpace('calendar', 'goals', false)).toBe('calendar');
    expect(resolveDesktopSpace('calendar', (prev) => (prev === 'goals' ? 'calendar' : 'goals'), false)).toBe('calendar');
    expect(resolveDesktopSpace('calendar', 'calendar', false)).toBe('calendar');
  });

  it('never yields anything but the two spaces', () => {
    expect(resolveDesktopSpace('calendar', undefined, true)).toBe('calendar');
    expect(resolveDesktopSpace('goals', 'nonsense', true)).toBe('calendar');
  });
});
