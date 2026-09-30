import { describe, expect, it } from 'vitest';
import { createDoRecord } from '../../jobo/core.js';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { completionMarker } from '../../jobo/completionMarker.js';
import { buildCheckJournal, checkPlanEnd } from './checkJournal.js';

const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { id: 't1', title: 'Report', ...plan, color: 'bg-red-500' };
const stamp = `${date}T12:00:00+08:00`;
const row = (over = {}) => createDoRecord({ id: 'r1', taskId: 't1', title: 'Recorded report', source: 'completion',
  timing: 'timed', date, startTime: '09:10', endDate: date, endTime: '10:20',
  planSnapshot: plan, progress: 'partial', createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over });
const model = (records = [row()], extra = {}) => buildJoboDayModel({ date, tasks: [task], taskLookup: [task], records, ...extra });
const point = (over = {}) => row({ timing: 'untimed', startTime: null, endDate: null, endTime: null, ...over });
const entries = journal => [...journal.planned, ...journal.unplanned];

describe('Check journal reads the day model without regrouping it', () => {
  it('distinguishes an unavailable model from an empty journal', () => {
    expect(buildCheckJournal(null)).toBeNull();
    expect(buildCheckJournal(model([]))).toEqual({ planned: [], unplanned: [], invalidRecordCount: 0 });
  });
  it('keeps one entry for a captured plan even when the current task has been renamed', () => {
    const m = model();
    expect(m.plans).toHaveLength(2); // renamed live Plan plus frozen Plan
    const journal = buildCheckJournal(m);
    expect(journal.planned).toHaveLength(1);
    expect(journal.planned[0]).toMatchObject({ title: 'Recorded report', plan, sourceTask: task });
  });
  it('orders entries by actual first visible execution, not their plans, titles or insertion order', () => {
    const records = [row({ id: 'late', taskId: 'late', startTime: '15:00', endTime: '16:00', planSnapshot: { ...plan, startTime: '07:00' } }),
      row({ id: 'early', taskId: 'early', startTime: '08:00', endTime: '09:00', planSnapshot: { ...plan, startTime: '15:00' } })];
    const journal = buildCheckJournal(model(records));
    expect(journal.planned.map(e => e.notesRecord.id)).toEqual(['early', 'late']);
  });
  it('lists unplanned Do after Plan groups, chronologically, and does not merge unrelated manual records', () => {
    const unplanned = id => row({ id, taskId: null, source: 'manual', planSnapshot: null });
    const journal = buildCheckJournal(model([unplanned('z'), row(), unplanned('a')]));
    expect(journal.planned).toHaveLength(1);
    expect(journal.unplanned.map(e => e.attempts[0].id)).toEqual(['a', 'z']);
  });
  it('sorts sessions by execution time but preserves the model latest-progress decision', () => {
    const earlierCreated = row({ id: 'later-work', startTime: '11:00', endTime: '11:30', progress: 'completed' });
    const laterCreated = row({ id: 'earlier-work', startTime: '09:10', createdAt: `${date}T13:00:00+08:00`, updatedAt: `${date}T13:00:00+08:00`, progress: 'mostly' });
    const e = buildCheckJournal(model([earlierCreated, laterCreated])).planned[0];
    expect(e.attempts.map(r => r.id)).toEqual(['earlier-work', 'later-work']);
    expect(e.latestAttempt).toBe(laterCreated);
    expect(e.latestAttempt.progress).toBe('mostly');
  });
  it('does not change session order when an old record is corrected', () => {
    const a = row({ id: 'a', startTime: '08:00', endTime: '08:30', updatedAt: '2026-10-01T00:00:00Z' });
    expect(buildCheckJournal(model([row(), a])).planned[0].attempts.map(r => r.id)).toEqual(['a', 'r1']);
  });
  it('keeps separate captured schedules for the same task', () => {
    const j = buildCheckJournal(model([row(), row({ id: 'new-plan', planSnapshot: { ...plan, startTime: '14:00' } })]));
    expect(j.planned).toHaveLength(2);
    expect(new Set(j.planned.map(e => e.key)).size).toBe(2);
  });
  it('only includes groups touched on this day, but retains off-day sessions in their full comparisons', () => {
    const offDay = row({ id: 'tomorrow', date: '2026-09-29', endDate: '2026-09-29' });
    const m = model([row(), offDay]);
    const e = buildCheckJournal(m).planned[0];
    expect(e.attempts).toHaveLength(2);
    expect(e.comparison).toBe(m.timedRecords[0].comparison);
    expect(e.comparisonMeta).toBe(m.timedRecords[0].comparisonMeta);
    expect(buildCheckJournal(model([offDay])).planned).toHaveLength(0);
  });
  it('includes execution against an earlier plan without replacing the snapshot with the current schedule', () => {
    const yesterdayPlan = { ...plan, date: '2026-09-27' };
    const e = buildCheckJournal(model([row({ planSnapshot: yesterdayPlan })])).planned[0];
    expect(e.plan).toEqual(yesterdayPlan);
    expect(e.title).toBe('Recorded report');
  });
  it('uses day clipping only for journal ordering, not to truncate stored cross-midnight sessions', () => {
    const crossing = row({ id: 'cross', date: '2026-09-27', startTime: '23:30', endTime: '00:30' });
    const e = buildCheckJournal(model([crossing])).planned[0];
    expect(e.startMinute).toBe(0);
    expect(e.attempts[0]).toBe(crossing);
    expect(e.attempts[0].date).toBe('2026-09-27');
  });
  it('does not include a timed session on the following day when it ends exactly at midnight', () => {
    const m = model([row({ date: '2026-09-27', startTime: '23:00', endTime: '00:00' })]);
    expect(entries(buildCheckJournal(m))).toHaveLength(0);
  });
  it('orders untimed completions by the existing local marker, never by title or UTC prefix', () => {
    const r = point({ createdAt: '2026-09-29T02:00:00Z', updatedAt: '2026-09-29T02:00:00Z' });
    const marker = completionMarker(r);
    const e = buildCheckJournal(model([r], { date: marker.date })).planned[0];
    expect(e.startMinute).toBe(marker.startMinute);
    expect(e.attempts[0].startTime).toBeNull();
  });
  it('keeps inferred and missing time non-comparable instead of substituting a plan estimate', () => {
    const m = model([row({ timingBasis: 'planDuration' }), point({ id: 'point' })]);
    const e = buildCheckJournal(m).planned[0];
    expect(e.comparison).toBeNull();
    expect(e.comparisonMeta.hasEstimatedAttempts).toBe(true);
    expect(e.attempts).toHaveLength(2);
    expect(e.attempts.find(r => r.id === 'point').timing).toBe('untimed');
  });
  it('retains the model visibility, winning records and tombstone decisions', () => {
    const newer = row({ startTime: '09:40', updatedAt: '2026-10-01T00:00:00Z' });
    expect(buildCheckJournal(model([row(), newer])).planned[0].attempts).toEqual([newer]);
    expect(entries(buildCheckJournal(model([{ ...newer, deleted: true }, row()])))).toEqual([]);
    expect(entries(buildCheckJournal(model([row()], { isVisibleForUser: () => false })))).toEqual([]);
  });
  it('does not invent task notes for orphaned or unlinked history', () => {
    const e = buildCheckJournal(model([row()], { taskLookup: [], tasks: [] })).planned[0];
    expect(e.sourceTask).toBeNull();
    expect(e.title).toBe('Recorded report');
  });
  it('keeps recurring occurrences separate, including when they share a template id and have no plan', () => {
    const r = point({ id: `do:tmpl:2026-09-28:${stamp}`, taskId: 'tmpl', planSnapshot: null });
    const r2 = point({ id: `do:tmpl:2026-09-27:${stamp}`, taskId: 'tmpl', planSnapshot: null });
    const j = buildCheckJournal(model([r,r2]));
    expect(j.unplanned).toHaveLength(2);
  });
  it('preserves incomplete-ledger evidence separately from a clean empty day', () => {
    const j = buildCheckJournal(model([row(), { id: 'bad' }]));
    expect(j.invalidRecordCount).toBe(1);
    expect(j.planned).toHaveLength(1);
  });
  it('does not mutate the model, dates, arrays, records or shared comparison objects', () => {
    const m = model([row(), row({ id: 'second', startTime: '08:00' })]);
    const original = JSON.stringify(m);
    const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
    freeze(m);
    expect(() => buildCheckJournal(m)).not.toThrow();
    expect(JSON.stringify(m)).toBe(original);
  });
  it.each([
    [{ date: '2026-03-08', startTime: '01:30', duration: 120 }, { date: '2026-03-08', time: '03:30' }],
    [{ date: '2028-02-28', startTime: '23:00', duration: 120 }, { date: '2028-02-29', time: '01:00' }],
    [{ date: '2026-12-31', startTime: '23:00', duration: 120 }, { date: '2027-01-01', time: '01:00' }],
  ])('formats a plan end in civil coordinates (%s)', (plan, end) => expect(checkPlanEnd(plan)).toEqual(end));
  it('does not supply missing plan coordinates', () => expect(checkPlanEnd(null)).toBeNull());
});
