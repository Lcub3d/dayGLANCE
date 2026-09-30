import { describe, expect, it } from 'vitest';
import { buildCheckJournal, journalMoment, journalPlanRange, journalRange } from './checkJournal.js';
import { createDoRecord } from '../../jobo/core.js';
import { buildJoboDayModel } from '../../jobo/viewModel.js';

const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { ...plan, id: 't1', title: 'Report', color: 'bg-green-500', completed: true };
const row = (patch = {}) => createDoRecord({
  id: 'r1', taskId: task.id, title: task.title, source: 'completion', progress: 'partial',
  timing: 'timed', date, startTime: '09:10', endDate: date, endTime: '09:40', planSnapshot: plan,
  createdAt: `${date}T10:00:00+08:00`, updatedAt: `${date}T10:00:00+08:00`, observedAt: `${date}T10:00:00+08:00`, ...patch,
});
const untimed = patch => row({ timing: 'untimed', startTime: null, endDate: null, endTime: null, ...patch });
const modelFor = (records, extra = {}) => buildJoboDayModel({ date, records, tasks: [task], taskLookup: [task], ...extra });
const journal = (records, extra) => buildCheckJournal(modelFor(records, extra), extra?.date || date);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}

describe('Check journal is a projection, not a second day model', () => {
  it('does not turn missing records into an unchecked planning form', () => {
    expect(buildCheckJournal(null, date)).toEqual([]);
    expect(journal([])).toEqual([]);
  });
  it.each(['2026-09-27', '2026-09-29'])('excludes a plan whose only execution was on %s', executionDate => {
    const record = row({ date: executionDate, endDate: executionDate });
    const model = modelFor([record]);
    // The day model retains this history for Plan comparison, not as a Do today.
    expect(model.plans.some(item => item.attempts.length > 0)).toBe(true);
    expect(model.timedRecords).toHaveLength(0);
    expect(buildCheckJournal(model, date)).toEqual([]);
  });
  it('excludes an off-day completion marker rather than ordering it by the current plan', () => {
    const record = untimed({ date: '2026-09-29', createdAt: '2026-09-29T10:00:00+08:00', updatedAt: '2026-09-29T10:00:00+08:00' });
    const model = modelFor([record]);
    expect(model.untimedRecords).toHaveLength(0);
    expect(buildCheckJournal(model, date)).toEqual([]);
  });
  it('combines one captured Plan with all sessions, reusing comparisons and latest progress', () => {
    const records = [row(), row({ id: 'r2', startTime: '10:00', endTime: '10:45', progress: 'mostly', createdAt: `${date}T11:00:00+08:00`, updatedAt: `${date}T11:00:00+08:00` })];
    const model = modelFor(records); const entries = buildCheckJournal(model, date);
    expect(entries).toHaveLength(1);
    expect(entries[0].sessions.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(entries[0].comparison).toBe(model.plans[0].comparison);
    expect(entries[0].comparisonMeta).toBe(model.plans[0].comparisonMeta);
    expect(entries[0].latestAttempt).toBe(model.plans[0].latestAttempt);
    expect(entries[0].latestAttempt.progress).toBe('mostly'); // native task completed is not Do progress
  });
  it('sorts actual execution time, not creation, correction or alphabetic title', () => {
    const a = row({ id: 'last', taskId: null, source: 'manual', planSnapshot: null, startTime: '14:00', endTime: '15:00' });
    const b = row({ id: 'first', taskId: null, source: 'manual', planSnapshot: null, startTime: '08:00', endTime: '08:30', updatedAt: `${date}T23:00:00+08:00` });
    expect(journal([a, row(), b]).map(e => e.sessions[0].id)).toEqual(['first', 'r1', 'last']);
  });
  it('has a stable tie-break independent of input order', () => {
    const a = row({ id: 'a', taskId: null, planSnapshot: null, source: 'manual' });
    const b = row({ ...a, id: 'b' });
    expect(journal([b, a]).map(e => e.id)).toEqual(journal([a, b]).map(e => e.id));
  });
  it('does not merge unrelated unlinked manual work', () => {
    const records = ['a', 'b'].map(id => row({ id, source: 'manual', taskId: null, planSnapshot: null }));
    expect(journal(records).map(e => e.sessions.length)).toEqual([1, 1]);
  });
  it('keeps the captured title and plan after a rename or reschedule', () => {
    const records = [row()];
    for (const changed of [{ ...task, title: 'Renamed' }, { ...task, title: 'Renamed', startTime: '14:00' }]) {
      const entries = journal(records, { tasks: [changed], taskLookup: [changed] });
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe('Report');
      expect(entries[0].plan).toEqual(plan);
      expect(entries[0].sourceTask.title).toBe('Renamed');
    }
  });
  it('keeps captured titles for executions without a visible Plan anchor', () => {
    const renamed = { ...task, title: 'Renamed', startTime: '14:00' };
    const records = [row({ planSnapshot: null }), row({ id: 'off-day', planSnapshot: { ...plan, date: '2026-09-27' } })];
    const entries = journal(records, { tasks: [renamed], taskLookup: [renamed] });
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => entry.title === 'Report')).toBe(true);
    expect(entries.every(entry => entry.sourceTask.title === 'Renamed')).toBe(true);
  });
  it('shows a valid orphan capture, without inventing a notes target', () => {
    const [entry] = journal([row()], { tasks: [], taskLookup: [] });
    expect(entry.title).toBe('Report'); expect(entry.noteKey).toBeNull(); expect(entry.sourceTask).toBeNull();
  });
  it('preserves full cross-midnight sessions while using the selected-day ordering', () => {
    const record = row({ date: '2026-09-27', startTime: '23:30', endTime: '00:30' });
    const [entry] = journal([record]);
    expect(entry.sessions[0]).toBe(record); expect(entry.visible[0].startMinute).toBe(0);
  });
  it('includes off-day history once, with its existing whole-group comparison', () => {
    const second = row({ id: 'next', date: '2026-09-29', endDate: '2026-09-29', startTime: '10:00', endTime: '10:30', progress: 'completed' });
    const entries = journal([row(), second]);
    expect(entries).toHaveLength(1); expect(entries[0].sessions).toHaveLength(2);
    const next = journal([row(), second], { date: '2026-09-29', tasks: [] });
    expect(next).toHaveLength(1); expect(next[0].plan).toEqual(plan); expect(next[0].sessions).toHaveLength(2);
  });
  it('does not infer a measured time from a completion point or manual creation stamp', () => {
    const record = untimed({ progress: 'completed' });
    const [entry] = journal([record]);
    expect(entry.sessions[0].startTime).toBeNull(); expect(entry.sessions[0].endDate).toBeNull();
    expect(journalMoment(record)).toEqual({ date, time: '10:00' });
    expect(journalMoment(untimed({ source: 'manual', taskId: null, planSnapshot: null }))).toBeNull();
  });
  it('puts untimed manual work last rather than pretending its save time was work time', () => {
    const manual = untimed({ id: 'm', source: 'manual', taskId: null, planSnapshot: null });
    expect(journal([manual, row()]).at(-1).sessions[0].id).toBe('m');
  });
  it('does not substitute a linked manual Plan time for an unknown execution time', () => {
    const manual = untimed({ id: 'manual', source: 'manual' });
    const timed = row({ id: 'timed', taskId: null, source: 'manual', planSnapshot: null, startTime: '14:00', endTime: '14:30' });
    expect(journal([manual, timed]).map(entry => entry.sessions[0].id)).toEqual(['timed', 'manual']);
  });
  it('uses the existing local projection of UTC completion stamps', () => {
    const record = untimed({ date: '2026-09-29', planSnapshot: null, createdAt: '2026-09-29T02:00:00Z', updatedAt: '2026-09-29T02:00:00Z', observedAt: '2026-09-29T02:00:00Z' });
    const local = journalMoment(record);
    const entries = journal([record], { date: local.date, tasks: [] });
    expect(entries).toHaveLength(1);
    expect(entries[0].visible[0].time).toBe(local.time);
    expect(record.date).toBe('2026-09-29');
  });
  it('does not turn inferred intervals into complete comparison data', () => {
    const [entry] = journal([row({ timingBasis: 'planDuration' })]);
    expect(entry.comparison).toBeNull(); expect(entry.comparisonMeta.hasEstimatedAttempts).toBe(true);
  });
  it('uses the model winner, ignores tombstones, and does not mutate frozen inputs', () => {
    const original = row(); const corrected = row({ endTime: '10:10', updatedAt: `${date}T12:00:00+08:00` });
    const model = deepFreeze(modelFor([original, corrected]));
    const before = JSON.stringify(model); const entries = buildCheckJournal(model, date);
    expect(entries[0].sessions).toEqual([corrected]); expect(JSON.stringify(model)).toBe(before);
    expect(journal([original, row({ deleted: true, updatedAt: `${date}T12:00:00+08:00` })])).toEqual([]);
  });
  it('inherits household visibility, including off-day sessions', () => {
    const otherTask = { ...task, id: 'private', title: 'Private' };
    const entries = journal([row(), row({ id: 'hidden', taskId: 'private', title: 'Private' })], {
      tasks: [task, otherTask], taskLookup: [task, otherTask], isVisibleForUser: t => t.id !== 'private',
    });
    expect(entries).toHaveLength(1); expect(entries[0].sessions.map(r => r.id)).toEqual(['r1']);
  });
  it('keeps recurring occurrence identities separate', () => {
    const template = { id: 'repeat', title: 'Routine', startTime: '09:00', duration: 30, completedDates: [] };
    const records = ['2026-09-27', date].map((day, i) => row({ id: `do:repeat:${day}:${day}T10:00:00+08:00`, taskId: 'repeat', planSnapshot: { ...plan, date: day }, startTime: `${10 + i}:00`, endTime: `${10 + i}:30` }));
    const entries = journal(records, { tasks: [], taskLookup: [], recurringTasks: [template] });
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map(e => e.noteKey)).size).toBe(2);
  });
});

describe('journal range formatting preserves civil dates', () => {
  it('shows 26 hours with both dates rather than clipping to two hours', () => {
    expect(journalRange(date, '09:00', '2026-09-29', '11:00', date, t => t)).toBe('09:00–2026-09-29 11:00');
    expect(journalPlanRange({ ...plan, duration: 1560 }, date, t => t)).toBe('09:00–2026-09-29 11:00');
  });
  it('uses the caller clock preference at both ends, including midnight', () => {
    expect(journalPlanRange({ ...plan, startTime: '23:30' }, date, value => `clock(${value})`)).toBe('clock(23:30)–2026-09-29 clock(00:30)');
  });
  it('leaves a missing plan missing', () => expect(journalPlanRange(null, date, t => t)).toBeNull());
});
