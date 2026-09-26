import { describe, expect, it, vi } from 'vitest';
import { createDoRecord } from './core.js';
import { buildJoboRecords, completionKey, findJoboEdges, recurringKey, snapshotJoboState } from './detector.js';
import { doCompletionLink, nativeDoCompletionState, routeDoCompletionEdges, sameNativeCompletion } from './completionBridge.js';
import useTaskActions from '../hooks/useTaskActions.js';

const DAY = '2026-09-27';
const NEXT_DAY = '2026-09-28';
const STAMP = '2026-09-27T10:00:00.000Z';
const LATER = '2026-09-27T10:01:00.000Z';
const OBSERVED = '2026-09-27T10:02:00.000Z';
const task = (patch = {}) => ({ id: 't1', title: 'Native plan', date: DAY, startTime: '09:00', duration: 30, completed: false, ...patch });
const template = (patch = {}) => ({ id: 'r1', title: 'Daily plan', startTime: '09:00', duration: 30, completedDates: [], completedDatesTimestamps: {}, ...patch });
const authoredDo = (patch = {}) => createDoRecord({
  id: 'manual:existing', taskId: 't1', title: 'Captured plan', source: 'manual', progress: 'completed',
  timing: 'timed', date: DAY, startTime: '10:00', endDate: DAY, endTime: '10:30',
  planSnapshot: { date: DAY, startTime: '09:00', duration: 30 },
  createdAt: STAMP, updatedAt: STAMP, observedAt: STAMP, ...patch,
});
const snapshot = (ctx) => snapshotJoboState(ctx.tasks, ctx.unscheduledTasks, ctx.recurringTasks);
const routed = (previous, next) => routeDoCompletionEdges(findJoboEdges(snapshot(previous), snapshot(next), next), next);
const writes = (previous, next, records = []) => buildJoboRecords(routed(previous, next), records, { observedAt: OBSERVED });

