import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoRecord } from '../jobo/core.js';
import { preparePlanCompletion } from '../jobo/planCompletion.js';
import { latestDoForTask } from '../jobo/completionPolicy.js';

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) {
    const index = runtime.cursor++;
    return runtime.slots[index] ||= { current: value };
  },
  useEffect(effect) { runtime.effects.push(effect); },
  useState(value) { return [value, () => {}]; },
}));
const { default: useJoboViewWriter } = await import('./useJoboViewWriter.js');
const { createUndoHistory } = await import('./useUndo.js');

const STAMP = '2026-09-27T10:00:00.000Z';
const record = (patch = {}) => createDoRecord({
  id: 'manual:one', taskId: 't1', title: 'Captured task', source: 'manual', progress: 'completed',
  timing: 'timed', date: '2026-09-27', startTime: '10:00', endDate: '2026-09-27', endTime: '10:30',
  planSnapshot: null, createdAt: STAMP, updatedAt: STAMP, observedAt: STAMP, ...patch,
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness(overrides = {}) {
  const onSuccess = vi.fn();
  const onFailure = vi.fn();
  const onBusy = vi.fn();
  const history = createUndoHistory({ captureSnapshot: () => ({}), restoreSnapshot: vi.fn(), onSuccess, onFailure, onBusy });
  let transition = 0;
  const props = {
    records: [], pendingIds: [], tasks: [{ id: 't1', completed: false, completedAt: null, transitionId: 'initial' }],
    unscheduledTasks: [], recurringTasks: [],
    recordJobo: vi.fn(async () => ({ ok: true })), pushUndoAction: history.pushUndoAction,
    onNotice: vi.fn(), ...overrides,
  };
  props.setJoboTaskCompletion = vi.fn((state, completed) => {
    if (state.completed === completed) return state;
    transition += 1;
    const next = { id: state.id, fromInbox: state.fromInbox, completed,
      stamp: completed ? new Date(Date.parse(STAMP) + transition).toISOString() : null, transitionId: `owned-${transition}` };
    props.tasks = props.tasks.map(task => task.id !== next.id ? task : { ...task, completed, completedAt: next.stamp, transitionId: next.transitionId });
    return next;
  });
  let writer;
  const render = () => {
    runtime.cursor = 0; runtime.effects = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    writer = useJoboViewWriter(props);
    for (const effect of runtime.effects) effect();
  };
  const submitted = () => props.recordJobo.mock.calls.at(-1)?.[0][0];
  const publish = (value = submitted()) => {
    props.records = [...props.records.filter(row => row.id !== value.id), value];
    render(); render(); // The native setter's returned state also becomes props.
  };
  const commit = async (value, command) => {
    const pending = writer([value], command);
    await flush(); publish(value);
    return await pending;
  };
  const applyHistory = async direction => {
    const pending = history[direction]();
    await flush(); publish();
    return await pending;
  };
  render();
  return { props, history, render, publish, commit, applyHistory, submitted, write: (value, command) => writer(value, command), onSuccess, onFailure, onBusy };
}

beforeEach(() => { runtime.slots = []; runtime.cursor = 0; runtime.effects = []; });

describe('Do view writer confirmation and history', () => {
  it('walks consecutive create/edit undo and redo with both Do and native ownership versions advancing', async () => {
    const h = harness();
    const first = record();
    const second = record({ progress: 'mostly', updatedAt: '2026-09-27T10:01:00.000Z' });
    await h.commit(first); await h.commit(second);
    expect(h.props.tasks[0].completed).toBe(false);
    const versions = [second.updatedAt];
    for (const [direction, progress, deleted, completed] of [
      ['performUndo', 'completed', false, true], ['performUndo', 'completed', true, false],
      ['performRedo', 'completed', false, true], ['performRedo', 'mostly', false, false],
    ]) {
      expect(await h.applyHistory(direction)).toBe(true);
      expect(h.props.records[0]).toMatchObject({ progress, deleted });
      expect(h.props.tasks[0].completed).toBe(completed);
      const version = h.props.records[0].updatedAt;
      expect(Date.parse(version)).toBeGreaterThan(Date.parse(versions.at(-1)));
      versions.push(version);
    }
    expect(h.props.onNotice).not.toHaveBeenCalled();
    expect(h.onSuccess).toHaveBeenCalledTimes(4);
  });

  it('treats held writes as accepted but blocks duplicate writes and undo until canonical confirmation clears pending', async () => {
    const h = harness();
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    const next = record();
    expect(await h.write([next])).toEqual({ ok: false, held: true });
    expect(h.props.tasks[0].completed).toBe(false);
    expect(await h.history.performUndo()).toBe(false);
    expect(await h.write([next])).toMatchObject({ ok: false, error: { code: 'pending' } });
    expect(h.props.recordJobo).toHaveBeenCalledTimes(1);
    h.props.pendingIds = [next.id]; h.publish(next);
    expect(h.props.tasks[0].completed).toBe(false);
    h.props.pendingIds = []; h.render(); h.render();
    expect(h.props.tasks[0].completed).toBe(true);
    expect(await h.applyHistory('performUndo')).toBe(true);
  });

  it('finishes a confirmed undo while retaining a remote native transition that arrived during held storage', async () => {
    const h = harness();
    await h.commit(record());
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    const pending = h.history.performUndo();
    await flush();
    expect(await h.history.performRedo()).toBe(false);
    h.props.tasks = [{ id: 't1', completed: false, completedAt: null, transitionId: 'remote-reopen' }];
    h.publish();
    expect(await pending).toBe(true);
    expect(h.props.records[0].deleted).toBe(true);
    expect(h.props.tasks[0].transitionId).toBe('remote-reopen');
    expect(h.props.onNotice).toHaveBeenCalledWith(expect.stringContaining('等待期间发生变化'));
    const calls = h.props.setJoboTaskCompletion.mock.calls.length;
    expect(await h.applyHistory('performRedo')).toBe(true);
    expect(h.props.tasks[0].transitionId).toBe('remote-reopen');
    expect(h.props.setJoboTaskCompletion).toHaveBeenCalledTimes(calls);
  });

  it.each(['throw', 'null'])('settles a held undo when the later native setter returns %s and releases global history', async outcome => {
    const h = harness();
    await h.commit(record());
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    const pending = h.history.performUndo();
    await flush();
    if (outcome === 'throw') h.props.setJoboTaskCompletion.mockImplementationOnce(() => { throw new Error('native failure'); });
    else h.props.setJoboTaskCompletion.mockReturnValueOnce(null);
    expect(() => h.publish()).not.toThrow();
    expect(await pending).toBe(true);
    expect(h.props.records[0].deleted).toBe(true);
    expect(h.props.onNotice).toHaveBeenCalledWith(expect.stringContaining('关联任务状态更新未完成'));
    const calls = h.props.setJoboTaskCompletion.mock.calls.length;
    expect(await h.applyHistory('performRedo')).toBe(true);
    expect(h.props.setJoboTaskCompletion).toHaveBeenCalledTimes(calls);
  });

  it('retains undo for an initially confirmed Do if its native side effect or notice callback throws', async () => {
    const h = harness();
    h.props.setJoboTaskCompletion.mockImplementationOnce(() => { throw new Error('native failure'); });
    h.props.onNotice.mockImplementation(() => { throw new Error('notice failure'); });
    expect(await h.commit(record())).toEqual({ ok: true });
    expect(h.props.tasks[0].completed).toBe(false);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.records[0].deleted).toBe(true);
  });

  it('cancels a refused forward write without leaving an undo reservation', async () => {
    const h = harness();
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, error: 'readOnly' });
    expect(await h.write([record()])).toEqual({ ok: false, error: 'readOnly' });
    expect(await h.history.performUndo()).toBe(false);
    expect(h.props.setJoboTaskCompletion).not.toHaveBeenCalled();
    expect(await h.commit(record())).toEqual({ ok: true });
  });

  it('releases a failed storage operation while retaining undo for a later retry', async () => {
    const h = harness();
    await h.commit(record());
    h.props.recordJobo.mockRejectedValueOnce(new Error('storage refused'));
    expect(await h.history.performUndo()).toBe(false);
    expect(h.props.records[0].deleted).toBe(false);
    expect(h.props.tasks[0].completed).toBe(true);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.records[0].deleted).toBe(true);
    expect(h.props.tasks[0].completed).toBe(false);
  });

  it('does not confirm a held command whose canonical winner is a newer remote record', async () => {
    const h = harness();
    await h.commit(record());
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    const pending = h.history.performUndo();
    await flush();
    const remote = createDoRecord({ ...h.submitted(), deleted: false, progress: 'mostly', updatedAt: new Date(Date.parse(h.submitted().updatedAt) + 1).toISOString() });
    h.publish(remote);
    expect(await pending).toBe(false);
    expect(h.props.tasks[0].completed).toBe(true);
    expect(await h.history.performRedo()).toBe(false);
    expect(await h.history.performUndo()).toBe(false);
  });

  it('lets the last timed Do determine the checkbox when progress or timeline order changes', async () => {
    const h = harness();
    const earlier = record();
    const later = record({ id: 'manual:later', progress: 'mostly', startTime: '11:00', endTime: '11:30' });
    await h.commit(earlier); await h.commit(later);
    expect(h.props.tasks[0].completed).toBe(false);
    // Move the earlier Completed block after the Mostly block: only timing
    // changed, but the identity governing the native checkbox has changed.
    const moved = createDoRecord({ ...earlier, startTime: '12:00', endTime: '12:30', updatedAt: '2026-09-27T10:02:00.000Z' });
    await h.commit(moved);
    expect(h.props.tasks[0].completed).toBe(true);
    expect(h.props.setJoboTaskCompletion).toHaveBeenLastCalledWith(expect.any(Object), true, earlier.id);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.tasks[0].completed).toBe(false);
    expect(h.props.setJoboTaskCompletion).toHaveBeenLastCalledWith(expect.any(Object), false, later.id);
  });

  it('groups an explicit Plan completion with its Do end time and progress through undo and redo', async () => {
    const before = record({ progress: 'mostly', endTime: '11:00' });
    const h = harness({ records: [before] });
    const now = new Date(2026, 8, 27, 10, 45, 31, 456).getTime();
    const after = preparePlanCompletion({ ...h.props, task: h.props.tasks[0], now });
    expect(await h.commit(after, { completePlan: true })).toEqual({ ok: true });
    expect(h.props.records).toHaveLength(1);
    expect(h.props.records[0]).toMatchObject({ id: before.id, startTime: '10:00', endTime: '10:45', progress: 'completed', completedAt: new Date(now).toISOString() });
    expect(h.props.tasks[0].completed).toBe(true);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.records[0]).toMatchObject({ id: before.id, startTime: '10:00', endTime: '11:00', progress: 'mostly' });
    expect(h.props.records[0]).not.toHaveProperty('completedAt');
    expect(h.props.tasks[0].completed).toBe(false);
    expect(await h.applyHistory('performRedo')).toBe(true);
    expect(h.props.records[0]).toMatchObject({ id: before.id, endTime: '10:45', progress: 'completed', completedAt: after.completedAt });
    expect(h.props.tasks[0].completed).toBe(true);
    expect(h.props.onNotice).not.toHaveBeenCalled();
  });

  it('still completes an unchecked Plan when the linked completed Do is otherwise unchanged', async () => {
    const unchanged = record();
    const h = harness({ records: [unchanged] });
    expect(await h.commit(unchanged, { completePlan: true })).toEqual({ ok: true });
    expect(h.props.recordJobo).toHaveBeenCalledTimes(1);
    expect(h.props.tasks[0].completed).toBe(true);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.records[0]).toMatchObject({ id: unchanged.id, startTime: '10:00', endTime: '10:30', progress: 'completed' });
    expect(h.props.tasks[0].completed).toBe(false);
    expect(await h.applyHistory('performRedo')).toBe(true);
    expect(h.props.tasks[0].completed).toBe(true);
  });

  it('preserves an explicit Plan check when inferred timing moves its Do before another future unfinished Do', async () => {
    const future = record({ id: 'manual:future', progress: 'mostly', startTime: '12:00', endTime: '12:30' });
    const last = record({ id: 'manual:last', progress: 'partial', startTime: '13:00', endTime: '13:30' });
    const h = harness({ records: [future, last] });
    const plan = { ...h.props.tasks[0], duration: 30 };
    const after = preparePlanCompletion({ ...h.props, task: plan, now: new Date(2026, 8, 27, 10, 45).getTime() });
    expect(after).toMatchObject({ id: last.id, startTime: '10:15', endTime: '10:45', timingBasis: 'planDuration' });
    await h.commit(after, { completePlan: true });
    expect(latestDoForTask(h.props, after).id).toBe(future.id);
    expect(h.props.tasks[0].completed).toBe(true);
    expect(h.props.setJoboTaskCompletion).toHaveBeenLastCalledWith(expect.any(Object), true, last.id);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.records.find(row => row.id === last.id)).toMatchObject({ startTime: '13:00', endTime: '13:30', progress: 'partial' });
    expect(h.props.tasks[0].completed).toBe(false);
    expect(h.props.setJoboTaskCompletion).toHaveBeenLastCalledWith(expect.any(Object), false, last.id);
    expect(await h.applyHistory('performRedo')).toBe(true);
    expect(h.props.tasks[0].completed).toBe(true);
    expect(h.props.setJoboTaskCompletion).toHaveBeenLastCalledWith(expect.any(Object), true, last.id);
    expect(h.props.records.find(row => row.id === future.id)).toEqual(future);
  });

  it('defers an explicit Plan check until its held Do is canonically confirmed', async () => {
    const before = record({ progress: 'mostly' });
    const h = harness({ records: [before] });
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    const after = preparePlanCompletion({ ...h.props, task: h.props.tasks[0], now: new Date(2026, 8, 27, 10, 45).getTime() });
    expect(await h.write([after], { completePlan: true })).toEqual({ ok: false, held: true });
    expect(h.props.tasks[0].completed).toBe(false);
    expect(await h.history.performUndo()).toBe(false);
    h.props.pendingIds = [after.id]; h.publish(after);
    expect(h.props.setJoboTaskCompletion).not.toHaveBeenCalled();
    h.props.pendingIds = []; h.render(); h.render();
    expect(h.props.tasks[0].completed).toBe(true);
    expect(h.props.setJoboTaskCompletion).toHaveBeenCalledTimes(1);
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.tasks[0].completed).toBe(false);
    expect(h.props.records[0].progress).toBe('mostly');
  });

  it('keeps a newer native transition during a held explicit Plan check and still records Do undo', async () => {
    const before = record({ progress: 'mostly' });
    const h = harness({ records: [before] });
    h.props.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    const after = preparePlanCompletion({ ...h.props, task: h.props.tasks[0], now: new Date(2026, 8, 27, 10, 45).getTime() });
    expect(await h.write([after], { completePlan: true })).toEqual({ ok: false, held: true });
    h.props.tasks = [{ id: 't1', completed: false, completedAt: null, transitionId: 'remote-reopen' }];
    h.publish(after);
    expect(h.props.records[0].progress).toBe('completed');
    expect(h.props.tasks[0]).toMatchObject({ completed: false, transitionId: 'remote-reopen' });
    expect(h.props.setJoboTaskCompletion).not.toHaveBeenCalled();
    expect(h.props.onNotice).toHaveBeenCalledWith(expect.stringContaining('等待期间发生变化'));
    expect(await h.applyHistory('performUndo')).toBe(true);
    expect(h.props.records[0].progress).toBe('mostly');
    expect(await h.applyHistory('performRedo')).toBe(true);
    expect(h.props.records[0].progress).toBe('completed');
    expect(h.props.tasks[0]).toMatchObject({ completed: false, transitionId: 'remote-reopen' });
    expect(h.props.setJoboTaskCompletion).not.toHaveBeenCalled();
  });
});
