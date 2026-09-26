// Local JOBO experiment: an explicit Do judgement may complete its native
// task. Persist the event -> Do link on the task so a second device observing
// that checkbox does not manufacture an additional Untimed attempt.
// Ordinary task completions and the slice 2/3 record/ledger APIs stay intact.
import { completionKey, recurringKey } from './detector.js';

export function routeDoCompletionEdges(edges, { tasks = [], unscheduledTasks = [], recurringTasks = [] } = {}, resolveLinkedDo = id => id) {
  const links = new Map();
  const unchecks = new Set();
  for (const task of [...tasks, ...unscheduledTasks, ...recurringTasks]) {
    const prefix = `do:${task.id}:`;
    for (const [key, id] of Object.entries(task.joboCompletionLinks || {})) {
      if (key.startsWith(prefix) && typeof id === 'string' && id) links.set(key, id);
    }
    for (const [key, id] of Object.entries(task.joboUncompletionLinks || {})) {
      if (key.startsWith(prefix) && typeof id === 'string' && id) unchecks.add(key);
    }
  }
  return {
    // The authored Do was saved before its task was checked. Suppression also
    // works when task sync arrives before the corresponding ledger payload.
    completions: (edges?.completions || []).filter(edge => !links.has(edge.id)),
    uncompletions: (edges?.uncompletions || []).filter(edge => !unchecks.has(edge.id)).map(edge => links.has(edge.id) ? { ...edge, id: resolveLinkedDo(links.get(edge.id)) } : edge),
  };
}

export function nativeDoCompletionState(ctx, record) {
  if (record?.taskId == null) return null;
  const template = (ctx.recurringTasks || []).find(task => String(task.id) === String(record.taskId));
  if (template) {
    const prefix = `do:${template.id}:`;
    const capturedDate = record.planSnapshot?.date || (record.source === 'completion' && record.id.startsWith(prefix) ? record.id.slice(prefix.length, prefix.length + 10) : null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedDate || '')) return null;
    return { id: `recurring-${template.id}-${capturedDate}`, fromInbox: false,
      completed: (template.completedDates || []).includes(capturedDate), stamp: template.completedDatesTimestamps?.[capturedDate] || null };
  }
  const scheduled = (ctx.tasks || []).find(task => String(task.id) === String(record.taskId));
  const task = scheduled || (ctx.unscheduledTasks || []).find(row => String(row.id) === String(record.taskId));
  if (!task || (task.imported && !task.isTaskCalendar)) return null;
  return { id: task.id, fromInbox: !scheduled, completed: !!task.completed, stamp: task.completedAt || null,
    transitionId: task.transitionId ?? null };
}

export function sameNativeCompletion(a, b) {
  return a == null ? b == null : b != null && a.id === b.id && a.completed === b.completed && a.stamp === b.stamp
    && (a.transitionId ?? null) === (b.transitionId ?? null);
}

export function doCompletionLink(taskId, date, stamp, recordId) {
  return { [date ? recurringKey(taskId, date, stamp) : completionKey(taskId, stamp)]: recordId };
}
