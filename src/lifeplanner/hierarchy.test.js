import { describe, expect, it } from 'vitest';
import {
  HIERARCHY_SOURCE,
  buildHierarchy,
  ensureStepGoal,
  ensureStepProject,
  executeStepLinkMigration,
  planStepLinkMigration,
  provenanceForStep,
  stableGoalId,
  stableProjectId,
} from './hierarchy.js';

const stage = (id = 'step-1', over = {}) => ({ id, value: 40, amount: 1, unit: 'year', ...over });
const vision = (step = stage()) => ({ id: 'vision-1', title: 'Read 100 books', amount: 5, unit: 'year', startDate: '2026-01-01', steps: [step] });
const wish = (step = stage()) => ({ id: 'wish-1', title: 'Keep learning', visions: [vision(step)] });
const base = (over = {}) => ({ wishes: [wish()], goals: [], projects: [], tasks: [], unscheduledTasks: [], recurringTasks: [], ...over });

function memoryStorage({ fail = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw new Error('quota'); data.set(key, value); },
  };
}

describe('Life Planner hierarchy identities and provenance', () => {
  it('keeps compact stable native ids and full three-level provenance', () => {
    const w = wish(), v = w.visions[0], s = v.steps[0];
    expect(stableGoalId({ wishId: w.id, visionId: v.id, stepId: s.id })).toBe('life-goal-step-1');
    expect(stableProjectId(s.id)).toBe('life-step-1');
    expect(stableGoalId({ wishId: 'w', visionId: 'v', stepId: 'x'.repeat(200) }).length).toBeLessThanOrEqual(100);
    expect(provenanceForStep(w, v, s)).toEqual({
      source_app: HIERARCHY_SOURCE,
      lifeplanner: { wishId: 'wish-1', visionId: 'vision-1', stepId: 'step-1' },
    });
  });

  it('does not fabricate a native goal or project for an unlinked stage', () => {
    const result = buildHierarchy(base());
    const goal = result.wishes[0].visions[0].goals[0];
    expect(goal.status).toBe('unlinked');
    expect(goal.nativeGoalId).toBeNull();
    expect(goal.projects).toEqual([]);
    expect(result.orphans.goals).toEqual([]);
    expect(result.orphans.projects).toEqual([]);
  });

  it('connects an explicit step project and keeps task list boundaries', () => {
    const projectId = stableProjectId('step-1');
    const step = stage('step-1', { projectId });
    const result = buildHierarchy({
      ...base({ wishes: [wish(step)] }),
      projects: [{ id: projectId, title: 'Read project', status: 'active' }],
      tasks: [{ id: 't1', title: 'Scheduled', projectId }],
      unscheduledTasks: [{ id: 't2', title: 'Inbox', projectId }],
      recurringTasks: [{ id: 't3', title: 'Recurring', projectId }],
    });
    const project = result.wishes[0].visions[0].goals[0].projects[0];
    expect(project.id).toBe(projectId);
    expect(project.tasks.tasks.map(t => t.id)).toEqual(['t1']);
    expect(project.tasks.unscheduledTasks.map(t => t.id)).toEqual(['t2']);
    expect(project.tasks.recurringTasks.map(t => t.id)).toEqual(['t3']);
    expect(result.orphans.projects).toEqual([]);
    expect(result.orphans.tasks).toEqual([]);
    expect(result.orphans.unscheduledTasks).toEqual([]);
    expect(result.orphans.recurringTasks).toEqual([]);
  });
});

describe('step link migration planning', () => {
  it('repairs an old explicit project link without migrating unrelated stages', () => {
    const linkedProjectId = stableProjectId('step-1');
    const unlinkedWish = wish(stage('step-2'));
    const linkedWish = wish(stage('step-1', { projectId: linkedProjectId }));
    const plan = planStepLinkMigration({
      ...base({ wishes: [linkedWish, unlinkedWish] }),
      projects: [{ id: linkedProjectId, title: 'Existing project', status: 'active' }],
    }, { now: () => '2026-09-21T00:00:00.000Z' });
    expect(plan.operations.map(op => op.type)).toEqual(['create-goal', 'link-step-project', 'link-project-goal']);
    const createGoal = plan.operations.find(op => op.type === 'create-goal');
    expect(createGoal.id).toBe('life-goal-step-1');
    expect(createGoal.fields.title).toBe('Read 40 books');
    expect(createGoal.fields.targetDate).toBe('2027-01-01');
    const linkStep = plan.operations.find(op => op.type === 'link-step-project');
    expect(linkStep).toMatchObject({
      projectId: linkedProjectId,
      goalId: 'life-goal-step-1',
      beforeProjectId: linkedProjectId,
      beforeGoalId: null,
    });
    expect(plan.operations.find(op => op.type === 'link-project-goal').updates.goalId).toBe('life-goal-step-1');
    expect(plan.snapshot.createdAt).toBe('2026-09-21T00:00:00.000Z');
  });

  it('repairs a missing step goalId when a provenanced project already exists', () => {
    const w = wish(), v = w.visions[0], s = stage('step-1');
    const projectId = stableProjectId(s.id);
    const input = {
      wishes: [{ ...w, visions: [{ ...v, steps: [s] }] }],
      goals: [{ id: stableGoalId({ wishId: w.id, visionId: v.id, stepId: s.id }), title: 'Read 40 books', lifeplanner: { wishId: w.id, visionId: v.id, stepId: s.id }, source_app: HIERARCHY_SOURCE }],
      projects: [{ id: projectId, title: 'Read project', lifeplanner: { wishId: w.id, visionId: v.id, stepId: s.id }, source_app: HIERARCHY_SOURCE }],
    };
    const plan = planStepLinkMigration(input);
    expect(plan.operations).toContainEqual(expect.objectContaining({
      type: 'link-step-project', projectId, goalId: stableGoalId({ wishId: w.id, visionId: v.id, stepId: s.id }),
      beforeProjectId: null, beforeGoalId: null,
    }));
  });

  it('preserves a non-Life-Planner goal relationship and records a conflict', () => {
    const projectId = stableProjectId('step-1');
    const input = {
      ...base({ wishes: [wish(stage('step-1', { projectId }))] }),
      projects: [{ id: projectId, title: 'Native project', goalId: 'native-goal', status: 'active' }],
    };
    const projection = buildHierarchy(input);
    const plan = planStepLinkMigration(input);
    expect(projection.conflicts).toContainEqual(expect.objectContaining({
      type: 'project-goal-conflict', projectId: projectId, existingGoalId: 'native-goal',
    }));
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toContainEqual(expect.objectContaining({
      type: 'project-goal-conflict', projectId: projectId, existingGoalId: 'native-goal',
    }));
  });

  it('does not recreate a goal or project blocked by a tombstone', () => {
    const projectId = stableProjectId('step-1');
    const goalId = stableGoalId({ wishId: 'wish-1', visionId: 'vision-1', stepId: 'step-1' });
    const plan = planStepLinkMigration({
      ...base({ wishes: [wish(stage('step-1', { projectId }))] }),
      projects: [{ id: projectId, title: 'Deleted project', status: 'active' }],
      deletedGoalIds: { [goalId]: '2026-09-20T00:00:00.000Z' },
    });
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ type: 'deleted-goal-tombstone', goalId }));
  });
});

