import { describe, expect, it } from 'vitest';
import { buildJoboDaySummary, coveredMinutes } from './daySummary.js';
import { createDoRecord } from './core.js';
const date = '2026-09-27';
const stamp = `${date}T10:00:00Z`;
const plan = { date, startTime: '09:00', duration: 60 };
const task = { id: 't', title: 'Task', ...plan, completed: false };
const row = (over = {}) => createDoRecord({ id: 'a', taskId: 't', title: 'Task', timing: 'timed', source: 'manual', progress: 'partial',
  ...plan, startTime: '09:00', endDate: date, endTime: '09:40', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over });
const summary = overrides => buildJoboDaySummary({ date, tasks: [task], loaded: true, records: [], ...overrides });

describe('JOBO selected-day facts and independent group comparisons', () => {
  it('40 + 30 - 10 is 60, never 70 minutes or an efficiency percentage', () => {
    const records = [row(), row({ id: 'b', startTime: '09:30', endTime: '10:00' })];
    const before = JSON.stringify(records);
    const result = summary({ records });
    expect(result.evidence).toMatchObject({ recordedMinutes: 60, summedMinutes: 70, overlapMinutes: 10, timedCount: 2 });
    expect(result.comparison).toMatchObject({ comparableCount: 1, multipleRecordGroups: 1, duration: { onEstimate: 1, longer: 0 } });
    expect(result.native.percent).toBe(0); // Per-attempt progress does not complete the task.
    expect(JSON.stringify(records)).toBe(before);
  });
  it('clips cross-midnight records to this day before unioning', () => {
    const result = summary({ records: [row({ date: '2026-09-26', startTime: '23:30', endTime: '00:30' })] });
    expect(result.evidence.recordedMinutes).toBe(30);
    expect(result.comparison.comparableCount).toBe(1); // Full record, not clipped comparison.
  });
  it('does not substitute planned duration or zero for untimed evidence', () => {
    const record = row({ timing: 'untimed', startTime: null, endDate: null, endTime: null, progress: 'completed', source: 'completion' });
    const result = summary({ records: [record] });
    expect(result.evidence).toMatchObject({ recordedMinutes: null, untimedCount: 1, timedCount: 0 });
    expect(result.comparison).toMatchObject({ comparableCount: 0, untimedGroupCount: 1 });
    expect(result.native.completed).toBe(0);
  });
  it('shows measured coverage but withholds whole-group comparisons for mixed evidence', () => {
    const result = summary({ records: [row(), row({ id: 'b', timing: 'untimed', startTime: null, endDate: null, endTime: null })] });
    expect(result.evidence.recordedMinutes).toBe(40);
    expect(result.comparison.comparableCount).toBe(0);
    expect(result.comparison.start.late).toBe(0);
  });
  it('keeps native completed tasks completed even with no Do', () => {
    const result = summary({ tasks: [{ ...task, completed: true }] });
    expect(result.native).toMatchObject({ completed: 1, total: 1, percent: 100 });
    expect(result.evidence.recordCount).toBe(0);
    expect(result.evidence.recordedMinutes).toBeNull();
  });
  it.each([undefined, null, {}])('does not mistake unavailable records %s for an empty ledger', records => {
    expect(summary({ records })).toMatchObject({ available: false, evidence: null, comparison: null });
  });
  it('never counts a stale array before load completes', () => {
    expect(summary({ loaded: false, records: [row()] }).available).toBe(false);
  });
  it('counts start, finish and duration independently, even for the same group', () => {
    const result = summary({ records: [row({ startTime: '09:10', endTime: '10:20' })] });
    expect(result.comparison).toMatchObject({ comparableCount: 1, start: { late: 1 }, finish: { late: 1 }, duration: { longer: 1 } });
    expect(result.comparison.groups[0]).toMatchObject({ startOffset: 10, finishOffset: 20, durationDifference: 10 });
  });
  it('separates later execution from this day’s minute coverage', () => {
    const result = summary({ records: [row({ date: '2026-09-28', endDate: '2026-09-28', startTime: '09:00', endTime: '09:40' })] });
    expect(result.evidence.recordedMinutes).toBeNull();
    expect(result.comparison).toMatchObject({ comparableCount: 1, start: { late: 1 } });
  });
  it('does not count a captured plan twice after a native rename', () => {
    const result = summary({ tasks: [{ ...task, title: 'Renamed' }], records: [row()] });
    expect(result.native.total).toBe(1);
    expect(result.comparison.groupCount).toBe(1);
    expect(result.comparison.groups[0].title).toBe('Task');
  });
  it('does not merge recurring occurrences with a shared template id', () => {
    const other = row({ id: 'other', planSnapshot: { ...plan, date: '2026-09-28' } });
    expect(summary({ records: [row(), other] }).comparison.groupCount).toBe(1);
  });
  it('tombstones and duplicate versions cannot double-count or resurrect work', () => {
    const gone = row({ deleted: true, updatedAt: '2026-09-27T11:00:00Z' });
    expect(summary({ records: [row(), gone, row()] }).evidence.recordCount).toBe(0);
    expect(summary({ records: [row(), row()] }).evidence.recordCount).toBe(1);
  });
  it('keeps useful known minutes but suppresses comparison claims if the ledger has invalid rows', () => {
    const result = summary({ records: [row(), { id: 'broken' }] });
    expect(result.evidence).toMatchObject({ recordedMinutes: 40, invalidCount: 1 });
    expect(result.comparison).toMatchObject({ clean: false, comparableCount: null, groups: [] });
  });
  it('does not misclassify native all-day or external calendar events as timed tasks', () => {
    const result = summary({ tasks: [task, { ...task, id: 'allday', isAllDay: true }, { ...task, id: 'calendar', imported: true }] });
    expect(result.native).toMatchObject({ total: 1, plannedMinutes: 60 });
  });
  it('respects visible-user scope in both task and execution projections', () => {
    const hidden = { ...task, assignedUserSyncIds: ['other'] };
    const isVisibleForUser = t => !t.assignedUserSyncIds?.includes('other');
    const result = summary({ tasks: [hidden], records: [row()], isVisibleForUser });
    expect(result.native.total).toBe(0);
    expect(result.evidence.recordCount).toBe(0);
  });
  it('keeps orphaned measured records without inventing a native task or completion', () => {
    const result = summary({ tasks: [], records: [row()] });
    expect(result.native.total).toBe(0);
    expect(result.evidence.recordedMinutes).toBe(40);
    expect(result.comparison.comparableCount).toBe(1);
  });
  it('explicit no timed plan is not an eligible comparison', () => {
    const result = summary({ records: [row({ taskId: null, planSnapshot: null })] });
    expect(result.evidence).toMatchObject({ noTimedPlanCount: 1, recordedMinutes: 40 });
    expect(result.comparison.comparableCount).toBe(0);
  });
  it('preserves experimental inferred records but never counts them as measured work', () => {
    const result = summary({ records: [row({ timingBasis: 'planDuration' })] });
    expect(result.evidence).toMatchObject({ recordCount: 1, inferredCount: 1, recordedMinutes: null });
    expect(result.comparison.comparableCount).toBe(0);
  });
  it('rejects impossible civil days rather than normalizing them into March', () => {
    expect(summary({ date: '2026-02-30' })).toBeNull();
  });
  it('does not sum overlapped current task budgets as actual time', () => {
    const result = summary({ tasks: [task, { ...task, id: 'second' }], records: [row()] });
    expect(result.native.plannedMinutes).toBe(120);
    expect(result.evidence.recordedMinutes).toBe(40);
  });
  it('union is order-independent with nested and adjacent intervals', () => {
    const intervals = [{ startMinute: 0, endMinute: 40 }, { startMinute: 10, endMinute: 20 }, { startMinute: 40, endMinute: 60 }];
    expect(coveredMinutes(intervals)).toBe(60);
    expect(coveredMinutes(intervals.reverse())).toBe(60);
  });
});
