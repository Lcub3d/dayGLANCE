import { measureText, milestoneDate } from './model.js';

/**
 * The data-only bridge between Life Planner and the native goals/projects/tasks
 * collections.
 *
 * A Life Planner stage is the semantic goal.  A native goal is its durable
 * companion when one has been created.  This module never invents a native
 * row while reading: buildHierarchy reports an unlinked stage, and
 * planStepLinkMigration describes the explicit, idempotent work required to
 * materialise it.
 */

export const HIERARCHY_VERSION = 1;
export const HIERARCHY_SOURCE = 'app.dayglance.lifeplanner';
export const HIERARCHY_SNAPSHOT_KEY = 'day-planner-lifeplanner-hierarchy-snapshot-v1';

const TASK_KINDS = ['tasks', 'unscheduledTasks', 'recurringTasks'];

const asArray = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function shortHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function boundedStableId(prefix, parts) {
  const raw = `${prefix}-${parts.join('-')}`;
  if (raw.length <= 100) return raw;
  return `${prefix}-${parts.at(-1).slice(0, Math.max(1, 86 - prefix.length))}-${shortHash(parts.join('|'))}`.slice(0, 100);
}

function idPart(value, label) {
  const result = text(value).trim();
  if (!result) throw new Error(`missing-${label}`);
  return result;
}

// Life Planner ids are already bounded to [\\w-] by model.validateDocument.
// The replacement keeps this helper safe for callers constructing a migration
// from a hand-edited document without changing the stable id contract.
function safeIdPart(value, label) {
  return idPart(value, label).replace(/[^A-Za-z0-9_-]/g, '_');
}

export function stableGoalId({ wishId, visionId, stepId } = {}) {
  // step ids are unique across a validated document, so the compact id keeps
  // the native id under its 100-character validation bound. Full ancestry is
  // retained in provenanceForStep rather than encoded into this id.
  return boundedStableId('life-goal', [safeIdPart(stepId, 'step')]);
}

// This is the id used by the existing VisionEditor.  Keeping it unchanged is
// what makes the old step.projectId link and a retried create converge.
export function stableProjectId(stepId) {
  return boundedStableId('life', [safeIdPart(stepId, 'step')]);
}

export function provenanceForStep(wish, vision, step) {
  return {
    source_app: HIERARCHY_SOURCE,
    lifeplanner: {
      wishId: idPart(wish?.id, 'wish'),
      visionId: idPart(vision?.id, 'vision'),
      stepId: idPart(step?.id, 'step'),
    },
  };
}

function tupleFor(wish, vision, step) {
  try {
    return provenanceForStep(wish, vision, step).lifeplanner;
  } catch {
    return null;
  }
}

function provenanceOf(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const nested = entity.lifeplanner || entity.lifePlanner;
  const candidate = nested && typeof nested === 'object'
    ? nested
    : entity.source_app === HIERARCHY_SOURCE
      ? entity
      : null;
  if (!candidate || candidate.wishId == null || candidate.visionId == null || candidate.stepId == null) return null;
  if (candidate.source_app && candidate.source_app !== HIERARCHY_SOURCE) return null;
  if (entity.source_app && entity.source_app !== HIERARCHY_SOURCE && nested == null) return null;
  return {
    wishId: text(candidate.wishId),
    visionId: text(candidate.visionId),
    stepId: text(candidate.stepId),
  };
}

function sameTuple(a, b) {
  return !!a && !!b && sameId(a.wishId, b.wishId) && sameId(a.visionId, b.visionId) && sameId(a.stepId, b.stepId);
}

