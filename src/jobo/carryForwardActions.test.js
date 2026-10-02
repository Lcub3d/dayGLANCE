import { describe, expect, it, vi } from 'vitest';
import { createCarryForwardActions } from './carryForwardActions.js';
import { CARRY_ACTION } from './carryForward.js';
import { stampDeferrals } from '../utils/deferrals.js';
import { stampPlanTrail } from '../utils/planTrail.js';

const date = '2026-09-28';
const task = { id: 't1', title: 'Report #work', date, startTime: '09:00', duration: 60, color: 'bg-green-500', completed: false, notes: 'n', projectId: 'p1' };
const action = { kind: CARRY_ACTION.CONTINUE, task, slot: { date: '2026-10-01', startTime: '09:00', duration: 45, isAllDay: false } };

function setup(over = {}) {
  let tasks = over.tasks || [task];
  let newTask = { title: 'stale' };
  const input = over.input ?? null;
  const deps = {
    tasks,
    setTasks: vi.fn(update => { tasks = update(tasks); }),
    pushUndo: vi.fn(),
    getAdjustedTimeForImportedConflicts: vi.fn(() => ({ conflicted: false, adjustedStartTime: '09:00', conflictingEvent: null })),
    playUISound: vi.fn(),
    openMobileEditTask: vi.fn(edited => { newTask = { title: edited.title, date: edited.date, keepUnscheduled: !!(edited.projectId && !edited.date) }; }),
    setNewTask: vi.fn(update => { newTask = typeof update === 'function' ? update(newTask) : update; }),
    setShowAddTask: vi.fn(),
    setMobileEditingTask: vi.fn(),
    swipeSchedulingInboxTaskId: { current: 'inbox-1' },
    getNextQuarterHour: () => '14:15',
    newTaskInputRef: { current: input },
    projects: [{ id: 'p1', status: 'active' }],
    schedule: callback => callback(),
    moveToInbox: vi.fn(),
    moveToRecycleBin: vi.fn(),
    ...over.deps,
  };
  return { deps, actions: createCarryForwardActions(deps), tasks: () => tasks, newTask: () => newTask };
}

describe('continueTask', () => {
  it('moves the task to the slot as one undo step, and nothing else about it', () => {
    const { deps, actions, tasks } = setup();
    expect(actions.continueTask(action, date)).toEqual({ moved: true });
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    expect(deps.pushUndo.mock.invocationCallOrder[0]).toBeLessThan(deps.setTasks.mock.invocationCallOrder[0]);
    expect(tasks()).toEqual([{ ...task, date: '2026-10-01', startTime: '09:00', duration: 45 }]);
    expect(deps.getAdjustedTimeForImportedConflicts).toHaveBeenCalledWith('t1', '09:00', 45, '2026-10-01');
  });

  it('refuses a slot that clashes with an imported event, as Postpone does, and moves nothing', () => {
    const { deps, actions, tasks } = setup({ deps: {
      getAdjustedTimeForImportedConflicts: vi.fn(() => ({ conflicted: true, adjustedStartTime: '10:00', conflictingEvent: { start: 600, end: 630, label: 'Standup', id: 'ev' } })),
    } });
    expect(actions.continueTask(action, date)).toEqual({ conflict: { title: 'Standup' } });
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.setTasks).not.toHaveBeenCalled();
    expect(deps.playUISound).toHaveBeenCalledWith('error');
    expect(tasks()).toEqual([task]);
  });

  it.each([
    ['completed since', { completed: true }],
    ['moved since', { date: '2026-09-30' }],
  ])('does nothing for a task %s the button was drawn', (_, patch) => {
    const { deps, actions } = setup({ tasks: [{ ...task, ...patch }] });
    expect(actions.continueTask(action, date)).toEqual({ stale: true });
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.setTasks).not.toHaveBeenCalled();
  });

  it('does nothing for a task deleted since', () => {
    const { deps, actions } = setup({ tasks: [] });
    expect(actions.continueTask(action, date)).toEqual({ stale: true });
    expect(deps.setTasks).not.toHaveBeenCalled();
  });

  it('does not check an all-day continuation against timed events', () => {
    const allDay = { ...task, isAllDay: true, startTime: '00:00', duration: 30 };
    const { deps, actions, tasks } = setup({ tasks: [allDay] });
    const result = actions.continueTask({ ...action, task: allDay, slot: { date: '2026-10-01', startTime: '00:00', duration: 30, isAllDay: true } }, date);
    expect(result).toEqual({ moved: true });
    expect(deps.getAdjustedTimeForImportedConflicts).not.toHaveBeenCalled();
    expect(tasks()[0]).toMatchObject({ date: '2026-10-01', isAllDay: true });
  });

  it('is counted as a deferral and recorded in the plan trail by the persist pass, unchanged', () => {
    const { actions, tasks } = setup();
    const before = tasks();
    actions.continueTask(action, date);
    const now = new Date(2026, 8, 30, 18, 0);
    const counted = stampDeferrals(tasks(), before, now, '2026-09-30');
    expect(counted[0].deferrals).toBe(1);
    const trailed = stampPlanTrail(tasks(), before, now, '2026-09-30');
    expect(trailed[0].planTrail).toHaveLength(1);
    expect(trailed[0].planTrail[0]).toMatchObject({ date: '2026-10-01', startTime: '09:00' });
  });
});

