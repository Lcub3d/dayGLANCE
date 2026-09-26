import { describe, it, expect, vi, beforeEach } from 'vitest';

// The hook glue over src/jobo/detector.js: one write per edge, no write on
// re-render, a remote-apply window holds the edge for the next quiet render,
// the flag off consumes it, and a transition landing during the in-flight
// window is caught by the post-write re-render. Slot-based react mock so
// refs survive re-renders (the useCompletionLog.test.js harness).

const effects = [];
let refSlots = [];
let refCursor = 0;
const bump = vi.fn();
vi.mock('react', () => ({
  useEffect: (fn) => { effects.push(fn); },
  useRef: (init) => {
    if (refCursor >= refSlots.length) refSlots.push({ current: init });
    return refSlots[refCursor++];
  },
  useReducer: (r, init) => [init, bump],
}));
vi.mock('../utils/trayMode.js', () => ({ isTrayMode: false }));

const { default: useJoboDetector } = await import('./useJoboDetector.js');
const { createLedger } = await import('../jobo/ledger.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
const DONE_AT = '2026-09-19T15:10:02-05:00';
const task = (over = {}) => ({ id: 't1', title: 'Draft', date: '2026-09-19', startTime: '14:30', duration: 60, completed: false, ...over });
const done = (t) => ({ ...t, completed: true, completedAt: DONE_AT });

function useRenderedHook(props) {
  effects.length = 0;
  refCursor = 0;
  useJoboDetector(props);
  for (const e of effects) e();
}

let recordJobo;
const props = (tasks, over = {}) => ({
  tasks, unscheduledTasks: [], recurringTasks: [],
  readJoboWorkingSet: () => [], joboLoaded: true, joboWritable: true, recordJobo,
  isRemoteApply: () => false, enabled: true,
  ...over,
});

beforeEach(() => {
  refSlots = [];
  bump.mockReset();
  recordJobo = vi.fn(async () => ({ ok: true }));
});

describe('useJoboDetector', () => {
  it('a completion edge writes one record through recordJobo, and a re-render writes nothing more', async () => {
    useRenderedHook(props([task()]));
    useRenderedHook(props([done(task())]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);
    const [records] = recordJobo.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: `do:t1:${DONE_AT}`, progress: 'completed', timing: 'untimed', source: 'completion' });
    expect(bump).toHaveBeenCalledTimes(1);
    useRenderedHook(props([done(task())]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);
  });

  it('first sight never writes: a task that arrives completed was not completed now', async () => {
    useRenderedHook(props([done(task())]));
    await flush();
    expect(recordJobo).not.toHaveBeenCalled();
  });

  // MUTATION: consume instead of hold on a remote apply and the edge is lost.
  it('a remote-apply window holds the edge; the next quiet render writes it', async () => {
    useRenderedHook(props([task()]));
    useRenderedHook(props([done(task())], { isRemoteApply: () => true }));
    await flush();
    expect(recordJobo).not.toHaveBeenCalled();
    useRenderedHook(props([done(task())]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);
  });

  it('the ledger not yet loaded holds the edge; loaded writes it', async () => {
    useRenderedHook(props([task()], { joboLoaded: false, readJoboWorkingSet: () => undefined }));
    useRenderedHook(props([done(task())], { joboLoaded: false, readJoboWorkingSet: () => undefined }));
    await flush();
    expect(recordJobo).not.toHaveBeenCalled();
    useRenderedHook(props([done(task())]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);
  });

  it('the flag off consumes: nothing is written, and enabling later does not retro-create', async () => {
    useRenderedHook(props([task()], { enabled: false }));
    useRenderedHook(props([done(task())], { enabled: false }));
    await flush();
    useRenderedHook(props([done(task())], { enabled: true }));
    await flush();
    expect(recordJobo).not.toHaveBeenCalled();
  });

  it('ensure-present at the hook: a record already in joboRecords is not written again', async () => {
    const existing = { id: `do:t1:${DONE_AT}`, progress: 'mostly' };
    useRenderedHook(props([task()], { readJoboWorkingSet: () => [existing] }));
    useRenderedHook(props([done(task())], { readJoboWorkingSet: () => [existing] }));
    await flush();
    expect(recordJobo).not.toHaveBeenCalled();
  });

  it('a transition during the in-flight window is caught after the write', async () => {
    let release;
    recordJobo = vi.fn(() => new Promise((r) => { release = r; }));
    useRenderedHook(props([task(), task({ id: 't2' })]));
    useRenderedHook(props([done(task()), task({ id: 't2' })]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);
    // t2 completes while t1's write is still in flight: held, not consumed.
    useRenderedHook(props([done(task()), done(task({ id: 't2' }))]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await flush();
    expect(bump).toHaveBeenCalledTimes(1); // the re-render that catches t2
    useRenderedHook(props([done(task()), done(task({ id: 't2' }))]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(2);
    expect(recordJobo.mock.calls[1][0][0].id).toBe(`do:t2:${DONE_AT}`);
  });

  // #1826, through the real hook and the real ledger. MUTATION: build
  // against committed joboRecords (or return them from workingSet) and the
  // retry persists `completed` for a task that was reopened.
  it('reopening a task whose completion is still held for retry lands as partial once storage recovers', async () => {
    let disk = [];
    let failing = true;
    const retries = [];
    const store = {
      async writable() { return true; },
      async read() { return { ok: true, value: disk }; },
      async update(fn) { if (failing) return { ok: false, error: 'storageWrite' }; disk = fn(disk); return { ok: true, value: disk }; },
      async write(v) { disk = v; return { ok: true, value: disk }; },
    };
    const ledger = createLedger({ store, retry: { schedule: (fn) => { retries.push(fn); return retries.length; }, cancel: () => {} } });
    await ledger.load();
    const wired = (tasks) => props(tasks, {
      recordJobo: ledger.commit,
      readJoboWorkingSet: ledger.workingSet,
      joboLoaded: ledger.get().loaded,
      joboWritable: ledger.get().writable,
    });
    useRenderedHook(wired([task()]));
    useRenderedHook(wired([done(task())]));               // completion: the write fails, the ledger holds it
    await flush();
    expect(ledger.get().records).toEqual([]);             // committed-only, as the report asks
    expect(ledger.heldCount()).toBe(1);
    useRenderedHook(wired([{ ...task(), completed: false, completedAt: null }])); // reopened before the retry
    await flush();
    const pending = ledger.workingSet();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: `do:t1:${DONE_AT}`, progress: 'partial' });
    failing = false;
    await retries[retries.length - 1]();
    expect(disk).toHaveLength(1);
    expect(disk[0]).toMatchObject({ id: `do:t1:${DONE_AT}`, progress: 'partial', title: 'Draft' });
    expect(disk[0].planSnapshot).toEqual({ date: '2026-09-19', startTime: '14:30', duration: 60 });
    expect(ledger.heldCount()).toBe(0);
    ledger.dispose();
  });

  it('a write the ledger holds for retry is handed over once and not warned about; a refused one is warned about', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordJobo = vi.fn(async () => ({ ok: false, error: 'storageWrite', held: true }));
    useRenderedHook(props([task()]));
    useRenderedHook(props([done(task())]));
    await flush();
    expect(warn).not.toHaveBeenCalled();
    useRenderedHook(props([done(task())]));
    await flush();
    expect(recordJobo).toHaveBeenCalledTimes(1);          // one-shot: the ledger owns it now
    recordJobo = vi.fn(async () => ({ ok: false, error: 'readOnly' }));
    useRenderedHook(props([done(task()), task({ id: 't2' })]));
    useRenderedHook(props([done(task()), done(task({ id: 't2' }))]));
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refused'), 'readOnly');
    warn.mockRestore();
  });
});
