import { describe, it, expect } from 'vitest';
import {
  createDoRecord, compareExecutionToPlan, summarizeTiming,
  DO_TIMING, DO_PROGRESS, EXECUTION_PATTERN, TIMING_SUMMARY, COMPLETION_CLOSES_SESSION_MINUTES,
} from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { summarizeJoboDayModel } from './dayStats.js';
import { timingRows, summaryRows } from '../components/jobo/ExecutionAxes.jsx';

// A timed session followed by the task's checkbox: the most common Focus
// path, and any timed Do ticked off as it ends. The completion closes the
// last timed session, so the execution stays comparable to its plan.

const date = '2026-09-19';
const plan = { date, startTime: '09:00', duration: 60 };
const stamp = '2026-09-19T12:00:00+00:00';
let sequence = 0;
const timed = (startTime, endTime, patch = {}) => createDoRecord({
  id: `do:t1:${sequence += 1}`, taskId: 't1', title: 'Write the spec', source: 'focus',
  progress: DO_PROGRESS.PARTIAL, timing: DO_TIMING.TIMED, date, startTime, endDate: date, endTime,
  planSnapshot: plan, createdAt: stamp, updatedAt: stamp, observedAt: stamp, deleted: false, ...patch,
});
// A completion stamped on its own clock (an offset), so core's default reads it.
const completion = (time, patch = {}) => createDoRecord({
  id: `do:t1:done:${sequence += 1}`, taskId: 't1', title: 'Write the spec', source: 'completion',
  progress: DO_PROGRESS.COMPLETED, timing: DO_TIMING.UNTIMED, date, startTime: null, endDate: null, endTime: null,
  planSnapshot: plan, createdAt: `${date}T${time}:00+02:00`, updatedAt: stamp, observedAt: stamp, deleted: false, ...patch,
});
const compare = (records, options) => compareExecutionToPlan(plan, records, options);

describe('a completion closes the last timed session', () => {
  it('keeps the execution comparable, as one session, adding no minutes', () => {
    const result = compare([timed('09:00', '09:55'), completion('09:56')]);
    expect(result.comparable).toBe(true);
    expect(result.executionPattern).toBe(EXECUTION_PATTERN.SINGLE_SESSION);
    expect(result.metrics).toMatchObject({
      attemptCount: 2, untimedAttemptCount: 1, closingCompletionCount: 1, unmeasuredAttemptCount: 0, recordedMinutes: 55,
    });
    expect(summarizeTiming(result)).toEqual([TIMING_SUMMARY.WITHIN_PLAN]);
  });

  // MUTATION: drop "+ COMPLETION_CLOSES_SESSION_MINUTES" (or widen it) and this fails.
  it('closes up to 2 minutes after the session ends, and not a minute later', () => {
    expect(COMPLETION_CLOSES_SESSION_MINUTES).toBe(2);
    expect(compare([timed('09:00', '09:45'), completion('09:47')]).comparable).toBe(true);
    const late = compare([timed('09:00', '09:45'), completion('09:48')]);
    expect(late.comparable).toBe(false);
    expect(late.metrics.unmeasuredAttemptCount).toBe(1);
    expect(late.executionPattern).toBe(EXECUTION_PATTERN.SPLIT_SESSIONS);
  });

  // MUTATION: drop "minute >= last.start" and the first expectation fails.
  it('closes when ticked during the last session, not before it began', () => {
    expect(compare([timed('09:00', '09:50'), completion('08:55')]).comparable).toBe(false);
    expect(compare([timed('09:00', '09:50'), completion('09:30')]).comparable).toBe(true);
  });

  it('takes the last session, not an earlier one', () => {
    const sessions = [timed('09:00', '09:20'), timed('09:40', '10:00')];
    expect(compare([...sessions, completion('09:10')]).comparable).toBe(false);
    const closed = compare([...sessions, completion('10:01')]);
    expect(closed.comparable).toBe(true);
    expect(closed.executionPattern).toBe(EXECUTION_PATTERN.SPLIT_SESSIONS);
    expect(closed.metrics.recordedMinutes).toBe(40);
  });

  // MUTATION: drop the progress check and this fails.
  it('needs a completion that still stands: an unchecked one is unmeasured', () => {
    expect(compare([timed('09:00', '09:55'), completion('09:56', { progress: DO_PROGRESS.PARTIAL })]).comparable).toBe(false);
  });

  // MUTATION: drop the source check and this fails.
  it('needs a completion: a manual untimed Do stays unmeasured work', () => {
    expect(compare([timed('09:00', '09:55'), completion('09:56', { source: 'manual' })]).comparable).toBe(false);
  });

  it('closes nothing without a timed session', () => {
    const result = compare([completion('09:56')]);
    expect(result.comparable).toBe(false);
    expect(result.metrics.closingCompletionCount).toBe(0);
  });

  it('stays incomplete when any other untimed attempt is unaccounted for', () => {
    const result = compare([timed('09:00', '09:55'), completion('09:56'), completion('08:00', { source: 'manual' })]);
    expect(result.comparable).toBe(false);
    expect(result.metrics).toMatchObject({ closingCompletionCount: 1, unmeasuredAttemptCount: 1 });
  });

  it('crosses midnight with the session', () => {
    const night = { date, startTime: '23:00', duration: 60 };
    const session = timed('23:10', '00:05', { endDate: '2026-09-20', planSnapshot: night });
    const done = completion('00:06', { createdAt: '2026-09-20T00:06:00+02:00', updatedAt: '2026-09-20T09:00:00+02:00', planSnapshot: night });
    expect(compareExecutionToPlan(night, [session, done]).comparable).toBe(true);
  });

  it('reads a UTC stamp only through the caller\'s projection', () => {
    const utc = completion('09:56', { createdAt: `${date}T09:56:00.000Z` });
    expect(compare([timed('09:00', '09:55'), utc]).comparable).toBe(false);
    const projected = compare([timed('09:00', '09:55'), utc], { completionMoment: () => ({ date, time: '09:56' }) });
    expect(projected.comparable).toBe(true);
    expect(() => compare([utc], { completionMoment: 'x' })).toThrow(TypeError);
  });
});

