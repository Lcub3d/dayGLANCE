import { doDurationMinutes, validateDoRecord } from './core.js';

const taskKey = task => String(task.recurringTemplateId ?? task.id);
const planMatches = (record, task) => String(record.taskId) === taskKey(task)
  && record.planSnapshot?.date === task.date && record.planSnapshot?.startTime === task.startTime;
const civilMinute = (date, time) => Date.parse(`${date}T${time}:00Z`) / 60000;

export function carryForwardCandidates({ tasks = [], inbox = [], records = [], now }) {
  const carried = new Set([...tasks, ...inbox].map(task => task.joboCarrySource).filter(Boolean));
  const live = records.filter(record => !record?.deleted && validateDoRecord(record).ok);
  const uniqueTasks = [...new Map(tasks.map(task => [String(task.id), task])).values()];
  const candidates = [];
  for (const task of uniqueTasks) {
    const token = `plan:${task.id}`;
    if (task.deleted || task.archived || task.completed || task.isExample || (task.imported && !task.isTaskCalendar)
      || carried.has(token) || !task.date || !task.startTime || live.some(record => planMatches(record, task))) continue;
    if (civilMinute(task.date, task.startTime) + (task.duration || 30) > civilMinute(now.date, now.time)) continue;
    if (!Number.isFinite(civilMinute(task.date, task.startTime))) continue;
    candidates.push({ token, kind: 'notStarted', task, date: task.date });
  }
  for (const record of live) {
    const token = `do:${record.id}`;
    if (carried.has(token) || !['started', 'partial'].includes(record.progress)) continue;
    const source = uniqueTasks.find(task => taskKey(task) === String(record.taskId)
      && (!task.recurringTemplateId || task.date === record.planSnapshot?.date));
    candidates.push({ token, kind: record.progress, date: record.date, task: {
      ...source, title: record.title, notes: source?.notes || record.notes || '',
      duration: doDurationMinutes(record) || record.planSnapshot?.duration || 30,
    } });
  }
  return candidates;
}

export function carryForwardTask(candidate, id, stamp) {
  const task = candidate.task;
  return {
    id, title: task.title, notes: task.notes || '', color: task.color || 'bg-blue-500',
    duration: task.duration || 30, priority: task.priority || 0, projectId: task.projectId || null,
    ...(task.ownerId != null ? { ownerId: task.ownerId } : {}),
    completed: false, joboCarrySource: candidate.token, createdAt: stamp, lastModified: stamp,
  };
}

export function appendCarriedTasks(inbox, tasks, additions) {
  const carried = new Set([...tasks, ...inbox].map(task => task.joboCarrySource).filter(Boolean));
  const fresh = additions.filter(task => {
    if (carried.has(task.joboCarrySource)) return false;
    carried.add(task.joboCarrySource);
    return true;
  });
  return fresh.length ? [...inbox, ...fresh] : inbox;
}
