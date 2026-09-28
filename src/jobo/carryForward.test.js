import { describe, expect, it } from 'vitest';
import { appendCarriedTasks, carryForwardCandidates, carryForwardTask } from './carryForward.js';
import { createManualDo } from './viewActions.js';
const now = { date: '2026-09-27', time: '12:00' };
const task = { id: 't', title: 'Write', notes: 'Keep notes', date: now.date, startTime: '09:00', duration: 60, priority: 3, color: 'bg-green-500', projectId: 'project' };
const record = (progress, id = 'r') => createManualDo({ id, task, planSnapshot: { date: task.date, startTime: task.startTime, duration: 60 }, date: task.date, startMinute: 540, duration: 45, progress, now: Date.parse('2026-09-27T09:00:00Z') });

describe('Carry Forward', () => {
  it('lists overdue unstarted plans and started/partial Do attempts only', () => {
    const base = { tasks: [task, { ...task, id: 'future', startTime: '13:00' }, { ...task, id: 'done', completed: true }], now };
    expect(carryForwardCandidates(base).map(item => item.token)).toEqual(['plan:t']);
    expect(carryForwardCandidates({ ...base, records: [record('started'), record('partial', 'p'), record('mostly', 'm'), record('completed', 'c')] }).map(item => item.token)).toEqual(['do:r', 'do:p']);
  });
  it('copies content and priority into a fresh unscheduled task, keeping the originals', () => {
    const [candidate] = carryForwardCandidates({ tasks: [task], now });
    const copy = carryForwardTask(candidate, 'new', '2026-09-27T12:00:00Z');
    expect(copy).toMatchObject({ id: 'new', title: task.title, notes: task.notes, color: task.color, priority: 3, projectId: task.projectId, completed: false, joboCarrySource: 'plan:t' });
    expect(copy).not.toHaveProperty('date');
    expect(copy).not.toHaveProperty('startTime');
    expect(task.date).toBe(now.date);
    expect(carryForwardCandidates({ tasks: [task], inbox: [copy], now })).toEqual([]);
    expect(carryForwardCandidates({ tasks: [task, { ...copy, date: now.date }], now })).toEqual([]);
    expect(appendCarriedTasks([copy], [task], [copy])).toEqual([copy]);
  });
  it('does not resurrect deleted Do attempts or carry imported calendar events', () => {
    expect(carryForwardCandidates({ tasks: [{ ...task, imported: true }], records: [{ ...record('partial'), deleted: true }], now })).toEqual([]);
  });
});