function relationFor(entity, tuple, expectedId) {
  if (!entity || typeof entity !== 'object') return null;
  if (sameTuple(provenanceOf(entity), tuple)) return { entity, match: 'provenance' };
  if (!sameId(entity.id, expectedId)) return null;
  const source = entity.source_app;
  const nested = entity.lifeplanner || entity.lifePlanner;
  if ((source && source !== HIERARCHY_SOURCE) || (nested && !sameTuple(provenanceOf(entity), tuple))) {
    return { entity, match: 'foreign-id' };
  }
  // The stable namespace is reserved for a previous Life Planner hand-off.
  // It is safe to annotate an unannotated row, but never a row that declares a
  // different source or tuple.
  return { entity, match: 'stable-id' };
}

function normalizeInput(input = {}) {
  const document = input.document || input.lifeplanner || input;
  const pick = (key, fallback = []) => Array.isArray(input[key]) ? input[key] : asArray(document?.[key] ?? fallback);
  return {
    wishes: pick('wishes'),
    goals: pick('goals'),
    projects: pick('projects'),
    tasks: pick('tasks'),
    unscheduledTasks: pick('unscheduledTasks'),
    recurringTasks: pick('recurringTasks'),
    recycleBin: pick('recycleBin'),
    todayRoutines: pick('todayRoutines'),
    areas: pick('areas'),
    deletedGoalIds: input.deletedGoalIds ?? document?.deletedGoalIds ?? {},
    deletedProjectIds: input.deletedProjectIds ?? document?.deletedProjectIds ?? {},
  };
}

function hasTombstone(tombstones, id) {
  if (id == null || tombstones == null) return false;
  if (Array.isArray(tombstones)) return tombstones.some(item => sameId(item, id));
  return Object.prototype.hasOwnProperty.call(tombstones, String(id));
}

function stagesOf(input) {
  const result = [];
  for (const wish of input.wishes) {
    for (const vision of asArray(wish?.visions)) {
      for (const step of asArray(vision?.steps)) {
        const tuple = tupleFor(wish, vision, step);
        if (!tuple) {
          result.push({ wish, vision, step, tuple: null, expectedGoalId: null, expectedProjectId: null });
          continue;
        }
        result.push({
          wish,
          vision,
          step,
          tuple,
          expectedGoalId: stableGoalId(tuple),
          expectedProjectId: stableProjectId(step.id),
        });
      }
    }
  }
  return result;
}

function findGoal(goals, stage) {
  if (!stage.tuple) return { goal: null, match: 'invalid-stage' };
  const byProvenance = goals.find(goal => relationFor(goal, stage.tuple, stage.expectedGoalId)?.match === 'provenance');
  if (byProvenance) return { goal: byProvenance, match: 'provenance' };
  const byId = goals.find(goal => sameId(goal?.id, stage.expectedGoalId));
  if (!byId) return { goal: null, match: 'missing' };
  const relation = relationFor(byId, stage.tuple, stage.expectedGoalId);
  return { goal: byId, match: relation?.match || 'foreign-id' };
}

function findProject(projects, stage) {
  if (!stage.tuple) return { project: null, match: 'invalid-stage' };
  if (stage.step?.projectId != null) {
    const direct = projects.find(project => sameId(project?.id, stage.step.projectId));
    if (direct) return { project: direct, match: 'step-project-id' };
  }
  const byProvenance = projects.find(project => relationFor(project, stage.tuple, stage.expectedProjectId)?.match === 'provenance');
  if (byProvenance) return { project: byProvenance, match: 'provenance' };
  // A stable project id without a step link is not enough evidence to attach a
  // project: this avoids claiming an unrelated manually-created row.
  return { project: null, match: stage.step?.projectId != null ? 'missing' : 'unlinked' };
}

function nativeGoalRef(relation) {
  return relation.goal ? { id: relation.goal.id, title: relation.goal.title ?? null } : null;
}

function taskMap(input) {
  const byProject = new Map();
  const entries = [];
  for (const kind of TASK_KINDS) {
    for (const task of input[kind]) {
      entries.push({ kind, task });
      if (task?.projectId == null) continue;
      const key = text(task.projectId);
      if (!byProject.has(key)) byProject.set(key, { tasks: [], unscheduledTasks: [], recurringTasks: [] });
      byProject.get(key)[kind].push(task);
    }
  }
  return { byProject, entries };
}

