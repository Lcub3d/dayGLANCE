import { describe, expect, it, vi } from 'vitest';
import {
  copyPlan,
  createQuickPlan,
  dropPlan,
  editPlan,
  openNewPlan,
  planCapabilities,
  startPlanDrag,
  startPlanResize,
  togglePlanCompletion,
  writeDailyNotes,
  writePlanNotes,
} from './nativePlanAdapter.js';

const task = (overrides = {}) => ({
  id: 'task-1',
  title: 'Plan',
  imported: false,
  isTaskCalendar: false,
  ...overrides,
});

const item = (overrides = {}) => ({
  currentTask: task(),
  historical: false,
  ...overrides,
});

describe('planCapabilities', () => {
  it('disables all native operations for historical snapshots', () => {
    expect(planCapabilities(item({ historical: true }))).toEqual({
      editable: false,
      draggable: false,
      completable: false,
    });
    expect(planCapabilities({
      task: task(),
      historical: true,
    })).toEqual({
      editable: false,
      draggable: false,
      completable: false,
    });
  });

  it('matches main imported and calendar-task permissions', () => {
    expect(planCapabilities(item({ currentTask: task({ imported: true }) }))).toEqual({
      editable: false,
      draggable: false,
      completable: false,
    });
    expect(planCapabilities(item({ currentTask: task({ imported: true, isTaskCalendar: true }) }))).toEqual({
      editable: false,
      draggable: true,
      completable: true,
    });
    expect(planCapabilities(item({ currentTask: task({ imported: true, nativeEventId: 42 }) }))).toEqual({
      editable: true,
      draggable: true,
      completable: false,
    });
  });
});

