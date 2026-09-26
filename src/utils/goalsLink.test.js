import { describe, it, expect } from 'vitest';
import { resolveGoalsLink, projectFocusTarget, areaFilterHides } from './goalsLink.js';

const q = (s) => new URL(`dayglance://x?${s}`).searchParams;

describe('resolveGoalsLink', () => {
  it('a goal link opens the space on a tablet/desktop and the Goals tab on a phone', () => {
    expect(resolveGoalsLink('goal', q('id=g1'), { enabled: true, phone: false }))
      .toEqual({ mobileTab: null, space: 'goals', focusGoalId: 'g1', focusProjectId: null });
    expect(resolveGoalsLink('goal', q('id=g1'), { enabled: true, phone: true }))
      .toEqual({ mobileTab: 'goals', space: null, focusGoalId: 'g1', focusProjectId: null });
  });

  it('a project link focuses the project, not a goal', () => {
    expect(resolveGoalsLink('project', q('id=p%201'), { enabled: true, phone: true }))
      .toEqual({ mobileTab: 'goals', space: null, focusGoalId: null, focusProjectId: 'p 1' });
  });

  it('does nothing while Goals & Projects is off, or for another action', () => {
    expect(resolveGoalsLink('goal', q('id=g1'), { enabled: false, phone: true })).toBeNull();
    expect(resolveGoalsLink('day', q('id=g1'), { enabled: true, phone: true })).toBeNull();
  });

  it('with no id it still opens the space, unfocused', () => {
    expect(resolveGoalsLink('project', q(''), { enabled: true, phone: false }))
      .toEqual({ mobileTab: null, space: 'goals', focusGoalId: null, focusProjectId: null });
  });
});

describe('projectFocusTarget', () => {
  const goals = [{ id: 'g1' }];
  const projects = [
    { id: 'p-goal', goalId: 'g1' },
    { id: 'p-alone' },
    { id: 'p-orphan', goalId: 'g-archived' },
  ];
  it('a goal\'s project goes to its goal; a standalone one to the standalone list', () => {
    expect(projectFocusTarget('p-goal', { projects, goals })).toEqual({ project: projects[0], goalId: 'g1' });
    expect(projectFocusTarget('p-alone', { projects, goals })).toEqual({ project: projects[1], goalId: null });
  });
  it('a project with no card to go to (goal not shown, gone, no id) is null', () => {
    expect(projectFocusTarget('p-orphan', { projects, goals })).toBeNull();
    expect(projectFocusTarget('p-deleted', { projects, goals })).toBeNull();
    expect(projectFocusTarget(null, { projects, goals })).toBeNull();
  });
});

describe('areaFilterHides', () => {
  const areas = [{ id: 'a1' }];
  it('follows the dashboard filter', () => {
    expect(areaFilterHides({ areaId: 'a1' }, 'all', areas)).toBe(false);
    expect(areaFilterHides({ areaId: 'a1' }, 'a1', areas)).toBe(false);
    expect(areaFilterHides({ areaId: 'a2' }, 'a1', areas)).toBe(true);
    expect(areaFilterHides({}, 'uncategorized', areas)).toBe(false);
    expect(areaFilterHides({ areaId: 'deleted-area' }, 'uncategorized', areas)).toBe(false);
    expect(areaFilterHides({ areaId: 'a1' }, 'uncategorized', areas)).toBe(true);
    expect(areaFilterHides(null, 'a1', areas)).toBe(false);
  });
});