function stageProjectNode(stage, goalRelation, projectRelation, taskBuckets, usedProjects, conflicts) {
  const project = projectRelation.project;
  if (!project) return null;
  if (usedProjects.has(String(project.id))) {
    conflicts.push({
      type: 'project-linked-to-multiple-stages',
      projectId: project.id,
      stepId: stage.step.id,
    });
  }
  usedProjects.add(String(project.id));
  const nativeGoalId = goalRelation.goal?.id ?? null;
  if (project.goalId != null && (!nativeGoalId || !sameId(project.goalId, nativeGoalId))) {
    conflicts.push({
      type: 'project-goal-conflict',
      projectId: project.id,
      existingGoalId: project.goalId,
      expectedGoalId: nativeGoalId,
      stepId: stage.step.id,
    });
  }
  const bucket = taskBuckets.byProject.get(String(project.id)) || { tasks: [], unscheduledTasks: [], recurringTasks: [] };
  return {
    id: project.id,
    nativeProjectId: project.id,
    relation: projectRelation.match,
    goalId: project.goalId ?? null,
    nativeGoalId,
    native: clone(project),
    tasks: {
      tasks: clone(bucket.tasks),
      unscheduledTasks: clone(bucket.unscheduledTasks),
      recurringTasks: clone(bucket.recurringTasks),
    },
  };
}

export function buildHierarchy(rawInput = {}) {
  const input = normalizeInput(rawInput);
  const taskBuckets = taskMap(input);
  const usedGoals = new Set();
  const usedProjects = new Set();
  const usedTasks = new Set();
  const conflicts = [];

  const wishes = input.wishes.map(wish => ({
    id: wish.id,
    title: wish.title,
    category: wish.category,
    visions: asArray(wish.visions).map(vision => ({
      id: vision.id,
      title: vision.title,
      startDate: vision.startDate,
      amount: vision.amount,
      unit: vision.unit,
      goals: asArray(vision.steps).map(step => {
        const stage = stagesOf({ ...input, wishes: [wish] }).find(item => item.step === step && item.vision === vision);
        const goalRelation = findGoal(input.goals, stage);
        if (goalRelation.goal && goalRelation.match !== 'foreign-id') usedGoals.add(String(goalRelation.goal.id));
        if (goalRelation.match === 'foreign-id') {
          conflicts.push({ type: 'goal-id-conflict', goalId: goalRelation.goal.id, expectedGoalId: stage.expectedGoalId, stepId: step.id });
        }
        const projectRelation = findProject(input.projects, stage);
        const project = stageProjectNode(stage, goalRelation, projectRelation, taskBuckets, usedProjects, conflicts);
        if (project) {
          for (const kind of TASK_KINDS) {
            for (const task of project.tasks[kind]) usedTasks.add(`${kind}:${String(task.id)}`);
          }
        }
        return {
          id: stage.expectedGoalId || step.id,
          stepId: step.id,
          value: step.value,
          amount: step.amount,
          unit: step.unit,
          nativeGoalId: goalRelation.goal?.id ?? null,
          nativeGoal: nativeGoalRef(goalRelation),
          status: goalRelation.goal && goalRelation.match !== 'foreign-id' ? 'linked' : 'unlinked',
          projects: project ? [project] : [],
        };
      }),
    })),
  }));

  const orphanTask = (kind, task, index) => ({ kind, id: task?.id, task: clone(task), key: `${kind}:${String(task?.id ?? index)}` });
  const orphans = {
    goals: input.goals.filter(goal => !usedGoals.has(String(goal?.id))).map(clone),
    projects: input.projects.filter(project => !usedProjects.has(String(project?.id))).map(clone),
    tasks: [],
    unscheduledTasks: [],
    recurringTasks: [],
    recycleBin: input.recycleBin.map((task, index) => orphanTask('recycleBin', task, index)),
    todayRoutines: input.todayRoutines.map((task, index) => orphanTask('todayRoutines', task, index)),
  };
  for (const entry of taskBuckets.entries) {
    const key = `${entry.kind}:${String(entry.task?.id)}`;
    if (!usedTasks.has(key)) orphans[entry.kind].push(orphanTask(entry.kind, entry.task, orphans[entry.kind].length));
  }
  return { version: HIERARCHY_VERSION, wishes, conflicts, orphans };
}