describe('Do-origin completion routing', () => {
  it('keeps the ordinary native checkbox contract: one completed Untimed attempt', () => {
    const previous = { tasks: [task()] };
    const next = { tasks: [task({ completed: true, completedAt: STAMP })] };
    const output = writes(previous, next);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ id: completionKey('t1', STAMP), source: 'completion', progress: 'completed', timing: 'untimed', startTime: null, endDate: null, endTime: null });
  });

  it.each(['tasks', 'unscheduledTasks'])('suppresses the authored Do checkbox in %s regardless of task/ledger arrival order', (collection) => {
    const before = task();
    const doRecord = authoredDo();
    const after = task({ completed: true, completedAt: STAMP, joboCompletionLinks: doCompletionLink('t1', null, STAMP, doRecord.id) });
    const previous = { [collection]: [before] };
    const next = { [collection]: [after] };
    expect(writes(previous, next, [])).toEqual([]); // Task arrived first.
    expect(writes(previous, next, [doRecord])).toEqual([]); // Ledger arrived first.
    expect(writes(next, next, [doRecord])).toEqual([]); // Later ledger arrival is not another edge.
  });

  it('only suppresses the exact linked event, leaving other tasks and later native completion events intact', () => {
    const links = doCompletionLink('t1', null, STAMP, 'manual:existing');
    const previous = { tasks: [task(), task({ id: 't2' })] };
    const next = { tasks: [task({ completed: true, completedAt: STAMP, joboCompletionLinks: links }), task({ id: 't2', completed: true, completedAt: STAMP })] };
    expect(writes(previous, next).map(row => row.id)).toEqual([completionKey('t2', STAMP)]);
    const later = { tasks: [task({ completed: true, completedAt: LATER, joboCompletionLinks: links })] };
    expect(writes({ tasks: [task({ joboCompletionLinks: links })] }, later).map(row => row.id)).toEqual([completionKey('t1', LATER)]);
  });

  it('redirects an ordinary native uncheck to its linked Do and preserves the captured timed attempt', () => {
    const links = doCompletionLink('t1', null, STAMP, 'manual:existing');
    const previous = { tasks: [task({ completed: true, completedAt: STAMP, joboCompletionLinks: links })] };
    const next = { tasks: [task({ completedAt: null, joboCompletionLinks: links })] };
    const record = authoredDo();
    const [updated] = writes(previous, next, [record]);
    expect(updated).toEqual({ ...record, progress: 'partial', updatedAt: OBSERVED });
    expect(routed(previous, next).uncompletions).toEqual([{ id: record.id, uncheckedAt: null }]);
  });

  it.each(['started', 'partial', 'mostly'])('does not replace an already authored %s judgement when its checkbox is unchecked', (progress) => {
    const links = doCompletionLink('t1', null, STAMP, 'manual:existing');
    const previous = { tasks: [task({ completed: true, completedAt: STAMP, joboCompletionLinks: links })] };
    const next = { tasks: [task({ completedAt: null, joboCompletionLinks: links })] };
    expect(writes(previous, next, [authoredDo({ progress, updatedAt: LATER })])).toEqual([]);
  });

  it.each(['started', 'mostly'])('preserves explicit %s even when Do-origin uncheck sync arrives before its revised Do', progress => {
    const record = authoredDo();
    const key = completionKey('t1', STAMP);
    const links = doCompletionLink('t1', null, STAMP, record.id);
    const previous = { tasks: [task({ completed: true, completedAt: STAMP, joboCompletionLinks: links })] };
    const next = { tasks: [task({ completedAt: null, joboCompletionLinks: links, joboUncompletionLinks: { [key]: record.id } })] };
    const reassessed = createDoRecord({ ...record, progress, updatedAt: LATER });
    // A remote observer still holds the older Completed record. A fabricated
    // Partial at OBSERVED would beat the real explicit S/M edit at LATER.
    expect(writes(previous, next, [record])).toEqual([]);
    expect(writes(previous, next, [reassessed])).toEqual([]);
    expect(writes(next, next, [reassessed])).toEqual([]);
  });

  it('filters a Do-origin recurring uncheck for only its exact old completion event', () => {
    const firstKey = recurringKey('r1', DAY, STAMP);
    const secondKey = recurringKey('r1', NEXT_DAY, LATER);
    const links = { [firstKey]: 'manual:first', [secondKey]: 'manual:second' };
    const previous = { recurringTasks: [template({ completedDates: [DAY, NEXT_DAY], completedDatesTimestamps: { [DAY]: STAMP, [NEXT_DAY]: LATER }, joboCompletionLinks: links })] };
    const next = { recurringTasks: [template({ completedDates: [], completedDatesTimestamps: { [DAY]: OBSERVED, [NEXT_DAY]: OBSERVED }, joboCompletionLinks: links, joboUncompletionLinks: { [firstKey]: 'manual:first' } })] };
    expect(routed(previous, next).uncompletions).toEqual([{ id: 'manual:second', uncheckedAt: OBSERVED }]);
  });

  it('keeps recurring instances and different capture dates separate', () => {
    const firstKey = recurringKey('r1', DAY, STAMP);
    const secondKey = recurringKey('r1', NEXT_DAY, LATER);
    const previous = { recurringTasks: [template()] };
    const next = { recurringTasks: [template({
      completedDates: [DAY, NEXT_DAY], completedDatesTimestamps: { [DAY]: STAMP, [NEXT_DAY]: LATER },
      joboCompletionLinks: doCompletionLink('r1', DAY, STAMP, 'manual:first'),
    })] };
    expect(routed(previous, next).completions.map(edge => edge.id)).toEqual([secondKey]);
    const unchecked = { recurringTasks: [template({
      ...next.recurringTasks[0], completedDates: [NEXT_DAY], completedDatesTimestamps: { [DAY]: OBSERVED, [NEXT_DAY]: LATER },
    })] };
    expect(routed(next, unchecked).uncompletions).toEqual([{ id: 'manual:first', uncheckedAt: OBSERVED }]);
    expect(doCompletionLink('r1', DAY, STAMP, 'manual:first')).toEqual({ [firstKey]: 'manual:first' });
  });

  it('ignores unrelated or unusable link entries', () => {
    const first = completionKey('t1', STAMP);
    const second = completionKey('t2', STAMP);
    const edges = { completions: [{ id: first }, { id: second }], uncompletions: [] };
    expect(routeDoCompletionEdges(edges, { tasks: [task({ joboCompletionLinks: { [first]: '', [second]: 'manual:wrong-task' } })] })).toEqual(edges);
  });
});

