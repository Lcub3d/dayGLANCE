import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { adjustPastConflicts } from '../utils/dayOccupancy.js';
import { TASK_COLORS } from '../utils/colorUtils.js';

// A refused or slid placement names what it hit. The adjuster is the real one
// over a real imported event, so the message and the obstacle shape it reads
// cannot drift apart again (they did: obstacles carry `label`, the messages
// read `title`, and printed "undefined" or never named the event).
const DAY = '2026-10-02';
const standup = { id: 'ev', title: 'Standup', date: DAY, startTime: '10:00', duration: 30, imported: true, isAllDay: false };
const noRoutines = { routines: [], routinesDate: DAY, routineCompletions: {}, routinesEnabled: false, todayDate: DAY };
const realAdjuster = events => (taskId, startTime, duration, date) => adjustPastConflicts(noRoutines, date, {
  startTime, duration, excludeId: taskId, tasks: events.filter(t => t.date === date && t.imported && !t.isAllDay),
});

function build({ tasks = [], newTask = {}, events = [standup] } = {}) {
  const setSyncNotification = vi.fn();
  const setTasks = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = useTaskActions({
    tasks: [...tasks, ...events], setTasks, unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    recurringTasks: [], setRecurringTasks: vi.fn(),
    selectedDate: new Date(`${DAY}T12:00:00`), newTask, setNewTask: vi.fn(), setShowAddTask: vi.fn(),
    pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(), setSyncNotification,
    getAdjustedTimeForImportedConflicts: realAdjuster(events),
    onboardingProgress: { hasUsedActionButtons: true, hasAddedScheduledTask: true, hasUsedTags: true, hasDraggedToTimeline: true },
    setOnboardingProgress: vi.fn(), swipeSchedulingInboxTaskId: { current: null },
    colors: TASK_COLORS, getNextQuarterHour: () => '09:00', parseRecurringId: () => null,
  });
  return { actions, setSyncNotification, setTasks };
}

describe('conflict messages name the event', () => {
  it('Postpone names the event it refused for', () => {
    const task = { id: 't1', title: 'Write', date: '2026-10-01', startTime: '10:00', duration: 60 };
    const { actions, setSyncNotification, setTasks } = build({ tasks: [task] });
    actions.postponeTask('t1');
    expect(setTasks).not.toHaveBeenCalled();
    expect(setSyncNotification).toHaveBeenCalledTimes(1);
    expect(setSyncNotification.mock.calls[0][0].message).toBe(`Time slot conflicts with "Standup" on ${DAY}`);
  });

  it('a new task slid past an event names it', () => {
    const { actions, setSyncNotification } = build({
      newTask: { title: 'Write', startTime: '10:00', duration: 30, date: DAY, isAllDay: false },
    });
    actions.addTask(false);
    expect(setSyncNotification).toHaveBeenCalledTimes(1);
    const { message } = setSyncNotification.mock.calls[0][0];
    expect(message).toBe('Task moved to 10:30 to avoid conflict with "Standup"');
    expect(message).not.toContain('undefined');
  });
});
