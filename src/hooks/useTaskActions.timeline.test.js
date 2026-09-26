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