describe('idempotent native bridge execution', () => {
  it('writes the first snapshot once and skips already-applied links on retry', async () => {
    const projectId = stableProjectId('step-1');
    const input = {
      ...base({ wishes: [wish(stage('step-1', { projectId }))] }),
      projects: [{ id: projectId, title: 'Existing project', status: 'active' }],
    };
    const plan = planStepLinkMigration(input, { now: () => '2026-09-21T00:00:00.000Z' });
    const storage = memoryStorage();
    const goals = [];
    const projects = input.projects.map(project => ({ ...project }));
    const stepState = { ...input.wishes[0].visions[0].steps[0] };
    let goalAdds = 0;
    let projectUpdates = 0;
    let stepCommits = 0;
    const addGoal = (fields, { id }) => {
      goalAdds += 1;
      const goal = { ...fields, id };
      goals.push(goal);
      return goal;
    };
    const updateProject = (id, updates) => {
      projectUpdates += 1;
      const project = projects.find(item => item.id === id);
      Object.assign(project, updates);
    };
    const commitLifePlanner = operation => {
      stepCommits += 1;
      Object.assign(stepState, { projectId: operation.projectId, goalId: operation.goalId });
    };
    const getStep = () => stepState;
    const first = await executeStepLinkMigration(plan, { goals, projects, addGoal, updateProject, commitLifePlanner, getStep, storage });
    const snapshot = storage.getItem('day-planner-lifeplanner-hierarchy-snapshot-v1');
    const second = await executeStepLinkMigration(plan, { goals, projects, addGoal, updateProject, commitLifePlanner, getStep, storage });
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(goalAdds).toBe(1);
    expect(projectUpdates).toBe(1);
    expect(stepCommits).toBe(1);
    expect(storage.getItem('day-planner-lifeplanner-hierarchy-snapshot-v1')).toBe(snapshot);
  });

  it('does not mutate native state when the recovery snapshot cannot be written', async () => {
    const projectId = stableProjectId('step-1');
    const plan = planStepLinkMigration({
      ...base({ wishes: [wish(stage('step-1', { projectId }))] }),
      projects: [{ id: projectId, title: 'Existing project' }],
    });
    let adds = 0;
    const result = await executeStepLinkMigration(plan, {
      addGoal: () => { adds += 1; },
      storage: memoryStorage({ fail: true }),
    });
    expect(result.status).toBe('error');
    expect(result.reason).toBe('backup');
    expect(adds).toBe(0);
  });

  it('requires explicit opt-in to recreate a tombstoned goal', () => {
    const w = wish(), v = w.visions[0], s = v.steps[0];
    const id = stableGoalId({ wishId: w.id, visionId: v.id, stepId: s.id });
    let created = 0;
    const addGoal = (fields, { id: goalId }) => { created += 1; return { ...fields, id: goalId }; };
    const blocked = ensureStepGoal({ wish: w, vision: v, step: s, deletedGoalIds: { [id]: 'x' }, addGoal });
    const allowed = ensureStepGoal({ wish: w, vision: v, step: s, deletedGoalIds: { [id]: 'x' }, allowDeleted: true, addGoal });
    expect(blocked.status).toBe('conflict');
    expect(allowed.status).toBe('created');
    expect(created).toBe(1);
  });

  it('does not overwrite a foreign goal when ensuring a project', () => {
    const w = wish(), v = w.visions[0], s = v.steps[0];
    const project = { id: stableProjectId(s.id), goalId: 'foreign-goal' };
    const result = ensureStepProject({ wish: w, vision: v, step: { ...s, projectId: project.id }, goal: { id: 'life-goal-step-1' }, projects: [project], updateProject: () => { throw new Error('must not update'); } });
    expect(result.status).toBe('conflict');
    expect(result.conflict.existingGoalId).toBe('foreign-goal');
  });
});
