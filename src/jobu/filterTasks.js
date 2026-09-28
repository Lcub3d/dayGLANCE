import { getOccurrencesInRange } from '../utils/recurrenceEngine.js';
import { dayKey, validDay } from './year.js';
import { shiftDay } from './filterDates.js';

// Use one next active occurrence per native recurring series, independent of
// the selected calendar day/zoom. Historical repeated completions stay in JOBO.
export function collectFilterTasks({ tasks = [], unscheduledTasks = [], recurringTasks = [], projects = [], isVisibleForUser = () => true, today = dayKey(new Date()) } = {}) {
  const result = [], seen = new Set(), archived = new Set(projects.filter(p => p.archived || p.deleted || p.status === 'archived').map(p => String(p.id)));
  const accept = (task, inbox) => {
    if (!task || task.id == null || seen.has(String(task.id)) || task.deleted || task.archived || task.isExample || task.todoist?.remoteDeleted || (task.imported && !task.isTaskCalendar) || archived.has(String(task.projectId)) || !isVisibleForUser(task)) return;
    seen.add(String(task.id)); result.push({ task, inbox });
    // Native checklist children have their own completion/title only. Do not
    // inherit their parent's date, priority or labels as invented child facts.
    // No recursive traversal: native handlers support one checklist level.
    if (!task.completed) for (const child of task.subtasks || []) {
      if (!child || child.id == null || child.deleted || child.archived) continue;
      const id = `jobu-child:${JSON.stringify([task.id, child.id])}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ task: { ...child, id, projectId: task.projectId, _jobuParent: task.id,
        _jobuChildId: child.id, _jobuParentTitle: task.title,
        _jobuRecurringChild: task.recurringTemplateId != null,
        _jobuLabelId: `jobu-child:${JSON.stringify([task.recurringTemplateId ?? task.id, child.id])}` }, inbox });
    }
  };
  tasks.forEach(task => accept(task, false)); unscheduledTasks.forEach(task => accept(task, true));
  if (validDay(today)) for (const template of recurringTasks) {
    if (!template || template.deleted || template.archived || template.isExample || !isVisibleForUser(template) || !validDay(template.recurrence?.startDate)) continue;
    const completed = new Set(template.completedDates || []);
    // The native engine owns skipped/deleted exceptions and repeat limits.
    const dates = getOccurrencesInRange(template, today, shiftDay(today, 3660), completed.size + 1);
    const date = dates.find(day => !completed.has(day));
    if (!date) continue;
    const exception = template.exceptions?.[date] || {};
    accept({ ...template, ...exception, id: `recurring-${template.id}-${date}`, recurringTemplateId: template.id, date, isRecurring: true, completed: false }, false);
  }
  return result;
}
export function filterProjects(projects = [], entries = []) {
  const result = [...projects], ids = new Set(projects.map(p => String(p.id)));
  for (const { task } of entries) if (task.todoist?.project) {
    const id = `todoist:${task.todoist.accountId}:${task.todoist.projectId}`;
    if (!ids.has(id)) { ids.add(id); result.push({ id, title: task.todoist.project }); }
  }
  return result;
}