describe('where the app reads it', () => {
  const day = '2026-09-24';
  const dayPlan = { date: day, startTime: '09:00', duration: 60 };
  const task = { id: 't1', title: 'Draft report', date: day, startTime: '09:00', duration: 60, completed: true };
  const session = createDoRecord({
    id: 'focus:s:0:0:task:t1', taskId: 't1', title: 'Draft report', source: 'focus', progress: DO_PROGRESS.PARTIAL,
    timing: DO_TIMING.TIMED, date: day, startTime: '09:00', endDate: day, endTime: '09:55', planSnapshot: dayPlan,
    createdAt: stamp, updatedAt: stamp, observedAt: stamp, deleted: false,
  });
  // A UTC stamp, as the detector writes for a recurring completion: the
  // view projects it into local time, here 09:57 local on the same day.
  const utcStamp = new Date(2026, 8, 24, 9, 57).toISOString();
  const done = createDoRecord({
    id: `do:t1:${utcStamp}`, taskId: 't1', title: 'Draft report', source: 'completion', progress: DO_PROGRESS.COMPLETED,
    timing: DO_TIMING.UNTIMED, date: day, startTime: null, endDate: null, endTime: null, planSnapshot: dayPlan,
    createdAt: utcStamp, updatedAt: utcStamp, observedAt: utcStamp, deleted: false,
  });
  const model = () => buildJoboDayModel({ date: day, tasks: [task], records: [session, done], now: { date: day, time: '18:00' } });

  // MUTATION: stop passing completionMoment in comparisonMetadata and this fails.
  it('the day model compares the execution and reports nothing missing', () => {
    const item = model().timedRecords.find(entry => entry.id === session.id);
    expect(item.comparison.comparable).toBe(true);
    expect(item.comparisonMeta.hasUntimedAttempts).toBe(false);
    expect(item.labels).toEqual([TIMING_SUMMARY.WITHIN_PLAN]);
  });

  it('the day figures count it as compared', () => {
    expect(summarizeJoboDayModel(model()).comparison.comparableCount).toBe(1);
  });

  // MUTATION: read untimedAttemptCount again in ExecutionAxes and this fails.
  it('the details show the timing, not "time to add"', () => {
    const { comparison } = model().timedRecords.find(entry => entry.id === session.id);
    const t = (key) => key;
    expect(timingRows(comparison, t).map(row => row.key)).toEqual(['start', 'finish', 'duration']);
    expect(summaryRows(null, comparison, t).map(row => row.key)).not.toContain('timeIncomplete');
  });
});

describe('a later completion stays the estimate\'s', () => {
  // The Do column reads a completion after the last session as possibly
  // unmeasured work (estimateCompletion). Beyond the window the two rules
  // must not both claim that gap.
  it('leaves a completion 15 minutes after a partial session mixed', () => {
    const result = compare([timed('08:30', '09:15'), completion('09:30')]);
    expect(result.comparable).toBe(false);
    expect(result.closingCompletionIds).toEqual([]);
  });
});
