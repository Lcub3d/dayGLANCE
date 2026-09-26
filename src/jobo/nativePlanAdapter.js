// The JOBO view's narrow bridge to native dayGLANCE Plan actions.
//
// A Plan can be a live native task or a captured historical snapshot.  Only a
// live task is allowed to call a native handler.  This module intentionally
// does not know about the Do ledger and never writes the task collection; the
// owning main context remains the sole writer for these operations.

function liveTask(item) {
  if (!item || item.historical || !item.currentTask) return null;
  return item.currentTask;
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

/** Forward an explicit calendar drop target to main's drag/drop handler. */
export function dropPlan(ctx, event, selectedDate, time) {
  if (typeof ctx?.handleDropOnCalendar !== 'function') return false;
  ctx.handleDropOnCalendar(event, selectedDate, time);
  return true;
}

/** Write notes through main's task-note path; imported items stay read-only. */
export function writePlanNotes(ctx, task, text, isInbox = false) {
  if (!task || task.imported || typeof ctx?.updateTaskNotes !== 'function') return false;
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
  openNewPlan,
  editPlan,
  togglePlanCompletion,
  startPlanDrag,
  dropPlan,
  writePlanNotes,
  writeDailyNotes,
};
