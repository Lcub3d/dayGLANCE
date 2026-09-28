import { describe, expect, it, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';

function buildActions(overrides = {}) {
  const deps = {
    selectedDate: new Date('2026-09-26T12:00:00.000Z'),
    setTasks: vi.fn(),
    pushUndo: vi.fn(),
    playUISound: vi.fn(),
    onboardingProgress: { hasAddedScheduledTask: false },
    setOnboardingProgress: vi.fn(),
    setSyncNotification: vi.fn(),
    getAdjustedTimeForImportedConflicts: vi.fn((id, startTime, duration, date) => ({
      conflicted: false, adjustedStartTime: startTime, conflictingEvent: null,
      id, duration, date,
    })),
    ...overrides,
  };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return { actions: useTaskActions(deps), deps };
}

describe('createTimelineTask', () => {
  it('creates a blank scheduled task through the native task path and returns it', () => {
    const { actions, deps } = buildActions();
    const created = actions.createTimelineTask({
      id: 'plan-1', title: '', date: '2026-09-26', startTime: '09:15', duration: 45,
    });
    const updater = deps.setTasks.mock.calls[0][0];
    expect(created).toMatchObject({
      id: 'plan-1', title: '', date: '2026-09-26', startTime: '09:15', duration: 45,
      completed: false, isAllDay: false,
    });
    expect(updater([])).toEqual([created]);
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    expect(deps.playUISound).toHaveBeenCalledWith('pop');
    expect(deps.setOnboardingProgress).toHaveBeenCalledTimes(1);
  });

  it('uses the existing imported-conflict adjustment and keeps explicit task fields', () => {
    const conflictingEvent = { title: 'Calendar event' };
    const getAdjusted = vi.fn(() => ({
      conflicted: true, adjustedStartTime: '10:00', conflictingEvent,
    }));
    const { actions, deps } = buildActions({ getAdjustedTimeForImportedConflicts: getAdjusted });
    const created = actions.createTimelineTask({
      id: 'plan-2', title: 'Copy', date: '2026-09-26', startTime: '09:30', duration: 30,
      color: 'bg-blue-500', notes: 'context', subtasks: [{ id: 's1', title: 'Done', completed: true }],
      projectId: 'project-1', assignedUserSyncIds: ['user-1'], priority: 2,
      todoistId: 'must-not-leak',
    });
    expect(getAdjusted).toHaveBeenCalledWith('plan-2', '09:30', 30, '2026-09-26');
    expect(created.startTime).toBe('10:00');
    expect(created).toMatchObject({
      color: 'bg-blue-500', notes: 'context', projectId: 'project-1',
      assignedUserSyncIds: ['user-1'], priority: 2,
    });
    expect(created.subtasks).toHaveLength(1);
    expect(created.subtasks[0]).toMatchObject({ title: 'Done', completed: false });
    expect(created.subtasks[0].id).not.toBe('s1');
    expect(created).not.toHaveProperty('todoistId');
    expect(deps.setSyncNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'info', message: expect.stringContaining('10:00'),
    }));
  });
});

