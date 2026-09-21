import { describe, expect, it, vi } from 'vitest';

// This bridge hook only composes pure functions and callbacks.  Keeping the
// React hooks synchronous here makes the guard contract testable without
// pulling a DOM renderer into the project.
vi.mock('react', () => ({
  useMemo: factory => factory(),
  useCallback: factory => factory,
}));

import useLifePlannerHierarchy from './useLifePlannerHierarchy.js';
import { stableProjectId } from '../lifeplanner/hierarchy.js';

function storage() {
  const data = new Map();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

function fixture() {
  const step = { id: 'step-1', value: 0.4, amount: 1, unit: 'year', projectId: stableProjectId('step-1') };
  const vision = { id: 'vision-1', title: 'Publish 2 books', startDate: '2026-01-01', amount: 5, unit: 'year', steps: [step] };
  const wish = { id: 'wish-1', title: 'Create', visions: [vision] };
  return {
    document: { wishes: [wish] },
    wishes: [wish],
    step,
    vision,
    wish,
    projects: [{ id: step.projectId, title: 'Existing project' }],
  };
}

describe('useLifePlannerHierarchy guards and explicit execution', () => {
  it.each([
    ['not-loaded', { dataLoaded: false }],
    ['multi-user', { dataLoaded: true, multiUserEnabled: true }],
    ['read-only', { dataLoaded: true, readOnly: true }],
  ])('blocks native writes when the bridge is %s', async (reason, flags) => {
    const f = fixture();
    const addGoal = vi.fn();
    const store = storage();
    const bridge = useLifePlannerHierarchy({ ...f, ...flags, addGoal, storage: store });
    expect(bridge.guardReason).toBe(reason);
    expect(bridge.ensureStepGoal({ wish: f.wish, vision: f.vision, step: f.step }).status).toBe('skipped');
    const result = await bridge.executeMigration();
    expect(result).toMatchObject({ status: 'skipped', reason });
    expect(addGoal).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });

  it('executes only after data is loaded and writes the recovery snapshot first', async () => {
    const f = fixture();
    const store = storage();
    const goals = [];
    const projects = f.projects.map(project => ({ ...project }));
    const addGoal = vi.fn((fields, { id }) => {
      const goal = { ...fields, id };
      goals.push(goal);
      return goal;
    });
    const updateProject = vi.fn((id, updates) => Object.assign(projects.find(project => project.id === id), updates));
    const commitLifePlanner = vi.fn(operation => Object.assign(f.step, {
      projectId: operation.projectId,
      goalId: operation.goalId,
    }));
    const bridge = useLifePlannerHierarchy({
      ...f,
      goals,
      projects,
      dataLoaded: true,
      addGoal,
      updateProject,
      commitLifePlanner,
      storage: store,
    });
    const result = await bridge.executeMigration();
    expect(result.status).toBe('applied');
    expect(store.data.has('day-planner-lifeplanner-hierarchy-snapshot-v1')).toBe(true);
    expect(addGoal).toHaveBeenCalledOnce();
    expect(updateProject).toHaveBeenCalledOnce();
    expect(commitLifePlanner).toHaveBeenCalledOnce();
    expect(f.step.goalId).toBe('life-goal-step-1');

    // A projectId by itself is not enough: a retry after a partial Life
    // Planner write must repair the missing goalId instead of being skipped.
    f.step.goalId = null;
    await bridge.executeMigration();
    expect(commitLifePlanner).toHaveBeenCalledTimes(2);
    expect(f.step.goalId).toBe('life-goal-step-1');
  });
});
