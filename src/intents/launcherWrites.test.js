import { beforeEach, describe, expect, it } from 'vitest';
import { handleLauncherIntent, recordHandled, LAUNCHER_LEDGER_LIMIT, findHandled } from './launcherWrites.js';

// Launcher writes (intents/launcherWrites.js): each carries a client id, a
// re-sent id is acknowledged from the ledger and never applied twice, CREATE
// stamps the id on the task it made, and COMPLETE names the task by id.

// A tiny state the setters mutate the way React's functional updaters do.
function makeContext(initial = {}) {
  const state = { tasks: initial.tasks || [], unscheduledTasks: initial.unscheduledTasks || [], recurringTasks: [] };
  const ctx = {
    get tasks() { return state.tasks; },
    get unscheduledTasks() { return state.unscheduledTasks; },
    recurringTasks: [], projects: [], goals: [],
    setTasks: (f) => { state.tasks = f(state.tasks); },
    setUnscheduledTasks: (f) => { state.unscheduledTasks = f(state.unscheduledTasks); },
    setRecurringTasks: (f) => { state.recurringTasks = f(state.recurringTasks); },
  };
  return { ctx, state };
}

let ledger;
const io = () => ({ ledger, persist: (next) => { ledger = next; } });
beforeEach(() => { ledger = []; });

describe('handleLauncherIntent', () => {
  it('CREATE makes the task, stamps the client id on it, and records the id', async () => {
    const { ctx, state } = makeContext();
    const r = await handleLauncherIntent(
      { action: 'com.dayglance.app.launcher.CREATE', payload: { title: 'Call dentist', due: '2026-10-21T14:00:00-06:00' }, clientId: 'w-1' },
      ctx, io(),
    );
    expect(r.success).toBe(true);
    const made = state.tasks.find(t => t.id === r.task_id);
    expect(made).toMatchObject({ title: 'Call dentist', clientId: 'w-1' });
    expect(findHandled(ledger, 'w-1')).toMatchObject({ clientId: 'w-1', action: 'create', taskId: r.task_id });
  });

  // MUTATION: skip the ledger check and this fails (two tasks).
  it('a re-sent CREATE is acknowledged from the ledger, not applied again', async () => {
    const { ctx, state } = makeContext();
    const intent = { action: 'com.dayglance.app.launcher.CREATE', payload: { title: 'Call dentist' }, clientId: 'w-1' };
    const first = await handleLauncherIntent(intent, ctx, io());
    const again = await handleLauncherIntent(intent, ctx, io());
    expect(again).toMatchObject({ success: true, deduped: true, task_id: first.task_id });
    expect(state.tasks.length + state.unscheduledTasks.length).toBe(1);
  });

  it('COMPLETE by id completes once and is idempotent after that', async () => {
    const { ctx, state } = makeContext({ tasks: [{ id: 't1', title: 'Groceries', date: '2026-10-19', completed: false }] });
    const done = await handleLauncherIntent(
      { action: 'com.dayglance.app.launcher.COMPLETE', payload: { task_id: 't1', completed_at: '2026-10-19T18:00:00Z' }, clientId: 'w-2' }, ctx, io(),
    );
    expect(done).toMatchObject({ success: true, task_id: 't1' });
    expect(state.tasks[0]).toMatchObject({ completed: true, completedAt: '2026-10-19T18:00:00Z' });
    // Same write re-sent: from the ledger. A new write for a done task: no-op, still success.
    expect(await handleLauncherIntent({ action: 'com.dayglance.app.launcher.COMPLETE', payload: { task_id: 't1' }, clientId: 'w-2' }, ctx, io())).toMatchObject({ deduped: true });
    expect(await handleLauncherIntent({ action: 'com.dayglance.app.launcher.COMPLETE', payload: { task_id: 't1' }, clientId: 'w-3' }, ctx, io())).toMatchObject({ success: true, warning: 'already completed' });
  });

  it('COMPLETE by id reaches the Inbox too, and fails cleanly for an unknown id', async () => {
    const { ctx, state } = makeContext({ unscheduledTasks: [{ id: 'i1', title: 'Renew passport', completed: false }] });
    expect(await handleLauncherIntent({ action: 'com.dayglance.app.launcher.COMPLETE', payload: { task_id: 'i1' }, clientId: 'w-4' }, ctx, io())).toMatchObject({ success: true });
    expect(state.unscheduledTasks[0].completed).toBe(true);
    const missing = await handleLauncherIntent({ action: 'com.dayglance.app.launcher.COMPLETE', payload: { task_id: 'nope' }, clientId: 'w-5' }, ctx, io());
    expect(missing).toMatchObject({ success: false, error: 'no such task' });
    // Recorded with its error, so the launcher sees the id and drops its optimistic change at once.
    expect(findHandled(ledger, 'w-5')).toMatchObject({ error: 'no such task', taskId: null });
    expect(await handleLauncherIntent({ action: 'com.dayglance.app.launcher.COMPLETE', payload: { task_id: 'nope' }, clientId: 'w-5' }, ctx, io()))
      .toEqual({ success: false, error: 'no such task', deduped: true });
  });

  it('COMPLETE with a title falls back to the automation matcher', async () => {
    const { ctx, state } = makeContext({ tasks: [{ id: 't1', title: 'Feed cat', date: '2026-10-19', completed: false }] });
    const r = await handleLauncherIntent({ action: 'com.dayglance.app.launcher.COMPLETE', payload: { title: 'Feed cat' }, clientId: 'w-6' }, ctx, io());
    expect(r).toMatchObject({ success: true, task_id: 't1' });
    expect(state.tasks[0].completed).toBe(true);
  });

  it('refuses a write without a client id or with an unknown action', async () => {
    const { ctx } = makeContext();
    expect(await handleLauncherIntent({ action: 'com.dayglance.app.launcher.CREATE', payload: { title: 'x' } }, ctx, io())).toMatchObject({ success: false, error: 'clientId required' });
    expect(await handleLauncherIntent({ action: 'app.dayglance.CREATE', payload: { title: 'x' }, clientId: 'w-7' }, ctx, io())).toMatchObject({ success: false });
  });
});

