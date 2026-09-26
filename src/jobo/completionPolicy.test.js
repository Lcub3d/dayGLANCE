import { describe, expect, it } from 'vitest';
import { latestDoForTask } from './completionPolicy.js';
import { routeDoCompletionEdges } from './completionBridge.js';

const task = { id: 't', completed: false };
const row = (id, startTime, rest = {}) => ({ id, taskId: 't', date: '2026-09-26', startTime,
  endDate: '2026-09-26', endTime: startTime, createdAt: '2026-09-26T04:00:00.000Z',
  timing: 'timed', progress: 'completed', ...rest });
const context = records => ({ tasks: [task], records });

describe('native checkbox follows the last Do on its execution timeline', () => {
  it('uses execution start time rather than creation/update order or any completed attempt', () => {
    const earlier = row('later-created', '09:00', { createdAt: '2026-09-27T04:00:00.000Z' });
    const last = row('last', '10:00', { progress: 'partial' });
    expect(latestDoForTask(context([last, earlier]), earlier)).toBe(last);
    expect(latestDoForTask(context([{ ...last, updatedAt: '2099-01-01T00:00:00Z' }, earlier]), earlier).id).toBe('last');
  });
  it('re-evaluates after moving or deleting the last row and never mixes tasks', () => {
    const a = row('a', '09:00'); const b = row('b', '10:00', { progress: 'started' });
    expect(latestDoForTask(context([a, { ...b, startTime: '08:00' }]), a)).toBe(a);
    expect(latestDoForTask(context([a, { ...b, deleted: true }, row('other', '23:00', { taskId: 'other' })]), b)).toBe(a);
    expect(latestDoForTask(context([{ ...a, deleted: true }]), a)).toBeNull();
  });
  it('orders across days, ties deterministically, and ignores record array order', () => {
    const a = row('a', '23:00'); const b = row('b', '00:30', { date: '2026-09-27' });
    expect(latestDoForTask(context([b, a]), a)).toBe(b);
    const c = { ...b, id: 'c' };
    expect(latestDoForTask(context([c, b]), a)).toBe(c);
    expect(latestDoForTask(context([b, c]), a)).toBe(c);
  });
  it('uses Untimed creation order only if no timed row has a timeline position', () => {
    const timed = row('timed', '08:00');
    const untimed = row('untimed', null, { timing: 'untimed', createdAt: '2026-09-28T00:00:00.000Z' });
    expect(latestDoForTask(context([timed, untimed]), timed)).toBe(timed);
    expect(latestDoForTask(context([untimed]), timed)).toBe(untimed);
  });
  it('keeps recurring occurrences separate by captured plan, even when Do is on a later day', () => {
    const a = row('a', '09:00', { taskId: 'repeat', date: '2026-09-28', planSnapshot: { date: '2026-09-26' } });
    const b = row('b', '10:00', { taskId: 'repeat', date: '2026-09-28', planSnapshot: { date: '2026-09-27' } });
    const ctx = { recurringTasks: [{ id: 'repeat' }], records: [a, b] };
    expect(latestDoForTask(ctx, a)).toBe(a);
    expect(latestDoForTask(ctx, b)).toBe(b);
    expect(latestDoForTask(ctx, { ...a, planSnapshot: null })).toBeNull();
  });
  it('routes native reopening to the last loaded Do only for Do-origin completions', () => {
    const a = row('a', '09:00'), b = row('b', '10:00');
    const key = 'do:t:stamp';
    const ctx = { tasks: [{ ...task, joboCompletionLinks: { [key]: 'a' } }], records: [a, b] };
    const edges = { uncompletions: [{ id: key }, { id: 'ordinary' }] };
    expect(routeDoCompletionEdges(edges, ctx, id => latestDoForTask(ctx, ctx.records.find(row => row.id === id))?.id || id).uncompletions)
      .toEqual([{ id: 'b' }, { id: 'ordinary' }]);
  });
});
