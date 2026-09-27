import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoRecord } from '../jobo/core.js';

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(effect) { runtime.effects.push(effect); },
  useCallback(callback) { return callback; },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = typeof value === 'function' ? value() : value;
    return [runtime.slots[i], next => { runtime.slots[i] = typeof next === 'function' ? next(runtime.slots[i]) : next; }];
  },
}));
const { default: useJoboViewWriter, receiptState } = await import('./useJoboViewWriter.js');
const stamp = '2026-09-27T10:00:00.000Z';
const row = (over = {}) => createDoRecord({ id: 'manual:one', taskId: 't1', title: 'Capture', source: 'manual', progress: 'started',
  timing: 'timed', date: '2026-09-27', startTime: '10:00', endDate: '2026-09-27', endTime: '10:30',
  planSnapshot: null, createdAt: stamp, observedAt: stamp, updatedAt: stamp, ...over });
function harness(result) {
  const props = { records: [], recordJobo: vi.fn(async () => result), setJoboTaskCompletion: vi.fn(), pushUndoAction: vi.fn() };
  let state;
  const render = () => { runtime.cursor = 0; runtime.effects = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    state = useJoboViewWriter(props);
    for (const effect of runtime.effects) effect();
    return state;
  };
  render();
  return { props, render, write: input => state.write(input), publish: records => { props.records = records; render(); return render(); } };
}
beforeEach(() => { runtime.slots = []; runtime.cursor = 0; runtime.effects = []; });

describe('view receipts over the unchanged ledger writer', () => {
  it('submits one canonical row without changing tasks, stamps, history, or undo', async () => {
    const record = row();
    const h = harness({ ok: true, value: [record] });
    expect(await h.write([record])).toMatchObject({ ok: true });
    expect(h.props.recordJobo).toHaveBeenCalledWith([record]);
    expect(h.props.setJoboTaskCompletion).not.toHaveBeenCalled();
    expect(h.props.pushUndoAction).not.toHaveBeenCalled();
    expect(h.render().pendingIds).toEqual([]);
  });
  it('keeps held writes visibly pending and blocks a second edit until committed state arrives', async () => {
    const record = row();
    const h = harness({ ok: false, held: true, error: 'storageWrite' });
    expect(await h.write([record])).toMatchObject({ held: true, ok: false });
    expect(h.render().pendingIds).toEqual([record.id]);
    expect(await h.write([record])).toMatchObject({ ok: false, error: 'pending' });
    expect(h.props.recordJobo).toHaveBeenCalledTimes(1);
    expect(h.publish([record]).pendingIds).toEqual([]);
  });
  it('releases a superseded receipt without restamping or retrying over the remote winner', async () => {
    const record = row();
    const h = harness({ ok: false, held: true });
    await h.write([record]);
    const state = h.publish([row({ updatedAt: '2026-09-27T11:00:00.000Z', progress: 'mostly' })]);
    expect(state).toMatchObject({ pendingIds: [], conflict: true });
    expect(h.props.recordJobo).toHaveBeenCalledTimes(1);
  });
  it('does not call a successful merge of a different winner our save', async () => {
    const h = harness({ ok: true, value: [row({ updatedAt: '2026-09-27T11:00:00.000Z', deleted: true })] });
    expect(await h.write([row()])).toMatchObject({ ok: false, error: 'recordChanged' });
    expect(h.render().conflict).toBe(true);
  });
  it.each(['readOnly', 'notLoaded'])('does not hold a refused %s write', async error => {
    const h = harness({ ok: false, error });
    expect(await h.write([row()])).toMatchObject({ ok: false, error });
    expect(h.render().pendingIds).toEqual([]);
  });
  it('a thrown writer failure releases only the local receipt', async () => {
    const h = harness();
    h.props.recordJobo.mockRejectedValue(new Error('failed'));
    await expect(h.write([row()])).rejects.toThrow('failed');
    expect(h.render().pendingIds).toEqual([]);
  });
  it('rejects malformed batches before handing anything to storage', async () => {
    const h = harness();
    await expect(h.write([{ id: 'bad' }])).rejects.toThrow();
    await expect(h.write([row(), row({ id: 'another' })])).rejects.toThrow();
    expect(h.props.recordJobo).not.toHaveBeenCalled();
  });
  it('uses the core tie rule, not only timestamp equality, to resolve receipts', () => {
    const expected = row();
    expect(receiptState(expected, [])).toBe('pending');
    expect(receiptState(expected, [{ ...expected, title: 'Earlier capture', observedAt: '2026-09-27T09:59:59.000Z' }])).toBe('superseded');
    expect(receiptState(expected, [{ ...expected, observedAt: '2026-09-27T10:00:01.000Z' }])).toBe('pending');
  });
});
