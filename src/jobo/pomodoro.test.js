import { describe, expect, it } from 'vitest';
import { buildPomodoroRecord, createPomodoroTarget, writePomodoroTaskDrag, POMODORO_TASK_MIME } from './pomodoro.js';
import { validateDoRecord } from './core.js';
import { selectDoFocusHistory } from './focusHistory.js';

const task = { id: 'task-1', title: 'Write report', date: '2026-09-27', startTime: '09:00', duration: 60, priority: 3 };
const start = new Date(2026, 8, 27, 9, 0).getTime();
const cycle = { id: 'round-1', startedAt: start, minutes: 25 };
const target = createPomodoroTarget(task, null, 'focus-1');
const finish = (overrides = {}) => buildPomodoroRecord({ target, cycle, endedAt: start + 25 * 60000, ...overrides });

describe('task-linked pomodoro records', () => {
  it('creates an editable, timed Do without marking the task completed', () => {
    const record = finish();
    expect(validateDoRecord(record).ok).toBe(true);
    expect(record).toMatchObject({ taskId: task.id, source: 'focus', progress: 'started', timing: 'timed', startTime: '09:00', endTime: '09:25', planSnapshot: { date: task.date, startTime: task.startTime, duration: task.duration } });
    expect(task.completed).toBeUndefined();
    expect(selectDoFocusHistory({ record, task })).toMatchObject([{ id: 'round-1', durationMinutes: 25, kind: 'pomodoro' }]);
  });

  it('accumulates rounds on one Do, keeps pause-inclusive intervals, and deduplicates a retry', () => {
    const first = finish();
    const second = finish({ records: [first], cycle: { id: 'round-2', startedAt: start + 30 * 60000, minutes: 25 }, endedAt: start + 65 * 60000 });
    expect(second.id).toBe(first.id);
    expect(second.endTime).toBe('10:05');
    expect(second.pomodoroSessions).toHaveLength(2);
    expect(second.pomodoroSessions[1]).toMatchObject({ startMinute: 570, endMinute: 605, durationMinutes: 25 });
    expect(finish({ records: [second] })).toBe(second);
  });

  it('adds history to an explicitly targeted Do without altering its interval or progress', () => {
    const existing = { ...finish(), progress: 'mostly' };
    const explicit = createPomodoroTarget(task, existing, 'unused');
    const record = finish({ target: explicit, records: [existing], cycle: { ...cycle, id: 'later-round', startedAt: start + 60 * 60000 }, endedAt: start + 85 * 60000 });
    expect(record).toMatchObject({ id: existing.id, progress: 'mostly', startTime: '09:00', endTime: '09:25' });
    expect(record.pomodoroSessions).toHaveLength(2);
    expect(selectDoFocusHistory({ record: { ...record, id: 'another-do', pomodoroSessions: [] }, task, focusSessions: record.pomodoroSessions })).toEqual([]);
  });

  it('preserves recurring occurrence identity and handles midnight', () => {
    const recurring = { ...task, id: 'recurring-series-2026-09-27', recurringTemplateId: 'series' };
    const night = new Date(2026, 8, 27, 23, 50).getTime();
    const record = finish({ target: createPomodoroTarget(recurring, null, 'night'), cycle: { ...cycle, startedAt: night }, endedAt: night + 25 * 60000 });
    expect(record).toMatchObject({ taskId: 'series', date: '2026-09-27', endDate: '2026-09-28', startTime: '23:50', endTime: '00:15' });
    expect(record.pomodoroSessions[0]).toMatchObject({ occurrenceDate: '2026-09-27', startMinute: 1430, endMinute: 1455 });
    expect(selectDoFocusHistory({ record, task: recurring })).toHaveLength(1);
  });

  it('supports an inbox task without manufacturing a Plan and never revives a deleted Do', () => {
    const inbox = createPomodoroTarget({ id: 'inbox-1', title: 'Inbox work' }, null, 'inbox-do');
    expect(finish({ target: inbox }).planSnapshot).toBeNull();
    expect(() => finish({ records: [{ ...finish(), deleted: true }] })).toThrow('recordChanged');
    expect(() => finish({ target: { ...target, existingRecord: true } })).toThrow('recordChanged');
  });

  it('adds drag association without replacing the normal scheduling payload', () => {
    const data = new Map([['application/x-dayglance-task', task.id]]);
    writePomodoroTaskDrag({ dataTransfer: { setData: (key, value) => data.set(key, value) } }, task, { id: 'do-1' });
    expect(JSON.parse(data.get(POMODORO_TASK_MIME))).toEqual({ taskId: task.id, recordId: 'do-1' });
    expect(data.get('application/x-dayglance-task')).toBe(task.id);
  });
});