describe('native checkbox state for a Do', () => {
  it('resolves scheduled and inbox tasks while excluding independent and imported read-only records', () => {
    const scheduled = task({ completed: true, completedAt: STAMP });
    expect(nativeDoCompletionState({ tasks: [scheduled] }, authoredDo())).toEqual({ id: 't1', fromInbox: false, completed: true, stamp: STAMP, transitionId: null });
    expect(nativeDoCompletionState({ unscheduledTasks: [scheduled] }, authoredDo())).toEqual({ id: 't1', fromInbox: true, completed: true, stamp: STAMP, transitionId: null });
    expect(nativeDoCompletionState({ tasks: [scheduled] }, authoredDo({ taskId: null }))).toBeNull();
    expect(nativeDoCompletionState({ tasks: [task({ imported: true })] }, authoredDo())).toBeNull();
    expect(nativeDoCompletionState({ tasks: [task({ imported: true, isTaskCalendar: true })] }, authoredDo())).not.toBeNull();
  });

  it('uses the captured Plan date for recurring Do moved across midnight, not its edited actual date', () => {
    const ctx = { recurringTasks: [template({ completedDates: [DAY], completedDatesTimestamps: { [DAY]: STAMP, [NEXT_DAY]: LATER } })] };
    const moved = authoredDo({ taskId: 'r1', date: NEXT_DAY, endDate: NEXT_DAY });
    expect(nativeDoCompletionState(ctx, moved)).toEqual({ id: `recurring-r1-${DAY}`, fromInbox: false, completed: true, stamp: STAMP });
    expect(nativeDoCompletionState(ctx, authoredDo({ taskId: 'r1', planSnapshot: { date: NEXT_DAY, startTime: '09:00', duration: 30 } }))).toMatchObject({ id: `recurring-r1-${NEXT_DAY}`, completed: false });
  });

  it('recovers an all-day recurring completion date from its stable event id and never guesses one for manual records', () => {
    const ctx = { recurringTasks: [template({ completedDates: [DAY], completedDatesTimestamps: { [DAY]: STAMP } })] };
    const record = authoredDo({ id: recurringKey('r1', DAY, STAMP), taskId: 'r1', source: 'completion', planSnapshot: null, date: NEXT_DAY, endDate: NEXT_DAY });
    expect(nativeDoCompletionState(ctx, record)).toMatchObject({ id: `recurring-r1-${DAY}`, completed: true });
    expect(nativeDoCompletionState(ctx, authoredDo({ taskId: 'r1', planSnapshot: null }))).toBeNull();
  });

  it('detects remote checkbox or completion-stamp changes for undo preconditions', () => {
    const state = { id: 't1', completed: true, stamp: STAMP };
    expect(sameNativeCompletion(state, { ...state })).toBe(true);
    expect(sameNativeCompletion(state, { ...state, stamp: LATER })).toBe(false);
    expect(sameNativeCompletion(state, { ...state, completed: false })).toBe(false);
    expect(sameNativeCompletion(state, { ...state, id: 't2' })).toBe(false);
    expect(sameNativeCompletion(state, null)).toBe(false);
    expect(sameNativeCompletion(null, null)).toBe(true);
  });

  it('rejects a remote complete/reopen cycle even when completed and completedAt return to their previous values', () => {
    const before = nativeDoCompletionState({ tasks: [task({ completedAt: null, transitionId: 'local-uncheck' })] }, authoredDo());
    const after = nativeDoCompletionState({ tasks: [task({ completedAt: null, transitionId: 'remote-uncheck' })] }, authoredDo());
    expect(before).toMatchObject({ completed: false, stamp: null, transitionId: 'local-uncheck' });
    expect(after).toMatchObject({ completed: false, stamp: null, transitionId: 'remote-uncheck' });
    expect(sameNativeCompletion(before, after)).toBe(false);
    expect(sameNativeCompletion(before, { ...before })).toBe(true);
    expect(sameNativeCompletion({ ...before, transitionId: null }, { id: 't1', completed: false, stamp: null })).toBe(true);
  });

  it.each(['tasks', 'unscheduledTasks'])('returns the exact transitionId persisted in %s, including updater retries and no-ops', collection => {
    const original = task({ transitionId: 'before' });
    const deps = {
      tasks: [], unscheduledTasks: [], recurringTasks: [],
      setTasks: vi.fn(), setUnscheduledTasks: vi.fn(),
      pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(),
      onboardingProgress: { hasCompletedTask: true }, [collection]: [original],
    };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const actions = useTaskActions(deps);
    const current = nativeDoCompletionState(deps, authoredDo());
    const completed = actions.setJoboTaskCompletion(current, true, 'manual:existing');
    const setter = collection === 'tasks' ? deps.setTasks : deps.setUnscheduledTasks;
    const updater = setter.mock.calls[0][0];
    const stored = updater([original])[0];
    expect(stored.transitionId).toBe(completed.transitionId);
    expect(stored.transitionId).not.toBe('before');
    expect(updater([original])[0].transitionId).toBe(completed.transitionId);
    expect(nativeDoCompletionState({ [collection]: [stored] }, authoredDo())).toEqual(completed);
    expect(deps.pushUndo).not.toHaveBeenCalled();

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const nextActions = useTaskActions({ ...deps, [collection]: [stored] });
    expect(nextActions.setJoboTaskCompletion(completed, true, 'manual:existing')).toEqual(completed);
    expect(setter).toHaveBeenCalledTimes(1);
    const reopened = nextActions.setJoboTaskCompletion(completed, false, 'manual:existing');
    const reopenedTask = setter.mock.calls[1][0]([stored])[0];
    expect(reopened).toMatchObject({ completed: false, stamp: null, transitionId: reopenedTask.transitionId });
    expect(reopened.transitionId).not.toBe(completed.transitionId);
    expect(nativeDoCompletionState({ [collection]: [reopenedTask] }, authoredDo())).toEqual(reopened);
  });
});