describe('editOn', () => {
  it('opens the task\'s own editor on the given day, not as an Inbox edit', () => {
    const { deps, actions, newTask } = setup();
    actions.editOn(task, '2026-10-01');
    expect(deps.openMobileEditTask).toHaveBeenCalledWith(task, false);
    expect(newTask()).toMatchObject({ date: '2026-10-01', keepUnscheduled: false });
    expect(deps.swipeSchedulingInboxTaskId.current).toBeNull();
  });

  it('turns an unscheduled project task\'s editor into a scheduling one', () => {
    const { actions, newTask } = setup();
    actions.editOn({ ...task, date: null, startTime: null }, '2026-10-01');
    expect(newTask()).toMatchObject({ date: '2026-10-01', keepUnscheduled: false });
  });
});

describe('openFollowUp', () => {
  it('opens a new task, pre-filled, starting unscheduled in the project', () => {
    const { deps, actions, newTask } = setup();
    actions.openFollowUp({ ...task, completed: true }, '2026-10-01');
    expect(deps.setMobileEditingTask).toHaveBeenCalledWith(null);
    expect(deps.swipeSchedulingInboxTaskId.current).toBeNull();
    expect(deps.setShowAddTask).toHaveBeenCalledWith(true);
    expect(newTask()).toEqual({
      title: ' #work', color: 'bg-green-500', projectId: 'p1', keepUnscheduled: true,
      startTime: '14:15', duration: 30, date: '2026-10-01', isAllDay: false, recurrence: null,
    });
  });

  it('places the caret before the tags once the form has focused its title', () => {
    const input = { setSelectionRange: vi.fn() };
    input.ownerDocument = { activeElement: input };
    const { actions } = setup({ input });
    actions.openFollowUp({ ...task, completed: true }, '2026-10-01');
    expect(input.setSelectionRange).toHaveBeenCalledWith(0, 0);
  });

  it('does not take focus the form did not give its title', () => {
    const input = { setSelectionRange: vi.fn(), ownerDocument: { activeElement: null } };
    const { actions } = setup({ input });
    actions.openFollowUp({ ...task, completed: true }, '2026-10-01');
    expect(input.setSelectionRange).not.toHaveBeenCalled();
  });
});

// Tasks not started (the addendum in docs/jobo-carry-forward.md): moved off
// the timeline or deleted through the app's own actions, each of which
// pushes its own undo step.
describe.each([
  ['unscheduleTask', 'moveToInbox', { moved: true }],
  ['deleteTask', 'moveToRecycleBin', { deleted: true }],
])('%s', (name, appAction, done) => {
  it(`goes through the app's ${appAction}`, () => {
    const { deps, actions } = setup();
    expect(actions[name](task, date)).toEqual(done);
    expect(deps[appAction]).toHaveBeenCalledWith('t1');
    expect(deps.setTasks).not.toHaveBeenCalled();
  });
  it.each([
    ['completed since', [{ ...task, completed: true }]],
    ['moved since', [{ ...task, date: '2026-09-30' }]],
    ['deleted since', []],
    ['owned by its calendar', [{ ...task, imported: true, isTaskCalendar: true }]],
  ])('does nothing for a task %s', (_, tasks) => {
    const { deps, actions } = setup({ tasks });
    expect(actions[name](task, date)).toEqual({ stale: true });
    expect(deps[appAction]).not.toHaveBeenCalled();
  });
});

