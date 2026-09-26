// The JOBO view's narrow bridge to native dayGLANCE Plan actions.
//
// A Plan can be a live native task or a captured historical snapshot.  Only a
// live task is allowed to call a native handler.  This module intentionally
// does not know about the Do ledger and never writes the task collection; the
// owning main context remains the sole writer for these operations.

import { validCivilDate } from './viewDates.js';

function liveTask(item) {
  if (!item || item.historical || !item.currentTask || item.currentTask.isJoboSyntheticOccurrence) return null;
  return item.currentTask;
}

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const NATIVE_CREATE_HANDLER = 'createTimelineTask';
const COPY_FIELDS = Object.freeze([
  'title', 'notes', 'subtasks', 'color', 'projectId', 'assignedUserSyncIds', 'priority',
]);

function randomId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new TypeError('A native task identity handler is required');
  return globalThis.crypto.randomUUID();
}

function normalizePlanInput({ date, startTime, duration = 30, title = '' } = {}) {
  if (!validCivilDate(date)) throw new TypeError('date must be YYYY-MM-DD');
  if (typeof startTime !== 'string' || !TIME_RE.test(startTime)) throw new TypeError('startTime must be HH:mm');
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new TypeError('duration must be a positive number');
  }
  if (typeof title !== 'string') throw new TypeError('title must be a string');
  return { date, startTime, duration, title };
}

function findHandler(ctx, name) {
  if (!ctx) return null;
  return typeof ctx[name] === 'function' ? ctx[name].bind(ctx) : null;
}

function normalizeCreatedResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !result.id) return false;
  return { task: result, id: result.id };
}

function invokeCreate(ctx, requestedTask) {
  const handler = findHandler(ctx, NATIVE_CREATE_HANDLER);
  if (!handler) return false;
  const result = handler(requestedTask);
  return normalizeCreatedResult(result);
}

function ordinaryPlanCopy(source, target) {
  const copy = {
    id: randomId(),
    title: source.title ?? '',
    date: target.date,
    startTime: target.startTime,
    duration: target.duration,
    isAllDay: false,
    completed: false,
  };
  for (const key of COPY_FIELDS) {
    if (source[key] !== undefined) {
      copy[key] = key === 'subtasks'
        ? source[key].map(value => ({ ...value, id: randomId(), completed: false }))
        : Array.isArray(source[key]) ? [...source[key]] : source[key];
    }
  }
  return copy;
}

/**
 * Create a scheduled Plan through an explicit native task handler.
 *
 * The context's `createTimelineTask` handler receives a complete task draft
 * and remains the sole writer.  The old `addTask()` API intentionally is not
 * called here: it only accepts a boolean inbox flag and would otherwise read
 * stale modal state.
 * The synchronous handler returns the complete task object.  This adapter
 * normalizes that object to `{ task, id }` for the view and treats any missing
 * object/id as a failed create.
 */
export function createQuickPlan(ctx, { date, startTime, duration = 30, title = '' } = {}) {
  const input = normalizePlanInput({ date, startTime, duration, title });
  return invokeCreate(ctx, {
    id: randomId(),
    ...input,
    isAllDay: false,
    completed: false,
    notes: '',
    subtasks: [],
  });
}

/** Copy a live Plan into a new ordinary scheduled task through main. */
export function copyPlan(ctx, item, { date, startTime, duration } = {}) {
  const source = liveTask(item);
  if (!source) return false;
  const input = normalizePlanInput({
    date: date ?? source.date,
    startTime: startTime ?? source.startTime,
    duration: duration ?? source.duration,
    title: source.title ?? '',
  });
  const copy = ordinaryPlanCopy(source, input);
  return invokeCreate(ctx, copy);
}

/** Return the native actions permitted for a live Plan row. */
export function planCapabilities(item) {
  const task = liveTask(item);
  if (!task) return {
    editable: false,
    draggable: false,
    completable: false,
  };

  const imported = !!task.imported;
  return {
    editable: !imported || !!task.nativeEventId,
    draggable: !imported || !!task.isTaskCalendar || !!task.nativeEventId,
    completable: !imported || !!task.isTaskCalendar,
  };
}

/** Open main's native new-Plan editor at an explicit date and time. */
export function openNewPlan(ctx, dateString, time) {
  if (!ctx || typeof ctx.setNewTask !== 'function' || typeof ctx.setShowAddTask !== 'function') return false;
  ctx.setNewTask({
    title: '',
    startTime: time,
    duration: 30,
    date: dateString,
    isAllDay: false,
  });
  ctx.setShowAddTask(true);
  return true;
}

/** Open the correct main editor for a live Plan. */
export function editPlan(ctx, item) {
  const task = liveTask(item);
  if (!task || !planCapabilities(item).editable) return false;
  if (task.nativeEventId) {
    if (typeof ctx?.openMobileEditNativeEvent !== 'function') return false;
    ctx.openMobileEditNativeEvent(task);
    return true;
  }
  if (typeof ctx?.openMobileEditTask !== 'function') return false;
  ctx.openMobileEditTask(task, false);
  return true;
}

/** Let Slice 4's main completion path create the linked Do. */
export function togglePlanCompletion(ctx, item) {
  const task = liveTask(item);
  if (!task || !planCapabilities(item).completable || typeof ctx?.toggleComplete !== 'function') return false;
  ctx.toggleComplete(task.id, false);
  return true;
}

/** Start a native calendar drag without changing the task collection here. */
export function startPlanDrag(ctx, item, event) {
  const task = liveTask(item);
  if (!task || !planCapabilities(item).draggable || typeof ctx?.handleDragStart !== 'function') return false;
  ctx.handleDragStart(task, 'calendar', event);
  return true;
}

/** Start resizing a live native Plan through main's task resize handler. */
export function startPlanResize(ctx, item, event, scale = 80, { touch = false } = {}) {
  const task = liveTask(item);
  if (!task || !planCapabilities(item).editable || !Number.isFinite(scale) || scale <= 0) return false;
  const handler = touch ? ctx?.handleTouchResizeStart : ctx?.handleResizeStart;
  if (typeof handler !== 'function') return false;
  handler(task, event, scale);
  return true;
}

/** Forward an explicit calendar drop target to main's drag/drop handler. */
export function dropPlan(ctx, event, selectedDate, time) {
  if (typeof ctx?.handleDropOnCalendar !== 'function') return false;
  ctx.handleDropOnCalendar(event, selectedDate, time);
  return true;
}

/** Write notes through main's task-note path; imported items stay read-only. */
export function writePlanNotes(ctx, task, text, isInbox = false) {
  if (!task || task.imported || task.isJoboSyntheticOccurrence || typeof ctx?.updateTaskNotes !== 'function') return false;
  ctx.updateTaskNotes(task.id, text, isInbox);
  return true;
}

/** Write a daily note through main's daily-note path. */
export function writeDailyNotes(ctx, date, text) {
  if (typeof ctx?.updateDailyNote !== 'function') return false;
  ctx.updateDailyNote(date, text);
  return true;
}

export default {
  planCapabilities,
  createQuickPlan,
  copyPlan,
  openNewPlan,
  editPlan,
  togglePlanCompletion,
  startPlanDrag,
  startPlanResize,
  dropPlan,
  writePlanNotes,
  writeDailyNotes,
};
