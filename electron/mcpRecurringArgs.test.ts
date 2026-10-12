import { describe, it, expect } from 'vitest';
import { planUpdateRecurringTask, parseRecurringInstanceIdArg } from './mcpRecurringArgs.js';

// dayglance_update_recurring_task argument rules (#2066). The scope is the
// caller's explicit choice, and series-level fields (notes, project, repeat)
// are refused at occurrence scope with copy that reads as design.

const TZ = 'America/Chicago';
const ID = 'recurring-abc-123-2026-10-13';
const plan = (args: Record<string, unknown>, multiUser = false) => planUpdateRecurringTask({ task_id: ID, ...args }, multiUser, TZ);
const fail = (args: Record<string, unknown>, multiUser = false) => {
  const r = plan(args, multiUser);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.message;
};

describe('parseRecurringInstanceIdArg', () => {
  it('takes the date off the end of a recurring occurrence id, whatever the series id holds', () => {
    expect(parseRecurringInstanceIdArg('recurring-abc-123-2026-10-13')).toEqual({ dateStr: '2026-10-13' });
    expect(parseRecurringInstanceIdArg('recurring-1712345678901-2026-02-28')).toEqual({ dateStr: '2026-02-28' });
  });
  it('rejects anything else', () => {
    for (const id of ['abc', 'recurring-abc', 'recurring-abc-2026-02-30', 42, undefined]) {
      expect(parseRecurringInstanceIdArg(id)).toBe(null);
    }
  });
});

describe('planUpdateRecurringTask', () => {
  it('requires a recurring occurrence id, pointing one-off edits at update_task', () => {
    const r = planUpdateRecurringTask({ task_id: 't1', scope: 'series', title: 'x' }, false, TZ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/dayglance_update_task/);
  });

  it('requires an explicit scope', () => {
    for (const scope of [undefined, 'all', 'this', 1]) {
      expect(fail({ scope, title: 'x' })).toMatch(/"occurrence".*"series"/);
    }
  });

  it('occurrence scope: the per-date fields', () => {
    expect(plan({ scope: 'occurrence', title: ' Standup ', start_time: '10:30', duration_minutes: 45 })).toEqual({
      ok: true,
      plan: { taskId: ID, scope: 'occurrence', set: { title: 'Standup', startTime: '10:30', durationMinutes: 45 }, clear: [] },
    });
    expect(plan({ scope: 'occurrence', all_day: true })).toMatchObject({ ok: true, plan: { set: { allDay: true } } });
  });

  it('occurrence scope refuses series-level fields by design', () => {
    expect(fail({ scope: 'occurrence', notes: 'n' })).toMatch(/notes belongs to the whole series by design/);
    expect(fail({ scope: 'occurrence', project_id: 'p1' })).toMatch(/project belongs to the whole series/);
    expect(fail({ scope: 'occurrence', repeat: { frequency: 'daily' } })).toMatch(/repeat belongs to the whole series/);
    expect(fail({ scope: 'occurrence', clear_fields: ['notes'] })).toMatch(/notes belongs to the whole series/);
  });

  it('series scope: every field, with repeat anchored on the edited occurrence', () => {
    const r = plan({ scope: 'series', notes: 'n', project_id: 'p1', repeat: { frequency: 'weekly' } });
    expect(r).toEqual({
      ok: true,
      plan: { taskId: ID, scope: 'series', set: { notes: 'n', projectId: 'p1', recurrence: { type: 'weekly', daysOfWeek: [2] } }, clear: [] },
    });
  });

  it('a bad repeat is the repeat parser\'s by-design error', () => {
    expect(fail({ scope: 'series', repeat: { frequency: 'daily', interval: 2 } })).toMatch(/no interval by design/);
  });

  it('start_time is validated on the occurrence\'s date, DST included', () => {
    expect(fail({ scope: 'occurrence', start_time: '9:00' })).toMatch(/HH:MM/);
    const gap = planUpdateRecurringTask({ task_id: 'recurring-x-2026-03-08', scope: 'occurrence', start_time: '02:30' }, false, TZ);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.message).toMatch(/does not exist/);
  });

  it('all_day contradicts start_time and duration', () => {
    expect(fail({ scope: 'series', all_day: true, start_time: '09:00' })).toMatch(/contradict/);
    expect(fail({ scope: 'series', all_day: true, duration_minutes: 30 })).toMatch(/contradict/);
  });

  it('clear_fields: only notes and project, plus assignee in multi-user mode', () => {
    expect(plan({ scope: 'series', clear_fields: ['notes', 'project'] })).toMatchObject({ ok: true, plan: { clear: ['notes', 'project'] } });
    expect(fail({ scope: 'series', clear_fields: ['title'] })).toMatch(/never cleared/);
    expect(fail({ scope: 'series', clear_fields: ['assignee'] })).toMatch(/accepts only "notes", "project"/);
    expect(plan({ scope: 'occurrence', clear_fields: ['assignee'] }, true)).toMatchObject({ ok: true, plan: { clear: ['assignee'] } });
  });

  it('assignee_id needs multi-user mode', () => {
    expect(fail({ scope: 'series', assignee_id: 'u1' })).toMatch(/multi-user/);
    expect(plan({ scope: 'series', assignee_id: 'u1' }, true)).toMatchObject({ ok: true, plan: { set: { assigneeSyncId: 'u1' } } });
  });

  it('setting and clearing the same field, or changing nothing, is a validation error', () => {
    expect(fail({ scope: 'series', notes: 'n', clear_fields: ['notes'] })).toMatch(/both set and cleared/);
    expect(fail({ scope: 'series' })).toMatch(/Nothing to change/);
    expect(fail({ scope: 'series', title: '  ' })).toMatch(/non-empty/);
  });
});
