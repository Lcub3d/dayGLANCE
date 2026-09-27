import { createDoRecord, DO_PROGRESS, DO_TIMING, validateDoRecord } from './core.js';
import { dateToString } from '../utils/taskUtils.js';

export const POMODORO_CLOCK_MIME = 'application/x-jobu-pomodoro-clock';
export const POMODORO_TASK_MIME = 'application/x-jobu-pomodoro-task';

export function writePomodoroTaskDrag(event, task, record = null) {
  if (!task?.id && !record?.id) return;
  event.dataTransfer.setData(POMODORO_TASK_MIME, JSON.stringify({ taskId: task?.id ?? null, recordId: record?.id ?? null }));
}

export function createPomodoroTarget(task, record, id) {
  if (!task?.id && !record?.id) throw new TypeError('A task or Do is required');
  if (record?.deleted) throw new TypeError('The Do was deleted');
  const plan = task?.date && /^\d{2}:\d{2}$/.test(task.startTime || '') && task.duration > 0 && !task.isAllDay
    ? { date: task.date, startTime: task.startTime, duration: task.duration } : null;
  return {
    recordId: record?.id || id,
    existingRecord: !!record,
    taskId: record?.taskId ?? task?.recurringTemplateId ?? task?.id ?? null,
    title: record?.title || task?.title?.trim() || 'Untitled task',
    planSnapshot: record ? record.planSnapshot : plan,
    occurrenceDate: task?.date || record?.planSnapshot?.date || null,
  };
}

/** One completed work round. Pauses affect its wall interval, not its work minutes. */
export function buildPomodoroRecord({ target, cycle, endedAt, records = [] }) {
  const current = records.find(record => record.id === target.recordId);
  if (current?.deleted || (target.existingRecord && !current)) throw new Error('recordChanged');
  if (current && !validateDoRecord(current).ok) throw new Error('recordChanged');
  if (current?.pomodoroSessions?.some(session => session.id === cycle.id)) return current;
  const start = new Date(cycle.startedAt);
  const end = new Date(endedAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start
    || !Number.isFinite(cycle.minutes) || cycle.minutes < 1) throw new TypeError('Invalid focus interval');
  const date = dateToString(start);
  const endDate = dateToString(end);
  const startMinute = start.getHours() * 60 + start.getMinutes();
  const dayDifference = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 60000;
  const endMinute = dayDifference + end.getHours() * 60 + end.getMinutes();
  const session = {
    id: cycle.id, recordId: target.recordId, taskId: target.taskId,
    occurrenceDate: target.occurrenceDate, date,
    startedAt: start.toISOString(), endedAt: end.toISOString(),
    startMinute, endMinute, durationMinutes: cycle.minutes, kind: 'pomodoro',
  };
  const time = value => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  const stamp = new Date(Math.max(end.getTime(), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
  const interval = { timing: DO_TIMING.TIMED, date, startTime: time(start), endDate, endTime: time(end) };
  const base = current || {
    id: target.recordId, taskId: target.taskId, title: target.title,
    source: 'focus', progress: DO_PROGRESS.STARTED, deleted: false,
    planSnapshot: target.planSnapshot, createdAt: start.toISOString(), observedAt: end.toISOString(), ...interval,
  };
  // An explicitly selected Do keeps its manually chosen interval. A new focus
  // Do grows with this session's successive rounds (including intervening breaks).
  const extension = current && !target.existingRecord ? { endDate, endTime: time(end) } : {};
  return createDoRecord({ ...base, ...extension, updatedAt: stamp,
    pomodoroSessions: [...(current?.pomodoroSessions || []), session] });
}