describe('recordHandled', () => {
  it('keeps one entry per id, newest last, and stays bounded', () => {
    let l = recordHandled([], { clientId: 'a', action: 'create' });
    l = recordHandled(l, { clientId: 'b', action: 'complete' });
    l = recordHandled(l, { clientId: 'a', action: 'create', taskId: 't' });
    expect(l.map(h => h.clientId)).toEqual(['b', 'a']);
    for (let i = 0; i < LAUNCHER_LEDGER_LIMIT + 5; i++) l = recordHandled(l, { clientId: `x${i}`, action: 'create' });
    expect(l.length).toBe(LAUNCHER_LEDGER_LIMIT);
    expect(l[l.length - 1].clientId).toBe(`x${LAUNCHER_LEDGER_LIMIT + 4}`);
  });

  describe('the dial gestures (second cut)', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const write = (action, payload, clientId) => ({ action: `com.dayglance.app.launcher.${action}`, payload, clientId });

    it('MOVE puts a block on a new date and time, and postpones an all-day task whole', async () => {
      const { ctx, state } = makeContext({ tasks: [
        { id: 't1', title: 'Run', date: '2026-10-19', startTime: '07:45', duration: 45, isAllDay: false },
        { id: 'a1', title: 'Pay bill', date: '2026-10-19', startTime: '00:00', duration: 0, isAllDay: true },
      ] });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 't1', date: '2026-10-20', start: '09:00' }, 'w-m1'), ctx, io())).toMatchObject({ success: true, task_id: 't1' });
      expect(state.tasks[0]).toMatchObject({ date: '2026-10-20', startTime: '09:00', isAllDay: false, duration: 45 });
      expect(state.tasks[0].lastModified).toBeTruthy();
      // Date only: a timed block keeps its time, an all-day task stays all-day.
      expect(await handleLauncherIntent(write('MOVE', { task_id: 't1', date: '2026-10-22' }, 'w-m2'), ctx, io())).toMatchObject({ success: true });
      expect(state.tasks[0]).toMatchObject({ date: '2026-10-22', startTime: '09:00' });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 'a1', date: '2026-10-23' }, 'w-m3'), ctx, io())).toMatchObject({ success: true });
      expect(state.tasks[1]).toMatchObject({ date: '2026-10-23', isAllDay: true, startTime: '00:00' });
    });

    it('MOVE schedules an Inbox task, dropping its inbox-only fields as the app does', async () => {
      const { ctx, state } = makeContext({ unscheduledTasks: [{ id: 'i1', title: 'Call dentist', duration: 15, priority: 2, deadline: '2026-10-25' }] });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 'i1', date: '2026-10-20' }, 'w-m4'), ctx, io())).toMatchObject({ success: false, error: expect.stringContaining('start time') });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 'i1', date: '2026-10-20', start: '14:00' }, 'w-m5'), ctx, io())).toMatchObject({ success: true, task_id: 'i1' });
      expect(state.unscheduledTasks).toEqual([]);
      expect(state.tasks[0]).toMatchObject({ id: 'i1', date: '2026-10-20', startTime: '14:00', duration: 15, isAllDay: false });
      expect(state.tasks[0]).not.toHaveProperty('priority');
      expect(state.tasks[0]).not.toHaveProperty('deadline');
    });

    it('MOVE and RESIZE validate their payloads and refuse what the app refuses, recording the refusal', async () => {
      const { ctx, state } = makeContext({ tasks: [
        { id: 't1', title: 'Run', date: '2026-10-19', startTime: '07:45', duration: 45 },
        { id: 'e1', title: 'Standup', date: '2026-10-19', startTime: '10:00', duration: 15, imported: true },
      ] });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 't1', date: 'tomorrow' }, 'w-v1'), ctx, io())).toMatchObject({ success: false, error: 'date must be YYYY-MM-DD' });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 't1', date: '2026-10-20', start: '9am' }, 'w-v2'), ctx, io())).toMatchObject({ success: false, error: 'start must be HH:MM' });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 'nope', date: '2026-10-20', start: '09:00' }, 'w-v3'), ctx, io())).toMatchObject({ success: false, error: expect.stringContaining('No scheduled block') });
      expect(await handleLauncherIntent(write('MOVE', { task_id: 'recurring-7-2026-10-19', date: '2026-10-20', start: '09:00' }, 'w-v4'), ctx, io())).toMatchObject({ success: false, error: expect.stringContaining('recurring-task occurrence') });
      const event = await handleLauncherIntent(write('RESIZE', { task_id: 'e1', duration: 30 }, 'w-v5'), ctx, io());
      expect(event.success).toBe(false);
      expect(await handleLauncherIntent(write('RESIZE', { task_id: 't1', duration: 3 }, 'w-v6'), ctx, io())).toMatchObject({ success: false, error: expect.stringContaining('at least 5') });
      expect(state.tasks[0].duration).toBe(45);
      expect(state.tasks[1].duration).toBe(15);
      // Every refusal is in the ledger with its error, and a re-sent one answers from there.
      for (const id of ['w-v1', 'w-v2', 'w-v3', 'w-v4', 'w-v5', 'w-v6']) expect(findHandled(ledger, id)?.error).toBeTruthy();
      expect(await handleLauncherIntent(write('RESIZE', { task_id: 't1', duration: 3 }, 'w-v6'), ctx, io())).toMatchObject({ success: false, deduped: true });
    });

    it('RESIZE changes the duration and stamps the write', async () => {
      const { ctx, state } = makeContext({ tasks: [{ id: 't1', title: 'Run', date: '2026-10-19', startTime: '07:45', duration: 45 }] });
      expect(await handleLauncherIntent(write('RESIZE', { task_id: 't1', duration: 60 }, 'w-r1'), ctx, io())).toMatchObject({ success: true, task_id: 't1' });
      expect(state.tasks[0]).toMatchObject({ duration: 60 });
      expect(state.tasks[0].lastModified).toBeTruthy();
    });

    it('UNCOMPLETE reopens a task, in the Inbox and for a recurring occurrence too', async () => {
      const { ctx, state } = makeContext({
        tasks: [{ id: 't1', title: 'Run', date: '2026-10-19', completed: true, completedAt: '2026-10-19T08:00:00Z' }],
        unscheduledTasks: [{ id: 'i1', title: 'Renew passport', completed: true, completedAt: '2026-10-19T08:00:00Z' }],
      });
      ctx.setRecurringTasks(() => [{ id: 7, title: 'Stretch', completedDates: ['2026-10-19'] }]);
      Object.defineProperty(ctx, 'recurringTasks', { get: () => state.recurringTasks });
      expect(await handleLauncherIntent(write('UNCOMPLETE', { task_id: 't1' }, 'w-u1'), ctx, io())).toMatchObject({ success: true, task_id: 't1' });
      expect(state.tasks[0]).toMatchObject({ completed: false, completedAt: null });
      expect(await handleLauncherIntent(write('UNCOMPLETE', { task_id: 'i1' }, 'w-u2'), ctx, io())).toMatchObject({ success: true });
      expect(state.unscheduledTasks[0].completed).toBe(false);
      expect(await handleLauncherIntent(write('UNCOMPLETE', { task_id: 'recurring-7-2026-10-19' }, 'w-u3'), ctx, io())).toMatchObject({ success: true });
      expect(state.recurringTasks[0].completedDates).toEqual([]);
      expect(state.recurringTasks[0].completedDatesTimestamps['2026-10-19']).toBeTruthy();
      // Already open: a success with a warning, nothing changes.
      expect(await handleLauncherIntent(write('UNCOMPLETE', { task_id: 't1' }, 'w-u4'), ctx, io())).toMatchObject({ success: true, warning: 'not completed' });
      // And COMPLETE reaches a recurring occurrence by the same route.
      expect(await handleLauncherIntent(write('COMPLETE', { task_id: 'recurring-7-2026-10-19' }, 'w-u5'), ctx, io())).toMatchObject({ success: true });
      expect(state.recurringTasks[0].completedDates).toEqual(['2026-10-19']);
    });

    it('TOGGLE_ROUTINE flips today\'s routine and refuses another day or an unknown routine', async () => {
      const { ctx } = makeContext();
      let completions = { r1: todayStr };
      ctx.todayRoutines = [{ id: 'r1', name: 'Stretch', startTime: '12:30', duration: 15 }];
      ctx.routinesDate = todayStr;
      Object.defineProperty(ctx, 'routineCompletions', { get: () => completions });
      const toggled = [];
      ctx.toggleRoutineCompletion = (id) => { toggled.push(id); completions = completions[id] ? {} : { [id]: todayStr }; };
      expect(await handleLauncherIntent(write('TOGGLE_ROUTINE', { routine_id: 'r1', date: todayStr }, 'w-t1'), ctx, io())).toEqual({ success: true, error: '', routine_id: 'r1', completed: false });
      expect(await handleLauncherIntent(write('TOGGLE_ROUTINE', { routine_id: 'r1' }, 'w-t2'), ctx, io())).toMatchObject({ success: true, completed: true });
      expect(toggled).toEqual(['r1', 'r1']);
      expect(await handleLauncherIntent(write('TOGGLE_ROUTINE', { routine_id: 'r1', date: '2020-01-01' }, 'w-t3'), ctx, io())).toMatchObject({ success: false, error: expect.stringContaining('today') });
      expect(await handleLauncherIntent(write('TOGGLE_ROUTINE', { routine_id: 'r9' }, 'w-t4'), ctx, io())).toMatchObject({ success: false, error: 'no such routine today' });
      expect(toggled).toHaveLength(2);
      // The ledger keys the routine, so a re-sent toggle does not flip it back.
      expect(findHandled(ledger, 'w-t1')).toMatchObject({ taskId: 'r1' });
      expect(await handleLauncherIntent(write('TOGGLE_ROUTINE', { routine_id: 'r1' }, 'w-t1'), ctx, io())).toMatchObject({ deduped: true });
      expect(toggled).toHaveLength(2);
    });
  });
});
