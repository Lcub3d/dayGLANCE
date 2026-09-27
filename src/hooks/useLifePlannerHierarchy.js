import { useCallback, useMemo } from 'react';
import {
  HIERARCHY_SNAPSHOT_KEY,
  buildHierarchy,
  ensureStepGoal as ensureStepGoalNative,
  ensureStepProject as ensureStepProjectNative,
  executeStepLinkMigration,
  planStepLinkMigration,
  readHierarchySnapshot,
} from '../lifeplanner/hierarchy.js';

const browserStorage = () => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; }
  catch { return null; }
};

const skipped = reason => ({ status: 'skipped', reason, applied: [], pending: [], conflicts: [] });

function readTombstones(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function stepReader(document) {
  const wishes = Array.isArray(document?.wishes) ? document.wishes : [];
  return operation => {
    const wish = wishes.find(item => String(item.id) === String(operation.wishId));
    const vision = wish?.visions?.find(item => String(item.id) === String(operation.visionId));
    return vision?.steps?.find(item => String(item.id) === String(operation.stepId)) || null;
  };
}

/**
 * Read-only hierarchy projection plus explicitly-invoked native bridge.
 *
 * No mutation runs during render. Callers should pass `dataLoaded` and their
 * effective read-only/multi-user guard; execution is rejected until the data
 * is loaded and both guards are clear. `commitLifePlanner(operation)` is the
 * caller-owned store commit for a `link-step-project` operation and must be
 * idempotent on the operation's wishId/visionId/stepId tuple.
 */
export default function useLifePlannerHierarchy({
  document = null,
  wishes,
  goals = [],
  projects = [],
  tasks = [],
  unscheduledTasks = [],
  recurringTasks = [],
  recycleBin = [],
  todayRoutines = [],
  deletedGoalIds,
  deletedProjectIds,
  dataLoaded = false,
  multiUserEnabled = false,
  readOnly = false,
  addGoal,
  updateGoal,
  addProject,
  updateProject,
  commitLifePlanner,
  storage,
} = {}) {
  const lifeplannerWishes = useMemo(() => wishes ?? document?.wishes ?? [], [wishes, document]);
  const effectiveStorage = storage ?? browserStorage();
  const effectiveDeletedGoalIds = useMemo(
    () => deletedGoalIds ?? readTombstones(effectiveStorage, 'day-planner-deleted-goal-ids'),
    [deletedGoalIds, effectiveStorage],
  );
  const effectiveDeletedProjectIds = useMemo(
    () => deletedProjectIds ?? readTombstones(effectiveStorage, 'day-planner-deleted-project-ids'),
    [deletedProjectIds, effectiveStorage],
  );
  const input = useMemo(() => ({
    document: document || { wishes: lifeplannerWishes },
    wishes: lifeplannerWishes,
    goals,
    projects,
    tasks,
    unscheduledTasks,
    recurringTasks,
    recycleBin,
    todayRoutines,
    deletedGoalIds: effectiveDeletedGoalIds,
    deletedProjectIds: effectiveDeletedProjectIds,
  }), [document, lifeplannerWishes, goals, projects, tasks, unscheduledTasks, recurringTasks, recycleBin, todayRoutines, effectiveDeletedGoalIds, effectiveDeletedProjectIds]);
  const hierarchy = useMemo(() => buildHierarchy(input), [input]);
  const migrationPlan = useMemo(() => planStepLinkMigration(input), [input]);
  const reason = !dataLoaded
    ? 'not-loaded'
    : multiUserEnabled
      ? 'multi-user'
      : readOnly
        ? 'read-only'
        : null;
  const ready = reason === null;

  const ensureStepGoal = useCallback((args = {}) => {
    if (!ready) return skipped(reason);
    return ensureStepGoalNative({
      ...args,
      goals,
      addGoal,
      updateGoal,
      deletedGoalIds: args.deletedGoalIds ?? effectiveDeletedGoalIds,
    });
  }, [ready, reason, goals, addGoal, updateGoal, effectiveDeletedGoalIds]);

  const ensureStepProject = useCallback((args = {}) => {
    if (!ready) return skipped(reason);
    return ensureStepProjectNative({
      ...args,
      projects,
      addProject,
      updateProject,
      deletedProjectIds: args.deletedProjectIds ?? effectiveDeletedProjectIds,
    });
  }, [ready, reason, projects, addProject, updateProject, effectiveDeletedProjectIds]);

  const executeMigration = useCallback((options = {}) => {
    if (!ready) return Promise.resolve(skipped(reason));
    const plan = options.plan || migrationPlan;
    return executeStepLinkMigration(plan, {
      goals,
      projects,
      addGoal,
      updateGoal,
      updateProject,
      commitLifePlanner: options.commitLifePlanner || commitLifePlanner,
      getStep: options.getStep || stepReader({ wishes: lifeplannerWishes }),
      storage: options.storage || effectiveStorage,
      snapshotKey: options.snapshotKey || HIERARCHY_SNAPSHOT_KEY,
    });
  }, [ready, reason, migrationPlan, goals, projects, addGoal, updateGoal, updateProject, commitLifePlanner, lifeplannerWishes, effectiveStorage]);

  const readSnapshot = useCallback((key = HIERARCHY_SNAPSHOT_KEY) => readHierarchySnapshot(effectiveStorage, key), [effectiveStorage]);

  return {
    hierarchy,
    migrationPlan,
    ready,
    guardReason: reason,
    ensureStepGoal,
    ensureStepProject,
    executeMigration,
    readSnapshot,
    snapshotKey: HIERARCHY_SNAPSHOT_KEY,
  };
}