function defaultGoalFields(stage) {
  const outcome = text(stage.vision?.title || stage.wish?.title || 'Life Planner milestone');
  const title = measureText(outcome, stage.step?.value);
  let targetDate;
  // A validated Life Planner vision always has a date and a matching step.
  // Keep hand-edited/partial documents readable if this helper is called
  // before validation: the migration can still create a correctly identified
  // goal without inventing a date.
  try {
    targetDate = milestoneDate(stage.vision, stage.step?.id);
  } catch {
    targetDate = undefined;
  }
  return {
    title,
    description: `Life Planner: ${text(stage.wish?.title)} → ${text(stage.vision?.title)}`,
    ...(targetDate ? { targetDate } : {}),
  };
}

function goalFieldsFor(stage, rawInput) {
  const custom = typeof rawInput.goalFieldsForStep === 'function'
    ? rawInput.goalFieldsForStep(stage.wish, stage.vision, stage.step)
    : rawInput.goalFields?.[stage.expectedGoalId] || {};
  return { ...defaultGoalFields(stage), ...(custom || {}), ...provenanceForStep(stage.wish, stage.vision, stage.step) };
}

function projectUpdatesFor(stage, project, goalId) {
  const updates = { goalId };
  const safeToAnnotate = sameId(project.id, stage.expectedProjectId)
    || project.source_app === HIERARCHY_SOURCE
    || sameTuple(provenanceOf(project), stage.tuple);
  if (safeToAnnotate) Object.assign(updates, provenanceForStep(stage.wish, stage.vision, stage.step));
  return updates;
}

export function createHierarchySnapshot(rawInput = {}, now = () => new Date().toISOString()) {
  const input = normalizeInput(rawInput);
  return {
    version: HIERARCHY_VERSION,
    createdAt: typeof now === 'function' ? now() : now,
    lifeplanner: {
      wishes: clone(input.wishes),
    },
    native: {
      goals: clone(input.goals),
      projects: clone(input.projects),
    },
  };
}

