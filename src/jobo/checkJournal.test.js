import { describe, it, expect } from 'vitest';
import { buildJoboDayModel } from './viewModel.js';
import { buildCheckJournal } from './checkJournal.js';
import { createDoRecord } from './core.js';
import { completionMoment } from './completionMarker.js';

const date = '2026-09-24';
const stamp = `${date}T12:00:00+08:00`;
const plan = { date, startTime: '09:00', duration: 60 };
const task = { id: 't1', title: 'Live task', ...plan, completed: false, notes: '**Current** note' };
const record = (extra = {}) => createDoRecord({
  id: 'a', source: 'manual', taskId: 't1', title: 'Captured title', progress: 'partial',
  timing: 'timed', date, startTime: '09:00', endDate: date, endTime: '09:30',
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, planSnapshot: plan, ...extra,
});
const point = (extra = {}) => record({ timing: 'untimed', startTime: null, endDate: null, endTime: null, ...extra });
const model = (records, extra = {}) => buildJoboDayModel({ date, tasks: [task], taskLookup: [task], records, ...extra });
const journal = (records, extra = {}) => buildCheckJournal(model(records, extra));
const ids = result => result.entries.map(item => item.id);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

describe('Check journal, a projection of the day model', () => {
  it('mixes intervals and completion points in actual time order, not creation/title order', () => {
    const rows = [record({ id: 'late', startTime: '13:00', endTime: '13:30' }),
      point({ id: 'point', source: 'completion', progress: 'completed', createdAt: `${date}T10:00:00+08:00` }), record({ id: 'early' })];
    expect(ids(journal(rows))).toEqual(['early', 'point', 'late']);
  });
  it('breaks equal-time ties by id, independent of input and update timestamps', () => {
    const a = record({ id: 'a', updatedAt: '2026-09-25T12:00:00+08:00' });
    const b = record({ id: 'b' });
    expect(ids(journal([b, a]))).toEqual(['a', 'b']);
    expect(ids(journal([a, b]))).toEqual(['a', 'b']);
  });
  it('orders a full group by execution even when earlier work was entered later', () => {
    const earlier = record({ id: 'earlier', createdAt: '2026-09-25T12:00:00+08:00', updatedAt: '2026-09-25T12:00:00+08:00' });
    const later = record({ id: 'later', startTime: '14:00', endTime: '14:30' });
    const source = model([later, earlier]);
    expect(source.timedRecords[0].attempts[0].id).toBe('earlier');
    expect(buildCheckJournal(source).entries[0].attempts.map(row => row.id)).toEqual(['earlier', 'later']);
  });
  it('does not mutate the day model or the ledger', () => {
    const source = freeze(model([record(), point({ id: 'b' })]));
    const before = JSON.stringify(source);
    const result = buildCheckJournal(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.entries[0].record).toBe(source.timedRecords[0].record);
  });
  it('does not manufacture a Do from a completed native task or elapsed plan', () => {
    expect(journal([], { tasks: [{ ...task, completed: true }], now: { date: '2026-09-25', time: '12:00' } }).entries).toEqual([]);
  });
  it('does not give an untimed completion its planned duration', () => {
    const item = journal([point({ source: 'completion', progress: 'completed' })]).entries[0];
    expect(item.recordedMinutes).toBeNull();
    expect(item.measuredSessions).toBe(0);
    expect(item.unmeasuredAttempts).toBe(1);
    expect(item.record.timing).toBe('untimed');
    expect(item.endMinute).toBe(item.startMinute);
  });
  it('keeps a mixed group incomplete and the measured subset distinct', () => {
    const entries = journal([record(), point({ id: 'p' })]).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].measuredSessions).toBe(1);
    expect(entries[0].unmeasuredAttempts).toBe(1);
    expect(entries[0].comparison.comparable).toBe(false);
    expect(entries[0].comparisonMeta.measuredComparison.metrics.recordedMinutes).toBe(30);
  });
  it('does not treat a stored plan-duration estimate as measured time', () => {
    const item = journal([record({ timingBasis: 'planDuration' })]).entries[0];
    expect(item.recordedMinutes).toBeNull();
    expect(item.measuredSessions).toBe(0);
    expect(item.comparison).toBeNull();
    expect(item.comparisonMeta.hasEstimatedAttempts).toBe(true);
  });
  it('clips only the day duration while preserving the full cross-midnight record', () => {
    const row = record({ date: '2026-09-23', startTime: '23:30', endTime: '00:30' });
    const item = journal([row]).entries[0];
    expect(item.startMinute).toBe(0);
    expect(item.recordedMinutes).toBe(30);
    expect(item.record.startTime).toBe('23:30');
    expect(item.record.date).toBe('2026-09-23');
    expect(item.comparisonMeta.measured.recordedMinutes).toBe(60);
  });
  it('excludes an interval ending exactly at the start of the selected day', () => {
    expect(journal([record({ date: '2026-09-23', startTime: '23:00', endTime: '00:00' })]).entries).toEqual([]);
  });
  it('includes whole-day evidence even outside a timeline START/END window', () => {
    expect(ids(journal([record({ id: 'night', startTime: '01:00', endTime: '01:30' }), record({ id: 'day' })]))).toEqual(['night', 'day']);
  });
  it('keeps off-day attempts in group metadata without adding them to today’s rows', () => {
    const offDay = record({ id: 'tomorrow', date: '2026-09-25', endDate: '2026-09-25' });
    const result = journal([record(), offDay]);
    expect(ids(result)).toEqual(['a']);
    expect(result.entries[0].attempts).toHaveLength(2);
    expect(result.entries[0].measuredSessions).toBe(2);
    expect(result.entries[0].recordedMinutes).toBe(30);
  });
  it('does not join different captured plans or unrelated unlinked records', () => {
    const result = journal([record(), record({ id: 'other-plan', planSnapshot: { ...plan, startTime: '10:00' } }),
      record({ id: 'unlinked', taskId: null }), record({ id: 'unlinked-2', taskId: null })]);
    expect(result.entries.every(item => item.attempts.length === 1)).toBe(true);
  });
  it('keeps capture-once title/plan and resolves current notes separately', () => {
    const current = { ...task, title: 'Renamed', startTime: '16:00' };
    const item = journal([record()], { tasks: [current], taskLookup: [current] }).entries[0];
    expect(item.record.title).toBe('Captured title');
    expect(item.record.planSnapshot).toEqual(plan);
    expect(item.sourceTask.title).toBe('Renamed');
    expect(item.sourceTask.notes).toBe('**Current** note');
  });
  it('keeps orphan history without inventing task notes', () => {
    const item = journal([record()], { tasks: [], taskLookup: [] }).entries[0];
    expect(item.record.title).toBe('Captured title');
    expect(item.sourceTask).toBeNull();
  });
  it('keeps unlinked title tags, without treating them as a task identity', () => {
    const item = journal([record({ taskId: null, title: 'Walk #健康 #outdoors', planSnapshot: null })]).entries[0];
    expect(item.record.title).toBe('Walk #健康 #outdoors');
    expect(item.sourceTask).toBeNull();
    expect(item.attempts).toHaveLength(1);
  });
  it('respects the day model’s household visibility', () => {
    expect(journal([record()], { isVisibleForUser: () => false }).entries).toEqual([]);
  });
  it('keeps recurring occurrences in their existing groups', () => {
    const recurringTasks = [{ id: 'r', title: 'Routine', startTime: '09:00', duration: 60, completedDates: [date, '2026-09-23'] }];
    const rows = [record({ id: 'do:r:2026-09-24:x', taskId: 'r', source: 'completion' }),
      record({ id: 'do:r:2026-09-23:x', taskId: 'r', source: 'completion', planSnapshot: { ...plan, date: '2026-09-23' } })];
    const result = journal(rows, { recurringTasks });
    expect(result.entries.every(item => item.attempts.length === 1)).toBe(true);
    expect(new Set(result.entries.map(item => item.sourceTask.date)).size).toBe(2);
  });
  it('uses the viewer projection for UTC markers without rewriting record date or id', () => {
    const utc = point({ id: 'utc', createdAt: '2026-09-24T02:00:00Z' });
    const civil = completionMoment(utc.createdAt);
    const item = journal([utc], { date: civil.date }).entries[0];
    expect(item.date).toBe(civil.date);
    expect(item.startMinute).toBe(Number(civil.time.slice(0, 2)) * 60 + Number(civil.time.slice(3)));
    expect(item.record).toEqual(utc);
  });
  it('keeps explicit-offset source civil time in the journal', () => {
    const item = journal([point({ createdAt: `${date}T21:00:00-05:00`, updatedAt: `${date}T21:00:00-05:00`, observedAt: `${date}T21:00:00-05:00` })]).entries[0];
    expect(item.startMinute).toBe(1260);
  });
  it('never resurrects tombstones or duplicates a selected winner', () => {
    const row = record();
    const deleted = { ...row, deleted: true, updatedAt: '2026-09-25T12:00:00+08:00' };
    expect(journal([row, deleted]).entries).toEqual([]);
    expect(journal([deleted, row]).entries).toEqual([]);
    expect(journal([row, row]).entries).toHaveLength(1);
  });
  it('carries unreadable-record warnings instead of inventing empty-day evidence', () => {
    const result = journal([{ id: 'bad' }]);
    expect(result.entries).toEqual([]);
    expect(result.invalidRecordCount).toBeGreaterThan(0);
  });
});


describe('Check journal chronology regressions', () => {
  it('orders midnight-clipped rows by actual start rather than their end', () => {
    const first = record({ id: 'first', date: '2026-09-23', startTime: '23:00', endTime: '01:00' });
    const second = record({ id: 'second', date: '2026-09-23', startTime: '23:50', endTime: '00:10' });
    expect(ids(journal([second, first]))).toEqual(['first', 'second']);
    expect(ids(journal([first, second]))).toEqual(['first', 'second']);
  });
  it('uses the documented id tie-break at equal starts, not interval length', () => {
    const a = record({ id: 'a-long', endTime: '10:00' });
    const z = record({ id: 'z-short', endTime: '09:10' });
    expect(ids(journal([z, a]))).toEqual(['a-long', 'z-short']);
    expect(ids(journal([a, z]))).toEqual(['a-long', 'z-short']);
  });
});
