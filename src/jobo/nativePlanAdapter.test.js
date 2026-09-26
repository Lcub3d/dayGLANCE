import { describe, expect, it, vi } from 'vitest';
import {
  dropPlan,
  editPlan,
  openNewPlan,
  planCapabilities,
  startPlanDrag,
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