export function readHierarchySnapshot(storage, key = HIERARCHY_SNAPSHOT_KEY) {
  if (!storage?.getItem) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.version === HIERARCHY_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function planStepLinkMigration(rawInput = {}, { now = () => new Date().toISOString() } = {}) {
  const input = normalizeInput(rawInput);
  const operations = [];
  const conflicts = [];
  const seenProjects = new Set();
  for (const stage of stagesOf(input)) {
    if (!stage.tuple) {
      conflicts.push({ type: 'invalid-stage', stepId: stage.step?.id ?? null });
      continue;
    }
    const projectRelation = findProject(input.projects, stage);
    const project = projectRelation.project;
    if (!project) {
      if (projectRelation.match === 'missing') {
        conflicts.push({
          type: hasTombstone(input.deletedProjectIds, stage.step.projectId) ? 'deleted-project-tombstone' : 'missing-project',
          projectId: stage.step.projectId,
          stepId: stage.step.id,
        });
      }
      // A stage without a native project is deliberately left as a semantic
      // Life Planner node. New native rows are created only by the explicit
      // VisionEditor project action, never by this background migration.
      continue;
    }
    if (hasTombstone(input.deletedProjectIds, project.id)) {
      conflicts.push({ type: 'deleted-project-tombstone', projectId: project.id, stepId: stage.step.id });
      continue;
    }
    if (seenProjects.has(String(project.id))) {
      conflicts.push({ type: 'project-linked-to-multiple-stages', projectId: project.id, stepId: stage.step.id });
      continue;
    }
    seenProjects.add(String(project.id));

    const goalRelation = findGoal(input.goals, stage);
    let goalId = goalRelation.goal?.id ?? stage.expectedGoalId;
    if (project.goalId != null && !sameId(project.goalId, goalId)) {
      // A non-empty native relationship belongs to the native Goals surface.
      // It is never stolen by the Life Planner migration.
      conflicts.push({
        type: 'project-goal-conflict',
        projectId: project.id,
        existingGoalId: project.goalId,
        expectedGoalId: goalRelation.goal?.id ?? stage.expectedGoalId,
        stepId: stage.step.id,
      });
      continue;
    }
    if (goalRelation.match === 'foreign-id') {
      conflicts.push({ type: 'goal-id-conflict', goalId: goalRelation.goal.id, expectedGoalId: stage.expectedGoalId, stepId: stage.step.id });
      continue;
    }
    if (hasTombstone(input.deletedGoalIds, goalId)) {
      conflicts.push({ type: 'deleted-goal-tombstone', goalId, stepId: stage.step.id });
      continue;
    }
    // A non-empty Life Planner goalId is an explicit user relationship.  It
    // must agree with the native goal proven by this stage before the bridge
    // fills the missing project/goal link.  Missing goalId is the repair case
    // handled by the link-step-project operation below.
    if (stage.step.goalId != null && !sameId(stage.step.goalId, goalId)) {
      conflicts.push({
        type: 'step-goal-conflict',
        stepId: stage.step.id,
        existingGoalId: stage.step.goalId,
        expectedGoalId: goalId,
      });
      continue;
    }
    if (!goalRelation.goal) {
      // This path is reached only for an existing, explicitly linked project.
      // It repairs the old step.projectId → project row without creating goals
      // for every otherwise unlinked Life Planner stage.
      operations.push({
        type: 'create-goal',
        id: stage.expectedGoalId,
        key: `goal:${stage.expectedGoalId}`,
        fields: goalFieldsFor(stage, rawInput),
        before: null,
      });
      goalId = stage.expectedGoalId;
    } else if (goalRelation.match === 'stable-id') {
      operations.push({
        type: 'annotate-goal',
        id: goalRelation.goal.id,
        key: `goal:${goalRelation.goal.id}`,
        updates: provenanceForStep(stage.wish, stage.vision, stage.step),
        before: clone(goalRelation.goal),
      });
    }
    if (projectRelation.match === 'provenance'
      ? (!sameId(stage.step.projectId, project.id) || stage.step.goalId == null)
      : stage.step.goalId == null) {
      operations.push({
        type: 'link-step-project',
        key: `step:${stage.step.id}`,
        wishId: stage.wish.id,
        visionId: stage.vision.id,
        stepId: stage.step.id,
        projectId: project.id,
        goalId,
        beforeProjectId: stage.step.projectId ?? null,
        beforeGoalId: stage.step.goalId ?? null,
      });
    }
    if (project.goalId == null) {
      operations.push({
        type: 'link-project-goal',
        key: `project:${project.id}`,
        projectId: project.id,
        goalId,
        updates: projectUpdatesFor(stage, project, goalId),
        beforeGoalId: null,
      });
    }
  }
  return {
    version: HIERARCHY_VERSION,
    createdAt: typeof now === 'function' ? now() : now,
    snapshot: createHierarchySnapshot(input, now),
    operations,
    conflicts,
  };
}

export function ensureStepGoal({ wish, vision, step, goals = [], addGoal, updateGoal, fields = {}, deletedGoalIds = {}, allowDeleted = false } = {}) {
  const tuple = provenanceForStep(wish, vision, step).lifeplanner;
  const expectedId = stableGoalId(tuple);
  if (!allowDeleted && hasTombstone(deletedGoalIds, expectedId)) {
    return { status: 'conflict', id: expectedId, conflict: { type: 'deleted-goal-tombstone', goalId: expectedId, stepId: step.id } };
  }
  const relation = findGoal(asArray(goals), { wish, vision, step, tuple, expectedGoalId: expectedId });
  if (relation.match === 'foreign-id') {
    return { status: 'conflict', goal: relation.goal, conflict: { type: 'goal-id-conflict', goalId: relation.goal.id, expectedGoalId: expectedId, stepId: step.id } };
  }
  if (relation.goal && relation.match === 'provenance') return { status: 'existing', goal: relation.goal, created: false, id: relation.goal.id };
  if (relation.goal && relation.match === 'stable-id') {
    const updates = provenanceForStep(wish, vision, step);
    updateGoal?.(relation.goal.id, updates);
    return { status: updateGoal ? 'annotated' : 'existing', goal: { ...relation.goal, ...updates }, created: false, id: relation.goal.id };
  }
  if (typeof addGoal !== 'function') return { status: 'planned', id: expectedId, fields: { ...fields, ...provenanceForStep(wish, vision, step) } };
  const created = addGoal({ ...defaultGoalFields({ wish, vision, step }), ...fields, ...provenanceForStep(wish, vision, step) }, { id: expectedId });
  return { status: 'created', goal: created, created: true, id: expectedId };
}

export function ensureStepProject({ wish, vision, step, goal = null, projects = [], addProject, updateProject, fields = {}, createIfMissing = true, deletedProjectIds = {}, allowDeleted = false } = {}) {
  const tuple = provenanceForStep(wish, vision, step).lifeplanner;
  const expectedId = step.projectId || stableProjectId(step.id);
  const expectedGoalId = goal?.id ?? fields.goalId ?? null;
  if (!allowDeleted && hasTombstone(deletedProjectIds, expectedId)) {
    return { status: 'conflict', id: expectedId, conflict: { type: 'deleted-project-tombstone', projectId: expectedId, stepId: step.id } };
  }
  const relation = findProject(asArray(projects), { wish, vision, step, tuple, expectedProjectId: stableProjectId(step.id) });
  if (relation.project) {
    const project = relation.project;
    if (project.goalId != null && expectedGoalId != null && !sameId(project.goalId, expectedGoalId)) {
      return { status: 'conflict', project, conflict: { type: 'project-goal-conflict', projectId: project.id, existingGoalId: project.goalId, expectedGoalId, stepId: step.id } };
    }
    const updates = {};
    if (project.goalId == null && expectedGoalId != null) Object.assign(updates, projectUpdatesFor({ wish, vision, step, tuple, expectedProjectId: stableProjectId(step.id) }, project, expectedGoalId));
    if (sameId(project.id, stableProjectId(step.id)) && !provenanceOf(project)) Object.assign(updates, provenanceForStep(wish, vision, step));
    if (Object.keys(updates).length) updateProject?.(project.id, updates);
    return { status: Object.keys(updates).length ? 'updated' : 'existing', project: { ...project, ...updates }, created: false, id: project.id, stepProjectId: project.id };
  }
  if (!createIfMissing || typeof addProject !== 'function') {
    return { status: 'missing', id: expectedId, conflict: step.projectId != null ? { type: 'missing-project', projectId: step.projectId, stepId: step.id } : null };
  }
  const created = addProject({ ...fields, goalId: expectedGoalId ?? undefined, ...provenanceForStep(wish, vision, step) }, { id: expectedId });
  return { status: 'created', project: created, created: true, id: expectedId, stepProjectId: expectedId };
}

export async function executeStepLinkMigration(plan, {
  goals = [],
  projects = [],
  addGoal,
  updateGoal,
  updateProject,
  commitLifePlanner,
  getStep,
  storage,
  snapshotKey = HIERARCHY_SNAPSHOT_KEY,
} = {}) {
  if (!plan || plan.version !== HIERARCHY_VERSION) throw new Error('format');
  // Keep the first baseline until the caller explicitly clears it. A retry or
  // a later render must never overwrite the only recovery point with a
  // partially migrated state. A failed write stops before native mutation.
  if (!storage?.setItem) return { status: 'error', reason: 'backup', error: new Error('backup'), applied: [], skipped: [], pending: [], conflicts: [] };
  let snapshot = readHierarchySnapshot(storage, snapshotKey);
  let snapshotCreated = false;
  if (!snapshot) {
    try {
      storage.setItem(snapshotKey, JSON.stringify(plan.snapshot));
      snapshot = plan.snapshot;
      snapshotCreated = true;
    } catch (error) {
      return { status: 'error', reason: 'backup', error, applied: [], skipped: [], pending: [], conflicts: [] };
    }
  }
  const currentGoals = asArray(goals).map(clone);
  const currentProjects = asArray(projects).map(clone);
  const applied = [];
  const skipped = [];
  const pending = [];
  const conflicts = [...asArray(plan.conflicts)];
  for (const operation of asArray(plan.operations)) {
    if (operation.type === 'create-goal') {
      const existing = currentGoals.find(goal => sameId(goal.id, operation.id));
      if (existing) {
        if (operation.fields && relationFor(existing, operation.fields.lifeplanner, operation.id)?.match === 'foreign-id') {
          conflicts.push({ type: 'goal-id-conflict', goalId: existing.id, expectedGoalId: operation.id });
        } else skipped.push(operation);
        continue;
      }
      if (typeof addGoal !== 'function') { pending.push(operation); continue; }
      const created = addGoal(operation.fields, { id: operation.id });
      currentGoals.push(created || { ...operation.fields, id: operation.id });
      applied.push(operation);
    } else if (operation.type === 'annotate-goal') {
      const existing = currentGoals.find(goal => sameId(goal.id, operation.id));
      if (!existing || typeof updateGoal !== 'function') { pending.push(operation); continue; }
      if (sameTuple(provenanceOf(existing), operation.updates.lifeplanner)) skipped.push(operation);
      else { updateGoal(operation.id, operation.updates); Object.assign(existing, operation.updates); applied.push(operation); }
    } else if (operation.type === 'link-project-goal') {
      const existing = currentProjects.find(project => sameId(project.id, operation.projectId));
      if (!existing) { pending.push(operation); continue; }
      if (existing.goalId != null && !sameId(existing.goalId, operation.goalId)) {
        conflicts.push({ type: 'project-goal-conflict', projectId: existing.id, existingGoalId: existing.goalId, expectedGoalId: operation.goalId });
      } else if (sameId(existing.goalId, operation.goalId)) {
        skipped.push(operation);
      } else if (typeof updateProject !== 'function') {
        pending.push(operation);
      } else {
        updateProject(operation.projectId, operation.updates || { goalId: operation.goalId });
        Object.assign(existing, operation.updates || { goalId: operation.goalId });
        applied.push(operation);
      }
    } else if (operation.type === 'link-step-project') {
      if (typeof commitLifePlanner !== 'function') { pending.push(operation); continue; }
      const currentStep = typeof getStep === 'function' ? getStep(operation) : null;
      const projectMatches = currentStep && sameId(currentStep.projectId, operation.projectId);
      const goalMatches = operation.goalId == null || (currentStep && sameId(currentStep.goalId, operation.goalId));
      if (projectMatches && goalMatches) {
        skipped.push(operation);
        continue;
      }
      await commitLifePlanner(operation);
      applied.push(operation);
    } else {
      pending.push(operation);
    }
  }
  return { status: pending.length || conflicts.length ? 'partial' : 'applied', snapshot, snapshotCreated, applied, skipped, pending, conflicts };
}
