export const JOURNAL_VERSION = 1;

export const EMPTY_JOURNAL_STATE = Object.freeze({
  version: JOURNAL_VERSION,
  actualBlocks: [],
  planRevisions: [],
  planHeads: {},
});

const asArray = value => Array.isArray(value) ? value : [];
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const taskKey = value => String(value ?? '');

export function normalizeJournalState(raw = {}) {
  return {
    version: JOURNAL_VERSION,
    actualBlocks: asArray(raw.actualBlocks).filter(Boolean),
    planRevisions: asArray(raw.planRevisions).filter(Boolean),
    planHeads: { ...asObject(raw.planHeads) },
  };
}

export function snapshotPlan(task, capturedAt = new Date().toISOString()) {
  if (!task || task.id == null) return null;
  const duration = Number(task.duration);
  return {
    taskId: taskKey(task.id),
    title: String(task.title ?? ''),
    date: task.date ? String(task.date) : null,
    startTime: task.startTime ? String(task.startTime) : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 30,
    isAllDay: task.isAllDay === true,
    projectId: task.projectId != null ? String(task.projectId) : null,
    color: task.color || null,
    source: task.importSource || task.source_app || (task.imported ? 'calendar' : 'dayglance'),
    capturedAt,
  };
}

export function isRecordablePlan(snapshot) {
  return !!snapshot?.taskId && !!snapshot.date && !!snapshot.startTime && !snapshot.isAllDay;
}

export function samePlanSchedule(a, b) {
  if (!a || !b) return false;
  return a.date === b.date
    && a.startTime === b.startTime
    && Number(a.duration) === Number(b.duration)
    && !!a.isAllDay === !!b.isAllDay;
}

function samePlanMetadata(a, b) {
  return a.title === b.title
    && a.projectId === b.projectId
    && a.color === b.color
    && a.source === b.source;
}

function replaceMetadata(previous, next) {
  return {
    ...previous,
    title: next.title,
    projectId: next.projectId,
    color: next.color,
    source: next.source,
  };
}

export function actualBlockMatchesPlan(block, taskOrSnapshot) {
  const snapshot = taskOrSnapshot?.taskId != null && taskOrSnapshot?.capturedAt
    ? taskOrSnapshot
    : snapshotPlan(taskOrSnapshot, 'compare');
  if (!block || !isRecordablePlan(snapshot)) return false;
  return taskKey(block.sourceTaskId) === snapshot.taskId
    && block.date === snapshot.date
    && block.startTime === snapshot.startTime
    && Number(block.duration) === Number(snapshot.duration);
}

export function observePlans(state, tasks, {
  observedAt = new Date().toISOString(),
  idFactory = () => `plan-revision:${observedAt}`,
} = {}) {
  const current = normalizeJournalState(state);
  const planHeads = { ...current.planHeads };
  const planRevisions = [...current.planRevisions];
  let changed = false;

  for (const task of asArray(tasks)) {
    const next = snapshotPlan(task, observedAt);
    if (!next?.taskId || !next.date) continue;
    const previous = planHeads[next.taskId];

    if (!previous) {
      planHeads[next.taskId] = next;
      changed = true;
      continue;
    }

    if (!samePlanSchedule(previous, next)) {
      planRevisions.push({
        id: idFactory(),
        taskId: next.taskId,
        before: previous,
        after: next,
        changedAt: observedAt,
      });
      planHeads[next.taskId] = next;
      changed = true;
      continue;
    }

    if (!samePlanMetadata(previous, next)) {
      planHeads[next.taskId] = replaceMetadata(previous, next);
      changed = true;
    }
  }

  return {
    state: changed ? { ...current, planHeads, planRevisions } : current,
    changed,
  };
}

export function recordPlanAsActual(state, task, {
  id,
  recordedAt = new Date().toISOString(),
  revisionIdFactory,
} = {}) {
  const observed = observePlans(state, [task], {
    observedAt: recordedAt,
    idFactory: revisionIdFactory || (() => `plan-revision:${id || recordedAt}`),
  });
  const current = observed.state;
  const snapshot = snapshotPlan(task, recordedAt);
  if (!isRecordablePlan(snapshot)) return { state: current, block: null, created: false };

  const existing = current.actualBlocks.find(block => actualBlockMatchesPlan(block, snapshot));
  if (existing) return { state: current, block: existing, created: false };

  const block = {
    id: id || `actual:${snapshot.taskId}:${recordedAt}`,
    sourceTaskId: snapshot.taskId,
    source: snapshot.source,
    title: snapshot.title,
    date: snapshot.date,
    startTime: snapshot.startTime,
    duration: snapshot.duration,
    projectId: snapshot.projectId,
    color: snapshot.color,
    recordedAt,
    updatedAt: recordedAt,
    planSnapshot: snapshot,
  };

  return {
    state: { ...current, actualBlocks: [...current.actualBlocks, block] },
    block,
    created: true,
  };
}

export function updateActualBlock(state, blockId, patch, updatedAt = new Date().toISOString()) {
  const current = normalizeJournalState(state);
  let changed = false;
  const actualBlocks = current.actualBlocks.map(block => {
    if (block.id !== blockId) return block;
    changed = true;
    const duration = Number(patch?.duration ?? block.duration);
    return {
      ...block,
      ...patch,
      duration: Number.isFinite(duration) && duration > 0 ? duration : block.duration,
      id: block.id,
      sourceTaskId: block.sourceTaskId,
      planSnapshot: block.planSnapshot,
      updatedAt,
    };
  });
  return changed ? { ...current, actualBlocks } : current;
}

export function removeActualBlock(state, blockId) {
  const current = normalizeJournalState(state);
  const actualBlocks = current.actualBlocks.filter(block => block.id !== blockId);
  return actualBlocks.length === current.actualBlocks.length ? current : { ...current, actualBlocks };
}

export function actualBlocksForDate(state, dateStr) {
  return normalizeJournalState(state).actualBlocks
    .filter(block => block.date === dateStr)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.id).localeCompare(String(b.id)));
}

export function summarizeJournalDay(state, dateStr) {
  const current = normalizeJournalState(state);
  const blocks = actualBlocksForDate(current, dateStr);
  const taskIds = new Set(blocks.map(block => taskKey(block.sourceTaskId)).filter(Boolean));
  const revisions = current.planRevisions.filter(revision => revision.before?.date === dateStr || revision.after?.date === dateStr);
  return {
    actualCount: blocks.length,
    actualMinutes: blocks.reduce((sum, block) => sum + (Number(block.duration) || 0), 0),
    uniqueTaskCount: taskIds.size,
    planRevisionCount: revisions.length,
  };
}
