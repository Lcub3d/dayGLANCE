import { describe, expect, it } from 'vitest';
import { CARRY_ACTION, nextStepSummary, notStartedAction, notStartedTasks } from './carryForward.js';
import { createDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { buildCheckJournal } from '../components/jobo/checkJournal.js';

// The Not started group and the summary line (docs/jobo-carry-forward.md,
// addendum). Built on the real day model, as the Check builds them.
const monday = '2026-09-28';
const wednesday = '2026-09-30';
const task = (id, patch = {}) => ({ id, title: id, date: monday, startTime: '09:00', duration: 60, color: 'bg-blue-500', completed: false, ...patch });
const session = (taskId, patch = {}) => createDoRecord({
  id: `r-${taskId}`, taskId, title: taskId, source: 'manual', progress: 'partial', timing: 'timed',
  date: monday, startTime: '09:00', endDate: monday, endTime: '09:20', planSnapshot: { date: monday, startTime: '09:00', duration: 60 },
  createdAt: `${monday}T10:00:00Z`, updatedAt: `${monday}T10:00:00Z`, observedAt: `${monday}T10:00:00Z`, ...patch,
});

// The Check for `date`, read at `today` `time`, as JoboView builds it.
function check({ tasks = [], records = [], date = monday, today = wednesday, time = '18:00', allDay = [] } = {}) {
  const timed = tasks.filter(row => row.date === date && !row.isAllDay);
  const model = buildJoboDayModel({ date, tasks: timed, taskLookup: [...tasks, ...allDay], records, now: { date: today, time } });
  const entries = buildCheckJournal(model, date);
  const notStarted = notStartedTasks(model, { date, today, entries, dayTasks: [...tasks, ...allDay].filter(row => row.date === date) });
  return { model, entries, notStarted, summary: nextStepSummary(model, { date, today, entries, notStarted }) };
}
const ids = items => items.map(item => item.id);

describe('notStartedTasks', () => {
  it('lists a planned task with no Do, offering Continue with its full duration', () => {
    const { notStarted } = check({ tasks: [task('write')] });
    expect(ids(notStarted)).toEqual(['write']);
    expect(notStarted[0].action).toMatchObject({
      kind: CARRY_ACTION.CONTINUE,
      slot: { date: '2026-10-01', startTime: '09:00', duration: 60, isAllDay: false },
      unschedule: 'inbox', remove: true,
    });
  });
  it('moves a project task back to its project rather than the Inbox', () => {
    expect(check({ tasks: [task('write', { projectId: 'p1' })] }).notStarted[0].action.unschedule).toBe('project');
  });
  it('leaves out a task with a Do, which the journal already lists', () => {
    const { notStarted, entries } = check({ tasks: [task('write'), task('read', { startTime: '11:00' })], records: [session('write')] });
    expect(ids(entries.map(entry => ({ id: String(entry.sourceTask.id) })))).toEqual(['write']);
    expect(ids(notStarted)).toEqual(['read']);
  });
  it('leaves out a task with a Do recorded under an earlier plan of the same day', () => {
    // The Do was against 09:00; the task now sits at 14:00 with nothing under that plan.
    const moved = task('write', { startTime: '14:00' });
    expect(ids(check({ tasks: [moved], records: [session('write')] }).notStarted)).toEqual([]);
  });
  it.each([
    ['completed', { completed: true }],
    ['archived', { archived: true }],
    ['a calendar event', { imported: true }],
  ])('leaves out a task that is %s', (_, patch) => {
    expect(check({ tasks: [task('x', patch)] }).notStarted).toEqual([]);
  });
  it('lists a recurring occurrence with nothing to offer', () => {
    const occurrence = task('recurring-tpl-2026-09-28', { recurringTemplateId: 'tpl', isRecurring: true });
    const { notStarted } = check({ tasks: [occurrence] });
    expect(notStarted).toHaveLength(1);
    expect(notStarted[0]).toMatchObject({ recurring: true, action: { kind: CARRY_ACTION.NONE } });
  });
  it('lets a task-calendar item continue, but not move or delete what its calendar owns', () => {
    const { notStarted } = check({ tasks: [task('caldav', { imported: true, isTaskCalendar: true })] });
    expect(notStarted[0].action.kind).toBe(CARRY_ACTION.CONTINUE);
    expect(notStarted[0].action).not.toHaveProperty('unschedule');
    expect(notStarted[0].action).not.toHaveProperty('remove');
  });

  describe("on today's Check", () => {
    const day = { date: wednesday, today: wednesday };
    const at = (time, tasks) => check({ ...day, time, tasks: tasks.map(row => ({ ...row, date: wednesday })) });
    it('lists a task once its planned end has passed, not while it is to come or under way', () => {
      const tasks = [task('morning', { startTime: '08:00' }), task('now', { startTime: '13:30' }), task('later', { startTime: '16:00' })];
      expect(ids(at('14:00', tasks).notStarted)).toEqual(['morning']);
      expect(ids(at('14:30', tasks).notStarted)).toEqual(['morning', 'now']);
    });
    it('does not list an all-day task, whose day is not over', () => {
      expect(check({ ...day, allDay: [task('offsite', { date: wednesday, isAllDay: true, startTime: '00:00' })] }).notStarted).toEqual([]);
    });
  });

  it('lists an all-day task on a past day, first, and continues it as all-day', () => {
    const { notStarted } = check({ tasks: [task('write')], allDay: [task('offsite', { isAllDay: true, startTime: '00:00', duration: 30 })] });
    expect(ids(notStarted)).toEqual(['offsite', 'write']);
    expect(notStarted[0]).toMatchObject({ allDay: true, action: { slot: { date: '2026-10-01', isAllDay: true } } });
  });
  it('orders timed tasks by their planned start', () => {
    const tasks = [task('late', { startTime: '15:00' }), task('early', { startTime: '07:00' }), task('mid', { startTime: '11:00' })];
    expect(ids(check({ tasks }).notStarted)).toEqual(['early', 'mid', 'late']);
  });
  it('lists only tasks still on the day, whatever list it is handed', () => {
    const { model, entries } = check({ tasks: [task('write')] });
    const moved = task('offsite', { date: '2026-09-29', isAllDay: true });
    expect(ids(notStartedTasks(model, { date: monday, today: wednesday, entries, dayTasks: [moved] }))).toEqual(['write']);
  });
  it('lists nothing when the ledger has unreadable records, rather than guessing', () => {
    const broken = { id: 'bad', taskId: 'x', timing: 'timed' };
    expect(check({ tasks: [task('write')], records: [broken] }).notStarted).toEqual([]);
  });
});

describe('notStartedAction', () => {
  it('needs a usable today', () => {
    expect(notStartedAction(task('write'), { today: undefined }).kind).toBe(CARRY_ACTION.NONE);
  });
});

describe('nextStepSummary', () => {
  it('counts unfinished journal entries still on the day and tasks not started', () => {
    const tasks = [task('partial'), task('idle', { startTime: '11:00' }), task('done', { startTime: '13:00', completed: true })];
    const records = [session('partial'), session('done', { id: 'r-done', startTime: '13:00', endTime: '14:00', planSnapshot: { date: monday, startTime: '13:00', duration: 60 } })];
    expect(check({ tasks, records }).summary).toEqual({ pending: 2 });
  });
  it('does not count a recurring occurrence', () => {
    const occurrence = task('recurring-tpl-2026-09-28', { recurringTemplateId: 'tpl', isRecurring: true });
    expect(check({ tasks: [occurrence] }).summary).toEqual({ pending: 0 });
  });
  it('reaches zero once every task has a next step: continued, moved off or finished', () => {
    const moved = task('partial', { date: '2026-10-01' });
    const records = [session('partial')];
    expect(check({ tasks: [moved, task('done', { startTime: '11:00', completed: true })], records }).summary).toEqual({ pending: 0 });
  });
  it('counts a task once, however many entries it has', () => {
    const tasks = [task('write', { startTime: '14:00' })];
    const records = [session('write'), session('write', { id: 'r-2', startTime: '14:00', endTime: '14:30', planSnapshot: { date: monday, startTime: '14:00', duration: 60 } })];
    const { entries, summary } = check({ tasks, records });
    expect(entries.length).toBe(2);
    expect(summary).toEqual({ pending: 1 });
  });
  it('has nothing to say on a day with no plan and no Do', () => {
    expect(check({}).summary).toBeNull();
    expect(check({ tasks: [task('event', { imported: true })] }).summary).toBeNull();
  });
});
