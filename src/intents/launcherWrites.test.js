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
    expect(findHandled(ledger, 'w-5')).toBeNull();
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
});