describe('JOBO Plan group actions', () => {
  const groupDeps = (overrides = {}) => {
    const tasks = overrides.tasks || [];
    const recurringTasks = overrides.recurringTasks || [];
    const deps = {
      tasks,
      recurringTasks,
      setTasks: vi.fn(),
      setRecurringTasks: vi.fn(),
      setRecycleBin: vi.fn(),
      pushUndo: vi.fn(),
      playUISound: vi.fn(),
      onboardingProgress: { hasUsedActionButtons: true },
      ...overrides,
    };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return { actions: useTaskActions(deps), deps };
  };

  it('moves ordinary tasks in one state write, preserving task identity and fields', () => {
    const first = { id: 'first', date: '2026-09-27', startTime: '09:00', duration: 30, notes: 'a', priority: 2 };
    const second = { id: 'second', date: '2026-09-27', startTime: '10:00', duration: 45, notes: 'b', priority: 1 };
    const { actions, deps } = groupDeps({ tasks: [first, second] });
    expect(actions.moveTimelineTasks([first, second], 30)).toBe(true);
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    expect(deps.setTasks).toHaveBeenCalledTimes(1);
    const next = deps.setTasks.mock.calls[0][0]([first, second]);
    expect(next).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'first', startTime: '09:30', notes: 'a', priority: 2 }),
      expect.objectContaining({ id: 'second', startTime: '10:30', notes: 'b', priority: 1 }),
    ]));
  });

  it('resizes an ordinary Plan interval in one write with a fresh version', () => {
    const task = {
      id: 'resize-me', date: '2026-09-27', startTime: '11:45', duration: 10,
      lastModified: '2026-09-27T11:00:00.000Z', notes: 'keep', priority: 2,
    };
    const { actions, deps } = groupDeps({ tasks: [task] });
    expect(actions.resizeTimelineTask(task, { startTime: '11:30', duration: 25 })).toBe(true);
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    expect(deps.setTasks).toHaveBeenCalledTimes(1);
    const next = deps.setTasks.mock.calls[0][0]([task])[0];
    expect(next).toMatchObject({ id: 'resize-me', startTime: '11:30', duration: 25, notes: 'keep', priority: 2 });
    expect(Date.parse(next.lastModified)).toBeGreaterThan(Date.parse(task.lastModified));
  });

  it('rejects a stale Plan shape or an interval outside the civil day', () => {
    const requested = { id: 'resize-me', date: '2026-09-27', startTime: '11:45', duration: 10 };
    const { actions, deps } = groupDeps({
      tasks: [{ ...requested, startTime: '11:40' }],
    });
    expect(actions.resizeTimelineTask(requested, { startTime: '11:30', duration: 25 })).toBe(false);
    const invalid = groupDeps({ tasks: [requested] });
    expect(invalid.actions.resizeTimelineTask(requested, { startTime: '23:50', duration: 20 })).toBe(false);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.setTasks).not.toHaveBeenCalled();
    expect(invalid.deps.pushUndo).not.toHaveBeenCalled();
    expect(invalid.deps.setTasks).not.toHaveBeenCalled();
  });

  it('resizes one recurring occurrence through its date exception only', () => {
    const template = {
      id: 'r-resize', startTime: '09:00', duration: 30,
      lastModified: '2026-09-27T08:00:00.000Z', exceptions: {},
    };
    const occurrence = {
      id: 'recurring-r-resize-2026-09-27', date: '2026-09-27',
      startTime: '11:45', duration: 10, isRecurring: true,
    };
    const { actions, deps } = groupDeps({
      recurringTasks: [{ ...template, exceptions: { '2026-09-27': { startTime: '11:45', duration: 10 } } }],
    });
    expect(actions.resizeTimelineTask(occurrence, { startTime: '11:30', duration: 25 })).toBe(true);
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    const next = deps.setRecurringTasks.mock.calls[0][0](deps.recurringTasks)[0];
    expect(next.startTime).toBe('09:00');
    expect(next.duration).toBe(30);
    expect(next.exceptions['2026-09-27']).toMatchObject({ startTime: '11:30', duration: 25 });
    expect(Date.parse(next.lastModified)).toBeGreaterThan(Date.parse(template.lastModified));
  });

  it('rejects a stale or out-of-range selection before any setter or undo entry', () => {
    const first = { id: 'first', date: '2026-09-27', startTime: '09:00', duration: 30, lastModified: '2026-09-27T09:00:00.000Z' };
    const stale = { ...first, lastModified: '2026-09-27T08:00:00.000Z' };
    const { actions, deps } = groupDeps({ tasks: [first] });
    expect(actions.moveTimelineTasks([stale], 30)).toBe(false);
    expect(actions.moveTimelineTasks([first], 900)).toBe(false);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.setTasks).not.toHaveBeenCalled();
  });

  it('moves and deletes a recurring occurrence by changing only its date exception', () => {
    const template = { id: 'r1', startTime: '09:00', duration: 30, lastModified: '2026-09-27T08:00:00.000Z', exceptions: {} };
    const occurrence = { id: 'recurring-r1-2026-09-27', date: '2026-09-27', startTime: '09:00', duration: 30, isRecurring: true, notes: 'series' };
    const { actions, deps } = groupDeps({ recurringTasks: [template] });
    expect(actions.moveTimelineTasks([occurrence], 45)).toBe(true);
    const movedTemplates = deps.setRecurringTasks.mock.calls[0][0]([template]);
    expect(movedTemplates[0].exceptions['2026-09-27'].startTime).toBe('09:45');
    expect(movedTemplates[0].startTime).toBe('09:00');
    expect(actions.deleteTimelineTasks([occurrence])).toBe(true);
    const deletedTemplates = deps.setRecurringTasks.mock.calls[1][0]([template]);
    expect(deletedTemplates[0].exceptions['2026-09-27'].deleted).toBe(true);
    expect(deletedTemplates[0].recurrence).toBeUndefined();
    expect(deps.setTasks).not.toHaveBeenCalled();
  });

  it('moves ordinary Plans to the existing recycle-bin shape in one operation', () => {
    const task = { id: 'task-1', date: '2026-09-27', startTime: '09:00', duration: 30, notes: 'keep', priority: 3 };
    const { actions, deps } = groupDeps({ tasks: [task] });
    expect(actions.deleteTimelineTasks([task])).toBe(true);
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    expect(deps.setRecycleBin).toHaveBeenCalledTimes(1);
    const bin = deps.setRecycleBin.mock.calls[0][0]([]);
    expect(bin[0]).toMatchObject({ id: 'task-1', notes: 'keep', priority: 3, _deletedFrom: 'calendar' });
    expect(Date.parse(bin[0].deletedAt)).toBeGreaterThanOrEqual(Date.parse(bin[0].lastModified));
    expect(deps.setTasks).toHaveBeenCalledTimes(1);
    expect(deps.setTasks.mock.calls[0][0]([task])).toEqual([]);
  });
});
