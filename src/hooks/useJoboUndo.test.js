import { describe, it, expect, vi } from 'vitest';
import { createDoRecord } from '../jobo/core.js';
import { createLedger } from '../jobo/ledger.js';
import { prepareDoEdit, prepareDoDelete } from '../jobo/viewActions.js';

// The path a Do edit takes to become undoable, against the real ledger: the
// view's accepted write is reported, the step lands in the app's history,
// and its undo and redo write back through the ledger's commit.

vi.mock('react', () => ({
  useRef(value) { return { current: value }; },
  useCallback(callback) { return callback; },
}));
const { default: useJoboUndo } = await import('./useJoboUndo.js');

function memoryStore(initial = []) {
  let value = initial;
  return {
    async writable() { return true; },
    async mode() { return 'indexeddb'; },
    async read() { return { ok: true, value }; },
    async update(fn) { value = fn(value); return { ok: true, value }; },
    async write(v) { value = v; return { ok: true, value }; },
  };
}

const stamp = '2026-09-28T15:00:00.000Z';
const row = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: 't1', title: 'Deep work', source: 'manual', progress: 'partial',
  timing: 'timed', date: '2026-09-28', startTime: '09:00', endDate: '2026-09-28', endTime: '10:00',
  planSnapshot: null, createdAt: stamp, observedAt: stamp, updatedAt: stamp, ...over,
});

async function setup(records, taskSources) {
  const ledger = createLedger({ store: memoryStore(records) });
  await ledger.load();
  const steps = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const record = useJoboUndo({
    joboRecords: ledger.get().records,
    readJoboWorkingSet: ledger.workingSet,
    recordJobo: ledger.commit,
    pushUndoAction: (action) => steps.push(action),
    taskSources,
    t: (key) => key,
  });
  const current = (id = 'manual:1') => ledger.workingSet().find((r) => r.id === id);
  // What the view does: write, then report the accepted write.
  const edit = async (next) => {
    const before = ledger.get().records.find((r) => r.id === next.id) ?? null;
    await ledger.commit([next]);
    record(before, next);
  };
  return { ledger, steps, current, edit };
}

describe('a Do edit in the undo history', () => {
  it('undo moves it back and redo moves it forward, through the ledger', async () => {
    const { steps, current, edit } = await setup([row()]);
    await edit(prepareDoEdit({ records: [current()], record: current(), patch: { startTime: '09:30' }, now: Date.now() }));
    expect(current().startTime).toBe('09:30');
    expect(steps).toHaveLength(1);
    expect(await steps[0].undo()).toEqual({ ok: true, message: 'jobo.undo.undone' });
    expect(current().startTime).toBe('09:00');
    expect(await steps[0].redo()).toEqual({ ok: true, message: 'jobo.undo.redone' });
    expect(current().startTime).toBe('09:30');
    expect(await steps[0].undo()).toEqual({ ok: true, message: 'jobo.undo.undone' });
    expect(current().startTime).toBe('09:00');
  });

  it('brings a deleted Do back', async () => {
    const { steps, current, edit } = await setup([row()]);
    await edit(prepareDoDelete({ records: [current()], record: current(), now: Date.now() }));
    expect(current().deleted).toBe(true);
    expect(await steps[0].undo()).toEqual({ ok: true, message: 'jobo.undo.undone' });
    expect(current()).toMatchObject({ deleted: false, startTime: '09:00' });
  });

  // MUTATION: plan against a snapshot taken when the step was recorded and
  // this undo overwrites the newer edit.
  it('leaves a record alone when something newer landed since, and says so', async () => {
    const { ledger, steps, current, edit } = await setup([row()]);
    await edit(prepareDoEdit({ records: [current()], record: current(), patch: { startTime: '09:30' }, now: Date.now() }));
    const remote = createDoRecord({ ...current(), endTime: '11:00', updatedAt: new Date(Date.now() + 60_000).toISOString() });
    await ledger.applyRemote([remote]);
    expect(await steps[0].undo()).toEqual({ ok: false, message: 'jobo.undo.changed' });
    expect(current()).toMatchObject({ startTime: '09:30', endTime: '11:00' });
  });

  it('refuses to write Completed back, with its own message', async () => {
    const done = row({ id: 'do:t1:x', source: 'completion', progress: 'completed' });
    const { steps, current, edit } = await setup([done]);
    await edit(prepareDoEdit({ records: [current('do:t1:x')], record: current('do:t1:x'), progress: 'partial', now: Date.now() }));
    expect(await steps[0].undo()).toEqual({ ok: false, message: 'jobo.undo.completionBlocked' });
    expect(current('do:t1:x').progress).toBe('partial');
  });

  it('a refused write fails the step rather than claiming it', async () => {
    const { steps, current, edit, ledger } = await setup([row()]);
    await edit(prepareDoEdit({ records: [current()], record: current(), patch: { startTime: '09:30' }, now: Date.now() }));
    const record = useJoboUndo({ joboRecords: [current()], readJoboWorkingSet: ledger.workingSet,
      recordJobo: async () => ({ ok: false, error: 'readOnly' }), pushUndoAction: (a) => steps.push(a), t: (k) => k });
    record(row(), current());
    expect(await steps[1].undo()).toEqual({ ok: false, message: 'jobo.undo.failed' });
  });

  // MUTATION: resolve the task from a snapshot taken when the step was
  // recorded, or skip recurring occurrences, and these read the wrong state.
  it('restores Completed while the task is completed now, recurring occurrences included', async () => {
    const done = row({ id: 'do:t1:x', source: 'completion', progress: 'completed' });
    const sources = { tasks: [{ id: 't1', title: 'Deep work', completed: false }] };
    const { steps, current, edit } = await setup([done], sources);
    await edit(prepareDoEdit({ records: [current('do:t1:x')], record: current('do:t1:x'), progress: 'partial', now: Date.now() }));
    expect(await steps[0].undo()).toEqual({ ok: false, message: 'jobo.undo.completionBlocked' });
    sources.tasks = [{ id: 't1', title: 'Deep work', completed: true }];   // checked again since
    expect(await steps[0].undo()).toEqual({ ok: true, message: 'jobo.undo.undone' });
    expect(current('do:t1:x').progress).toBe('completed');

    const occurrence = row({ id: 'do:tmpl:2026-09-28:2026-09-28T10:00:00Z', taskId: 'tmpl', source: 'completion', progress: 'completed',
      planSnapshot: { date: '2026-09-28', startTime: '09:00', duration: 60 } });
    const template = { id: 'tmpl', title: 'Standup', startTime: '09:00', duration: 60, recurrence: { type: 'daily' }, completedDates: ['2026-09-28'] };
    const r = await setup([occurrence], { recurringTasks: [template] });
    await r.edit(prepareDoEdit({ records: [r.current(occurrence.id)], record: r.current(occurrence.id), progress: 'partial', now: Date.now() }));
    expect(await r.steps[0].undo()).toEqual({ ok: true, message: 'jobo.undo.undone' });
    expect(r.current(occurrence.id).progress).toBe('completed');
  });
});
