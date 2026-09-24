import { describe, expect, it } from 'vitest';
import { spaceFromDashboardFlag } from './useGoalsProjects.js';

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