describe('native Plan operations', () => {
  it('creates a quick Plan through the explicit native task handler without opening the modal', () => {
    const createTimelineTask = vi.fn((draft) => ({ ...draft, id: 'created-plan' }));
    const ctx = { createTimelineTask, setNewTask: vi.fn(), setShowAddTask: vi.fn(), addTask: vi.fn() };
    const result = createQuickPlan(ctx, {
      date: '2026-09-26', startTime: '09:15', duration: 45, title: '',
    });
    expect(result.id).toBe('created-plan');
    expect(result.task).toMatchObject({
      id: 'created-plan', title: '', date: '2026-09-26', startTime: '09:15',
      duration: 45, isAllDay: false, completed: false,
    });
    expect(createTimelineTask).toHaveBeenCalledWith(expect.objectContaining({
      title: '', date: '2026-09-26', startTime: '09:15', duration: 45,
    }));
    expect(ctx.setNewTask).not.toHaveBeenCalled();
    expect(ctx.setShowAddTask).not.toHaveBeenCalled();
    expect(ctx.addTask).not.toHaveBeenCalled();
  });

  it('copies a live Plan through the explicit timeline task handler', () => {
    const source = task({
      id: 'recurring-instance:2026-09-26', title: 'Review report', date: '2026-09-26',
      startTime: '09:00', duration: 60, completed: true,
      completedAt: '2026-09-26T10:00:00.000Z', recurringTemplateId: 'routine-1',
      recurrence: { type: 'daily' }, isRecurring: true, exceptions: { old: true },
      color: 'bg-blue-500', notes: 'Keep context', subtasks: [{ id: 's1', title: 'Done', completed: true }],
      projectId: 'project-1', assignedUserSyncIds: ['user-1'], priority: 2,
    });
    const createTimelineTask = vi.fn((draft) => ({ ...draft, id: 'plan-copy' }));
    const result = copyPlan({ createTimelineTask }, item({ currentTask: source }), {
      date: '2026-09-27', startTime: '11:30', duration: 30,
    });
    expect(result.id).toBe('plan-copy');
    expect(createTimelineTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Review report', date: '2026-09-27', startTime: '11:30', duration: 30,
      completed: false, isAllDay: false,
    }));
    const draft = createTimelineTask.mock.calls[0][0];
    expect(draft.id).not.toBe(source.id);
    expect(draft).not.toHaveProperty('recurrence');
    expect(draft).not.toHaveProperty('recurringTemplateId');
    expect(draft).not.toHaveProperty('exceptions');
    expect(draft).not.toHaveProperty('completedAt');
    expect(draft).not.toHaveProperty('todoistId');
    expect(draft).not.toHaveProperty('nativeEventId');
    expect(draft).toMatchObject({
      color: 'bg-blue-500', notes: 'Keep context', subtasks: [{ title: 'Done', completed: false }],
      projectId: 'project-1', assignedUserSyncIds: ['user-1'], priority: 2,
    });
    expect(draft.subtasks[0].id).not.toBe('s1');
    expect(source.completed).toBe(true);
  });

  it('rejects historical Plan copies without invoking a native handler', () => {
    const createTimelineTask = vi.fn();
    expect(copyPlan({ createTimelineTask }, item({ historical: true }), {
      date: '2026-09-26', startTime: '09:00', duration: 30,
    })).toBe(false);
    expect(createTimelineTask).not.toHaveBeenCalled();
  });

  it('treats a missing native task result as a failed create', () => {
    const createTimelineTask = vi.fn();
    expect(createQuickPlan({ createTimelineTask }, {
      date: '2026-09-26', startTime: '09:00', duration: 30,
    })).toBe(false);
  });

  it('opens a new Plan with the exact native editor shape', () => {
    const ctx = { setNewTask: vi.fn(), setShowAddTask: vi.fn() };
    expect(openNewPlan(ctx, '2026-09-26', '09:15')).toBe(true);
    expect(ctx.setNewTask).toHaveBeenCalledWith({
      title: '', startTime: '09:15', duration: 30,
      date: '2026-09-26', isAllDay: false,
    });
    expect(ctx.setShowAddTask).toHaveBeenCalledWith(true);
  });

  it('selects the native-event editor and passes the task unchanged', () => {
    const native = task({ imported: true, nativeEventId: 'event-7' });
    const ctx = { openMobileEditNativeEvent: vi.fn(), openMobileEditTask: vi.fn() };
    expect(editPlan(ctx, item({ currentTask: native }))).toBe(true);
    expect(ctx.openMobileEditNativeEvent).toHaveBeenCalledWith(native);
    expect(ctx.openMobileEditTask).not.toHaveBeenCalled();
  });

  it('uses the native task editor with inbox=false for ordinary Plans', () => {
    const live = task({ id: 'recurring-template:2026-09-26' });
    const ctx = { openMobileEditTask: vi.fn() };
    expect(editPlan(ctx, item({ currentTask: live }))).toBe(true);
    expect(ctx.openMobileEditTask).toHaveBeenCalledWith(live, false);
  });

  it('preserves recurring IDs and delegates completion to main', () => {
    const id = 'recurring-template:2026-09-26';
    const ctx = { toggleComplete: vi.fn(), recordJobo: vi.fn() };
    expect(togglePlanCompletion(ctx, item({ currentTask: task({ id }) }))).toBe(true);
    expect(ctx.toggleComplete).toHaveBeenCalledWith(id, false);
    expect(ctx.recordJobo).not.toHaveBeenCalled();
  });

  it('starts and drops through main with exact calendar arguments', () => {
    const event = { dataTransfer: { effectAllowed: '' } };
    const ctx = { handleDragStart: vi.fn(), handleDropOnCalendar: vi.fn() };
    const live = item({ currentTask: task({ id: 'recurring-template:2026-09-26' }) });
    expect(startPlanDrag(ctx, live, event)).toBe(true);
    expect(ctx.handleDragStart).toHaveBeenCalledWith(live.currentTask, 'calendar', event);
    expect(dropPlan(ctx, event, '2026-09-26', '10:30')).toBe(true);
    expect(ctx.handleDropOnCalendar).toHaveBeenCalledWith(event, '2026-09-26', '10:30');
  });

  it('starts mouse Plan resize with the JOBO scale and preserves the native task', () => {
    const event = { clientY: 120, stopPropagation: vi.fn() };
    const native = task({ id: 'recurring-template:2026-09-26', isRecurring: true });
    const ctx = { handleResizeStart: vi.fn(), handleTouchResizeStart: vi.fn() };
    expect(startPlanResize(ctx, item({ currentTask: native }), event, 52)).toBe(true);
    expect(ctx.handleResizeStart).toHaveBeenCalledWith(native, event, 52);
    expect(ctx.handleTouchResizeStart).not.toHaveBeenCalled();
  });

  it('starts touch Plan resize and defaults the scale to 80 pixels per hour', () => {
    const event = { touches: [{ clientY: 120 }], stopPropagation: vi.fn() };
    const native = task({ imported: true, nativeEventId: 'event-7' });
    const ctx = { handleResizeStart: vi.fn(), handleTouchResizeStart: vi.fn() };
    expect(startPlanResize(ctx, item({ currentTask: native }), event, undefined, { touch: true })).toBe(true);
    expect(ctx.handleTouchResizeStart).toHaveBeenCalledWith(native, event, 80);
    expect(ctx.handleResizeStart).not.toHaveBeenCalled();
  });

  it('rejects historical and imported Plans without editable native access', () => {
    const ctx = { handleResizeStart: vi.fn(), handleTouchResizeStart: vi.fn() };
    const event = {};
    expect(startPlanResize(ctx, item({ historical: true }), event, 52)).toBe(false);
    expect(startPlanResize(ctx, item({ currentTask: task({ imported: true }) }), event, 52)).toBe(false);
    expect(ctx.handleResizeStart).not.toHaveBeenCalled();
    expect(ctx.handleTouchResizeStart).not.toHaveBeenCalled();
  });
});

