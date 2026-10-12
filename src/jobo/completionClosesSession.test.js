import { describe, it, expect } from 'vitest';
import {
  createDoRecord, compareExecutionToPlan, summarizeTiming,
  DO_TIMING, DO_PROGRESS, EXECUTION_PATTERN, TIMING_SUMMARY, COMPLETION_CLOSES_SESSION_MINUTES,
} from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { summarizeJoboDayModel } from './dayStats.js';
import { buildCheckSummary } from './checkSummary.js';
import { aggregateCheckSummaries, buildStatisticsReports, statisticsDatesForScope, STATISTICS_SCOPES } from './checkStatistics.js';
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
  // An ordinary completion is stamped on its own clock, with an offset.
  const doneAt = (createdAt) => createDoRecord({
    id: `do:t1:${createdAt}`, taskId: 't1', title: 'Draft report', source: 'completion', progress: DO_PROGRESS.COMPLETED,
    timing: DO_TIMING.UNTIMED, date: day, startTime: null, endDate: null, endTime: null, planSnapshot: dayPlan,
    createdAt, updatedAt: createdAt, observedAt: createdAt, deleted: false,
  });
  const done = doneAt(`${day}T09:57:00+09:00`);
  const model = (records = [session, done]) => buildJoboDayModel({ date: day, tasks: [task], records, now: { date: day, time: '18:00' } });
  const sessionItem = (records) => model(records).timedRecords.find(entry => entry.id === session.id);

  it('the day model compares the execution and reports nothing missing', () => {
    const item = sessionItem();
    expect(item.comparison.comparable).toBe(true);
    expect(item.comparisonMeta.hasUntimedAttempts).toBe(false);
    expect(item.labels).toEqual([TIMING_SUMMARY.WITHIN_PLAN]);
  });

  it('the completion does not replace the measured end', () => {
    const { comparison } = sessionItem();
    expect(comparison.metrics.finishOffsetMinutes).toBe(-5);
    expect(comparison.metrics.recordedMinutes).toBe(55);
  });

  it('the day figures count it as compared', () => {
    expect(summarizeJoboDayModel(model()).comparison.comparableCount).toBe(1);
  });

  // MUTATION: read untimedAttemptCount again in ExecutionAxes and this fails.
  it('the details show the timing, not "time to add"', () => {
    const { comparison } = sessionItem();
    const t = (key) => key;
    expect(timingRows(comparison, t).map(row => row.key)).toEqual(['start', 'finish', 'duration']);
    expect(summaryRows(null, comparison, t).map(row => row.key)).not.toContain('timeIncomplete');
  });

  // A UTC stamp (recurring completions today) has no civil clock of its own.
  // The same ledger must classify the same way whatever zone it is read in.
  // MUTATION: project UTC stamps into the viewer's zone (completionMoment in
  // comparisonMetadata, or a viewer-local default in core) and this fails.
  it('a UTC stamp closes nothing, identically in every time zone', () => {
    const utc = doneAt(`${day}T09:56:00.000Z`);
    const saved = process.env.TZ;
    const seen = [];
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Europe/Berlin']) {
        process.env.TZ = zone;
        const { comparison } = sessionItem([session, utc]);
        seen.push([zone, comparison.comparable, comparison.metrics.closingCompletionCount]);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
    }
    expect(seen).toEqual([
      ['UTC', false, 0], ['America/Los_Angeles', false, 0], ['Asia/Tokyo', false, 0], ['Europe/Berlin', false, 0],
    ]);
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

describe('Statistics count a closed session once, in every scope', () => {
  const dates = ['2026-09-28', '2026-09-29', '2026-09-30'];
  const p = { date: dates[0], startTime: '09:00', duration: 60 };
  const at = `${dates[0]}T12:00:00+02:00`;
  const work = createDoRecord({ id: 'focus:w', taskId: 't1', title: 'Write', source: 'focus', progress: DO_PROGRESS.PARTIAL,
    timing: DO_TIMING.TIMED, date: dates[0], startTime: '09:00', endDate: dates[0], endTime: '09:55', planSnapshot: p,
    createdAt: at, updatedAt: at, observedAt: at, deleted: false });
  const tick = (time) => createDoRecord({ id: `do:t1:${time}`, taskId: 't1', title: 'Write', source: 'completion',
    progress: DO_PROGRESS.COMPLETED, timing: DO_TIMING.UNTIMED, date: dates[0], startTime: null, endDate: null, endTime: null,
    planSnapshot: p, createdAt: `${dates[0]}T${time}:00+02:00`, updatedAt: at, observedAt: at, deleted: false });
  const range = (records, scope) => aggregateCheckSummaries(buildStatisticsReports({
    records, now: { date: dates[2], time: '12:00' },
    dates: statisticsDatesForScope({ scope, anchorDate: dates[0], weekDates: dates, evidenceDates: dates }),
  }));

  // MUTATION: classify by attempts again in rangeExecution (or in
  // buildCheckSummary) and these fail.
  it.each(STATISTICS_SCOPES)('%s: a closing completion is not a second session; Do records still count both', scope => {
    expect(range([work, tick('09:56')], scope)).toMatchObject({ doCount: 2, single: 1, split: 0 });
  });

  it.each(STATISTICS_SCOPES)('%s: a later completion is still a second session', scope => {
    expect(range([work, tick('09:58')], scope)).toMatchObject({ doCount: 2, single: 0, split: 1 });
  });

  it('the day summary agrees', () => {
    const model = buildJoboDayModel({ date: dates[0], records: [work, tick('09:56')], now: { date: dates[2], time: '12:00' } });
    expect(buildCheckSummary(model, { date: dates[0] })).toMatchObject({ doCount: 2, single: 1, split: 0 });
  });
});
