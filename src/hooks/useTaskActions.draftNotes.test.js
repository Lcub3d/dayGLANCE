import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { applyDraftEdit } from '../utils/taskModalNotes.js';
import { TASK_COLORS } from '../utils/colorUtils.js';

// A new task's notes and subtasks, written in the modal's panel before the
// task exists, are saved with it. Walks the draft as the panel writes it,
// then Add, and reads the row the app stores.
const DAY = '2026-10-02';

function build(newTask) {
  const setTasks = vi.fn();
  const setUnscheduledTasks = vi.fn();
  const setRecurringTasks = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = useTaskActions({
    tasks: [], setTasks, unscheduledTasks: [], setUnscheduledTasks,
    recurringTasks: [], setRecurringTasks,
    selectedDate: new Date(`${DAY}T12:00:00`), newTask, setNewTask: vi.fn(), setShowAddTask: vi.fn(),
    pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(), setSyncNotification: vi.fn(),
    getAdjustedTimeForImportedConflicts: (_id, startTime) => ({ conflicted: false, adjustedStartTime: startTime, conflictingEvent: null }),
    onboardingProgress: { hasAddedScheduledTask: true, hasAddedInboxTask: true, hasUsedTags: true, hasCreatedRecurring: true },
    setOnboardingProgress: vi.fn(), swipeSchedulingInboxTaskId: { current: null },
    colors: TASK_COLORS, getNextQuarterHour: () => '09:00', parseRecurringId: () => null,
  });
  const stored = (setter) => setter.mock.calls[0][0]([]).at(-1);
  return { actions, stored: () => stored(setTasks), storedInbox: () => stored(setUnscheduledTasks), storedTemplate: () => stored(setRecurringTasks) };
}

const written = () => {
  let form = { title: 'Write the report', startTime: '10:00', duration: 30, date: DAY, isAllDay: false, recurrence: null, notesDraftKey: 'k' };
  form = applyDraftEdit(form, 'k', { type: 'notes', notes: 'Outline **first**' });
  form = applyDraftEdit(form, 'k', { type: 'addSubtask', subtask: { id: 'st1', title: 'Gather figures', completed: false } });
  return form;
};
const expected = { notes: 'Outline **first**', subtasks: [{ id: 'st1', title: 'Gather figures', completed: false }] };

describe('a new task keeps what was written in the modal\'s notes panel', () => {
  // MUTATION: put back `notes: ''` in addTask and each of these fails.
  it('scheduled', () => {
    const { actions, stored } = build(written());
    actions.addTask(false);
    expect(stored()).toMatchObject({ title: 'Write the report', ...expected });
    expect(stored()).not.toHaveProperty('notesDraftKey');
  });

  it('to the Inbox', () => {
    const { actions, storedInbox } = build(written());
    actions.addTask(true);
    expect(storedInbox()).toMatchObject(expected);
  });

  it('as a recurring series', () => {
    const { actions, storedTemplate } = build({ ...written(), recurrence: { type: 'daily', interval: 1 } });
    actions.addTask(false);
    expect(storedTemplate()).toMatchObject(expected);
  });

  it('with nothing written, empty as before', () => {
    const { actions, stored } = build({ title: 'Plain', startTime: '10:00', duration: 30, date: DAY, isAllDay: false });
    actions.addTask(false);
    expect(stored()).toMatchObject({ notes: '', subtasks: [] });
  });
});