describe('native Plan note writes', () => {
  it('blocks imported notes and leaves main untouched', () => {
    const ctx = { updateTaskNotes: vi.fn() };
    expect(writePlanNotes(ctx, task({ imported: true }), 'secret')).toBe(false);
    expect(ctx.updateTaskNotes).not.toHaveBeenCalled();
  });

  it('writes ordinary and inbox notes through main with the supplied ID', () => {
    const ctx = { updateTaskNotes: vi.fn() };
    const live = task({ id: 'recurring-template:2026-09-26' });
    expect(writePlanNotes(ctx, live, 'body')).toBe(true);
    expect(writePlanNotes(ctx, live, 'inbox body', true)).toBe(true);
    expect(ctx.updateTaskNotes).toHaveBeenNthCalledWith(1, live.id, 'body', false);
    expect(ctx.updateTaskNotes).toHaveBeenNthCalledWith(2, live.id, 'inbox body', true);
  });

  it('writes daily notes through main', () => {
    const ctx = { updateDailyNote: vi.fn() };
    expect(writeDailyNotes(ctx, '2026-09-26', 'Daily review')).toBe(true);
    expect(ctx.updateDailyNote).toHaveBeenCalledWith('2026-09-26', 'Daily review');
  });
});

describe('unauthorized operations', () => {
  it('return false without invoking handlers', () => {
    const ctx = {
      openMobileEditTask: vi.fn(),
      toggleComplete: vi.fn(),
      handleDragStart: vi.fn(),
      updateTaskNotes: vi.fn(),
    };
    const historical = item({ historical: true });
    expect(editPlan(ctx, historical)).toBe(false);
    expect(togglePlanCompletion(ctx, historical)).toBe(false);
    expect(startPlanDrag(ctx, historical, {})).toBe(false);
    expect(writePlanNotes(ctx, task({ imported: true }), 'x')).toBe(false);
    expect(editPlan(ctx, item({ currentTask: task({ imported: true }) }))).toBe(false);
    expect(togglePlanCompletion(ctx, item({ currentTask: task({ imported: true }) }))).toBe(false);
    expect(startPlanDrag(ctx, item({ currentTask: task({ imported: true }) }), {})).toBe(false);
    expect(ctx.openMobileEditTask).not.toHaveBeenCalled();
    expect(ctx.toggleComplete).not.toHaveBeenCalled();
    expect(ctx.handleDragStart).not.toHaveBeenCalled();
    expect(ctx.updateTaskNotes).not.toHaveBeenCalled();
  });
});
