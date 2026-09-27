// Slice 5 can toggle a live native Plan, but cannot create or move one.
export function togglePlanCompletion(ctx, item) {
  const task = item?.currentTask;
  if (!task || item.historical || task.isJoboSyntheticOccurrence
    || (task.imported && !task.isTaskCalendar)
    || typeof ctx?.toggleComplete !== 'function') return false;
  ctx.toggleComplete(task.id, false);
  return true;
}
