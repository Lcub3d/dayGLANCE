import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Deadlines belong to INBOX tasks, and scheduling drops them (#2116 review).
//
// The review kept the contract: `deadline` and `priority` stay inbox-only, and
// the inbox/scheduled split is what the rest of the app is built on. What it did
// ask for is that the DROP is not silent — an undo step that starts a schedule
// says the deadline went with it, and the one-tap paths show that as the toast.
//
// useTaskActions is a pure deps-object hook: actions are called directly with
// mocked setters, and the written object is read from the functional updater.
// ─────────────────────────────────────────────────────────────────────────────

const SCHEDULED = { id: 's1', title: 'Ship the report', date: '2026-09-20', startTime: '09:00', duration: 60 };
const INBOX_DEADLINE = { id: 'u1', title: 'Call the plumber', priority: 2, duration: 30, deadline: '2026-09-18' };
const INBOX_PLAIN = { id: 'u2', title: 'Draft the outline', priority: 0, duration: 30 };

function useActionsSetup({ tasks = [], unscheduledTasks = [], newTask = {}, frameScheduleModal = null, computeAvailableSlots = vi.fn(() => []) } = {}) {
  const writes = { tasks: [], unscheduled: [] };
  const undo = [];
  const toasts = [];
  const lists = { tasks, unscheduled: unscheduledTasks };
  const deps = {
    tasks, setTasks: (u) => writes.tasks.push(u),
    unscheduledTasks, setUnscheduledTasks: (u) => writes.unscheduled.push(u),
    recurringTasks: [], setRecurringTasks: vi.fn(),
    recycleBin: [], setRecycleBin: vi.fn(),
    completedTaskUids: new Set(), setCompletedTaskUids: vi.fn(),
    selectedDate: new Date(2026, 8, 18, 9, 0, 0),
    onboardingProgress: { hasAddedDeadline: false }, setOnboardingProgress: vi.fn(),
    pushUndo: vi.fn((label) => { undo.push(label); return `said:${label.key}`; }),
    playUISound: vi.fn(),
    parseRecurringId: () => null,
    getAdjustedTimeForImportedConflicts: (id, requested) =>
      ({ conflicted: false, adjustedStartTime: requested, conflictingEvent: null }),
    newTask, setNewTask: vi.fn(),
    setShowAddTask: vi.fn(), setShowRecurrencePicker: vi.fn(),
    expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
    setSyncNotification: vi.fn(), setUndoToast: vi.fn((t) => toasts.push(t)),
    setShowColorPicker: vi.fn(), setShowDeadlinePicker: vi.fn(),
    recurringDeleteConfirm: null, setRecurringDeleteConfirm: vi.fn(),
    hoverPreviewTime: null, hoverPreviewDate: null,
    setHoverPreviewTime: vi.fn(), setHoverPreviewDate: vi.fn(),
    swipeSchedulingInboxTaskId: { current: null },
    syncTaskCompletionToCalDAV: vi.fn(), computeAvailableSlots,
    activeFrameNudgeKey: null, setFrameNudgeDismissedKey: vi.fn(),
    frameScheduleModal, setFrameScheduleModal: vi.fn(),
    focusBlockTasks: [], setFocusBlockTasks: vi.fn(),
    focusCompletedTasks: new Set(), setFocusCompletedTasks: vi.fn(),
    exitFocusModeRef: { current: null }, playFocusSound: vi.fn(),
    getObsidianTaskMeta: undefined, onWriteObsidianTask: undefined,
  };
  // The updaters are functional (prev => ...), so they apply to the list they
  // were written against, as React would.
  const apply = (updaters, which) => updaters.reduce((acc, u) => (typeof u === 'function' ? u(acc) : u), lists[which]);
  return { actions: useTaskActions(deps), writes, apply, undo, toasts };
}

describe('deadline writes stay on the inbox list', () => {
  it('sets one on an inbox task', () => {
    const { actions, writes, apply } = useActionsSetup({ unscheduledTasks: [{ ...INBOX_DEADLINE }] });
    actions.setDeadline('u1', '2026-10-01');
    expect(writes.tasks).toHaveLength(0);
    expect(apply(writes.unscheduled, 'unscheduled')[0]).toMatchObject({ id: 'u1', deadline: '2026-10-01' });
  });

  it('clears one on an inbox task', () => {
    const { actions, writes, apply } = useActionsSetup({ unscheduledTasks: [{ ...INBOX_DEADLINE }] });
    actions.clearDeadline('u1');
    expect(apply(writes.unscheduled, 'unscheduled')[0].deadline).toBeNull();
  });

  it('postpones one a day', () => {
    const { actions, writes, apply } = useActionsSetup({ unscheduledTasks: [{ ...INBOX_DEADLINE }] });
    actions.postponeDeadlineTask('u1');
    expect(apply(writes.unscheduled, 'unscheduled')[0].deadline).toBe('2026-09-19');
  });

  it('a SCHEDULED id is a no-op: the field is not one a scheduled task has', () => {
    const { actions, writes, apply } = useActionsSetup({ tasks: [{ ...SCHEDULED, deadline: '2026-09-18' }] });
    actions.setDeadline('s1', '2026-10-01');
    actions.clearDeadline('s1');
    actions.postponeDeadlineTask('s1');
    // The deadline writes map the inbox list only, so the scheduled copy is
    // never touched…
    expect(writes.tasks).toHaveLength(0);
    // …and the inbox list it maps comes back with exactly what it had.
    expect(apply(writes.unscheduled, 'unscheduled')).toEqual([]);
  });
});

describe('creating an unscheduled project task carries its deadline', () => {
  // The editor's deadline field is live for a project task kept unscheduled
  // (#2116 review), so the CREATE path has to carry the value too — the inbox
  // flavor always did, the project-inbox one did not.
  const draft = (over = {}) => ({
    title: 'Renew the domain', duration: 30, color: '', startTime: '09:00',
    date: '2026-09-18', isAllDay: false, recurrence: null, priority: 0,
    projectId: 'p1', keepUnscheduled: true, deadline: '2026-09-30', ...over,
  });

  it('keeps the deadline', () => {
    const { actions, writes, apply } = useActionsSetup({ newTask: draft() });
    actions.addTask(false);
    expect(apply(writes.unscheduled, 'unscheduled')[0]).toMatchObject({
      projectId: 'p1', deadline: '2026-09-30',
    });
  });

  it('writes no deadline key when there is none', () => {
    const { actions, writes, apply } = useActionsSetup({ newTask: draft({ deadline: null }) });
    actions.addTask(false);
    expect('deadline' in apply(writes.unscheduled, 'unscheduled')[0]).toBe(false);
  });
});

describe('scheduling drops the deadline and says so', () => {
  it('the SCHED deadline card labels the undo step and toasts the drop', () => {
    const { actions, writes, apply, undo, toasts } = useActionsSetup({ unscheduledTasks: [{ ...INBOX_DEADLINE }] });
    actions.scheduleDeadlineTaskAt('u1', '2026-09-21', '10:00');

    const scheduled = apply(writes.tasks, 'tasks')[0];
    expect(scheduled).toMatchObject({ id: 'u1', date: '2026-09-21', startTime: '10:00' });
    expect('deadline' in scheduled).toBe(false);
    expect('priority' in scheduled).toBe(false);
    expect(apply(writes.unscheduled, 'unscheduled')).toEqual([]);
    expect(undo.map((u) => u.key)).toEqual(['scheduledDroppedDeadline']);
    expect(toasts).toEqual([{ message: 'said:scheduledDroppedDeadline', actionable: true }]);
  });

  it('schedule for today (the overdue card) strips both and toasts the drop', () => {
    const { actions, writes, apply, undo, toasts } = useActionsSetup({ unscheduledTasks: [{ ...INBOX_DEADLINE }] });
    actions.scheduleTaskAtNextSlot('u1', true);
    const scheduled = apply(writes.tasks, 'tasks')[0];
    expect('deadline' in scheduled).toBe(false);
    expect('priority' in scheduled).toBe(false);
    expect(undo.map((u) => u.key)).toEqual(['scheduledDroppedDeadline']);
    expect(toasts.map((t) => t.message)).toEqual(['said:scheduledDroppedDeadline']);
  });

  it('…and says nothing when there was no deadline (no undo step, no toast)', () => {
    const { actions, undo, toasts } = useActionsSetup({ unscheduledTasks: [{ ...INBOX_PLAIN }] });
    actions.scheduleTaskAtNextSlot('u2', true);
    expect(undo).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('placing it in a Frame labels the same drop', () => {
    const frameScheduleModal = {
      frameId: 'f1', dateStr: '2026-09-21',
      frame: { id: 'f1', label: 'Deep work', start: '09:00', end: '12:00' },
    };
    const { actions, undo } = useActionsSetup({
      unscheduledTasks: [{ ...INBOX_DEADLINE }],
      frameScheduleModal,
      computeAvailableSlots: () => [{ start: '09:00', minutes: 120 }],
    });
    actions.manuallyScheduleTask('u1');
    expect(undo.map((u) => u.key)).toEqual(['scheduledDroppedDeadline']);
  });

  it('a task with no deadline keeps the plain label', () => {
    const frameScheduleModal = {
      frameId: 'f1', dateStr: '2026-09-21',
      frame: { id: 'f1', label: 'Deep work', start: '09:00', end: '12:00' },
    };
    const { actions, undo } = useActionsSetup({
      unscheduledTasks: [{ ...INBOX_PLAIN }],
      frameScheduleModal,
      computeAvailableSlots: () => [{ start: '09:00', minutes: 120 }],
    });
    actions.manuallyScheduleTask('u2');
    expect(undo.map((u) => u.key)).toEqual(['scheduled']);
  });
});
