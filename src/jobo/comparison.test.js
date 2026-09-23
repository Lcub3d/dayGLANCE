
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createDoRecord,
  PLAN_CONTEXT, RELATIVE_TIMING, DURATION_COMPARISON, COMPLETION_STATUS, EXECUTION_PATTERN,
  ALLEN_RELATION, TIMING_SUMMARY, compareExecutionToPlan, summarizeTiming,
} from './core.js';

const T0 = '2026-09-19T10:00:00.000Z';
const T1 = '2026-09-19T10:00:01.000Z';
const plan = (patch = {}) => ({ date: '2026-09-19', startTime: '09:00', duration: 60, ...patch });
let sequence = 0;
const record = (patch = {}) => createDoRecord({
  id: `do:test:${sequence += 1}`,
  taskId: 't1',
  date: '2026-09-19',
  startTime: '09:00',
  endDate: '2026-09-19',
  endTime: '10:00',
  title: 'Test task',
  planSnapshot: plan(),
  source: 'manual',
  createdAt: T0,
  updatedAt: T0,
  observedAt: T1,
  deleted: false,
  ...patch,
});
const now = time => ({ date: '2026-09-19', time });

describe('theory-driven JOBO comparison', () => {
  it('keeps exact plan match as independent neutral dimensions', () => {
    const result = compareExecutionToPlan(plan(), [record()]);
    assert.equal(result.planContext, PLAN_CONTEXT.PLANNED);
    assert.equal(result.intervalRelation, ALLEN_RELATION.EQUALS);
    assert.equal(result.startTiming, RELATIVE_TIMING.ON_TIME);
    assert.equal(result.finishTiming, RELATIVE_TIMING.ON_TIME);
    assert.equal(result.durationComparison, DURATION_COMPARISON.ON_ESTIMATE);
    assert.equal(result.withinPlan, true);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.WITHIN_PLAN]);
  });

  it('does not collapse late start, early finish and shorter duration into one status', () => {
    const result = compareExecutionToPlan(plan(), [record({ startTime: '09:20', endTime: '09:50' })]);
    assert.equal(result.intervalRelation, ALLEN_RELATION.DURING);
    assert.equal(result.metrics.startOffsetMinutes, 20);
    assert.equal(result.metrics.finishOffsetMinutes, -10);
    assert.equal(result.metrics.durationDifferenceMinutes, -30);
    assert.equal(result.metrics.durationRatio, 0.5);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.LATE]);
  });

  it('separates late finish from longer duration', () => {
    const result = compareExecutionToPlan(plan(), [record({ startTime: '09:20', endTime: '10:20' })]);
    assert.equal(result.startTiming, RELATIVE_TIMING.LATE);
    assert.equal(result.finishTiming, RELATIVE_TIMING.LATE);
    assert.equal(result.durationComparison, DURATION_COMPARISON.ON_ESTIMATE);
    assert.equal(result.metrics.durationDifferenceMinutes, 0);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.LATE]);
  });

  it('allows early start, on-time finish and longer duration to coexist', () => {
    const result = compareExecutionToPlan(plan(), [record({ startTime: '08:30', endTime: '10:00' })]);
    assert.equal(result.startTiming, RELATIVE_TIMING.EARLY);
    assert.equal(result.finishTiming, RELATIVE_TIMING.ON_TIME);
    assert.equal(result.durationComparison, DURATION_COMPARISON.LONGER);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.LONGER]);
  });

  it('treats early and shorter execution as within-plan when nothing is late or longer', () => {
    const result = compareExecutionToPlan(plan(), [record({ startTime: '08:50', endTime: '09:40' })]);
    assert.equal(result.startTiming, RELATIVE_TIMING.EARLY);
    assert.equal(result.finishTiming, RELATIVE_TIMING.EARLY);
    assert.equal(result.durationComparison, DURATION_COMPARISON.SHORTER);
    assert.equal(result.withinPlan, true);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.WITHIN_PLAN]);
  });

  it('keeps raw offsets stable while tolerance changes only classification', () => {
    const r = record({ startTime: '09:04', endTime: '10:04' });
    const exact = compareExecutionToPlan(plan(), [r]);
    const tolerant = compareExecutionToPlan(plan(), [r], { tolerance: { startMinutes: 5, finishMinutes: 5, durationMinutes: 5 } });
    assert.equal(exact.metrics.startOffsetMinutes, 4);
    assert.equal(tolerant.metrics.startOffsetMinutes, 4);
    assert.equal(exact.startTiming, RELATIVE_TIMING.LATE);
    assert.equal(tolerant.startTiming, RELATIVE_TIMING.ON_TIME);
    assert.equal(tolerant.withinPlan, true);
  });

  it('rejects negative and nonnumeric tolerance instead of inventing policy', () => {
    assert.throws(() => compareExecutionToPlan(plan(), [record()], { tolerance: { startMinutes: -1 } }), TypeError);
    assert.throws(() => compareExecutionToPlan(plan(), [record()], { tolerance: { durationMinutes: '5' } }), TypeError);
  });

  it('uses overlap-deduplicated actual time for duration comparison', () => {
    const result = compareExecutionToPlan(plan(), [
      record({ startTime: '09:00', endTime: '09:40' }),
      record({ startTime: '09:20', endTime: '10:00' }),
    ]);
    assert.equal(result.metrics.attemptMinutes, 80);
    assert.equal(result.metrics.recordedMinutes, 60);
    assert.equal(result.metrics.activeMinutes, 60);
    assert.equal(result.metrics.overlapMinutes, 20);
    assert.equal(result.metrics.elapsedMinutes, 60);
    assert.equal(result.metrics.gapMinutes, 0);
    assert.equal(result.durationComparison, DURATION_COMPARISON.ON_ESTIMATE);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.WITHIN_PLAN, TIMING_SUMMARY.SPLIT]);
  });

  it('matches the 40 + 30 - 10 = 60 overlap rule', () => {
    const result = compareExecutionToPlan(plan(), [
      record({ startTime: '09:00', endTime: '09:40' }),
      record({ startTime: '09:30', endTime: '10:00' }),
    ]);
    assert.equal(result.metrics.attemptMinutes, 70);
    assert.equal(result.metrics.recordedMinutes, 60);
    assert.equal(result.metrics.activeMinutes, 60);
    assert.equal(result.metrics.overlapMinutes, 10);
    assert.equal(result.durationComparison, DURATION_COMPARISON.ON_ESTIMATE);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.WITHIN_PLAN, TIMING_SUMMARY.SPLIT]);
  });

  it('excludes gaps from both recorded and active work while retaining elapsed span', () => {
    const result = compareExecutionToPlan(plan(), [record({ startTime: '09:00', endTime: '09:20' }), record({ startTime: '09:40', endTime: '10:00' })]);
    assert.equal(result.metrics.recordedMinutes, 40);
    assert.equal(result.metrics.activeMinutes, 40);
    assert.equal(result.metrics.elapsedMinutes, 60);
    assert.equal(result.metrics.gapMinutes, 20);
    assert.equal(result.durationComparison, DURATION_COMPARISON.SHORTER);
  });

  it('lets within-plan coexist with split sessions', () => {
    const result = compareExecutionToPlan(plan(), [record({ startTime: '09:00', endTime: '09:30' }), record({ startTime: '09:30', endTime: '10:00' })]);
    assert.equal(result.withinPlan, true);
    assert.equal(result.executionPattern, EXECUTION_PATTERN.SPLIT_SESSIONS);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.WITHIN_PLAN, TIMING_SUMMARY.SPLIT]);
  });

  it('reads completion from an identified Plan instance', () => {
    for (const value of Object.values(COMPLETION_STATUS)) {
      const p = plan({ id: 'plan:t1:2026-09-19', completionStatus: value });
      const result = compareExecutionToPlan(p, [record()]);
      assert.equal(result.planId, 'plan:t1:2026-09-19');
      assert.equal(result.completionStatus, value);
    }
  });

  it('uses started / partly / mostly / completed as the canonical completion vocabulary', () => {
    assert.deepEqual(COMPLETION_STATUS, {
      STARTED: 'started',
      PARTLY: 'partly',
      MOSTLY: 'mostly',
      COMPLETED: 'completed',
    });
  });

  it('does not derive Plan completion from time or Do records', () => {
    const result = compareExecutionToPlan(plan(), [
      record({ endTime: '09:10' }),
    ]);
    assert.equal(result.completionStatus, null);
    assert.equal(Object.hasOwn(result, 'progress'), false);
  });

  it('does not fold not-started into the completion dimension', () => {
    const result = compareExecutionToPlan(plan(), [], { now: now('11:00') });
    assert.equal(result.notStarted, true);
    assert.equal(result.completionStatus, null);
    assert.deepEqual(summarizeTiming(result), [TIMING_SUMMARY.NOT_STARTED]);
  });

  it('does not report Not Started when the Plan has an explicit completion assessment', () => {
    const p = plan({ id: 'p1', completionStatus: COMPLETION_STATUS.COMPLETED });
    const result = compareExecutionToPlan(p, [], { now: now('11:00') });
    assert.equal(result.notStarted, false);
    assert.equal(result.completionStatus, COMPLETION_STATUS.COMPLETED);
    assert.deepEqual(summarizeTiming(result), []);
  });

  it('rejects invalid or unbound Plan completion values', () => {
    assert.throws(
      () => compareExecutionToPlan(plan({ id: 'p1', completionStatus: 'partial' }), [record()]),
      TypeError,
    );
    assert.throws(
      () => compareExecutionToPlan(plan({ id: 'p1', completionStatus: 'done' }), [record()]),
      TypeError,
    );
    assert.throws(
      () => compareExecutionToPlan(plan({ completionStatus: COMPLETION_STATUS.MOSTLY }), [record()]),
      TypeError,
    );
    assert.throws(
      () => compareExecutionToPlan(plan(), [record()], { completionStatus: COMPLETION_STATUS.MOSTLY }),
      TypeError,
    );
  });

  it('requires displayed revisions to identify the same Plan when both ids are present', () => {
    assert.throws(
      () => compareExecutionToPlan(
        plan({ id: 'p1' }),
        [record()],
        { displayedPlan: plan({ id: 'p2' }) },
      ),
      TypeError,
    );
  });

  it('keeps time independent of Plan completion', () => {
    const p = plan({ id: 'p1', completionStatus: COMPLETION_STATUS.COMPLETED });
    const fastComplete = compareExecutionToPlan(p, [record({ endTime: '09:10' })]);
    assert.equal(fastComplete.metrics.durationRatio, 1 / 6);
    assert.equal(fastComplete.completionStatus, COMPLETION_STATUS.COMPLETED);
    assert.equal(Object.hasOwn(fastComplete, 'completionPercent'), false);
  });


  it('distinguishes known no-plan from unknown plan history', () => {
    const r = record({ planSnapshot: null, taskId: null });
    const noPlan = compareExecutionToPlan(null, [r], { knownUnplanned: true });
    const unknown = compareExecutionToPlan(null, [r]);
    assert.equal(noPlan.planContext, PLAN_CONTEXT.NO_PLAN);
    assert.equal(unknown.planContext, PLAN_CONTEXT.UNKNOWN);
    assert.deepEqual(summarizeTiming(noPlan), [TIMING_SUMMARY.UNPLANNED]);
    assert.deepEqual(summarizeTiming(unknown), []);
  });


  it('supports the canonical late + longer + split combination', () => {
    const result = compareExecutionToPlan(plan(), [
      record({ startTime: '09:20', endTime: '10:00' }),
      record({ startTime: '10:10', endTime: '10:50' }),
    ]);
    assert.deepEqual(summarizeTiming(result), [
      TIMING_SUMMARY.LATE,
      TIMING_SUMMARY.LONGER,
      TIMING_SUMMARY.SPLIT,
    ]);
  });

  it('supports longer + split without late', () => {
    const result = compareExecutionToPlan(plan(), [
      record({ startTime: '08:50', endTime: '09:40' }),
      record({ startTime: '09:40', endTime: '10:00' }),
    ]);
    assert.deepEqual(summarizeTiming(result), [
      TIMING_SUMMARY.LONGER,
      TIMING_SUMMARY.SPLIT,
    ]);
  });

  it('keeps unknown plan context out of the canonical product summary', () => {
    const result = compareExecutionToPlan(null, [record()]);
    assert.equal(result.planContext, PLAN_CONTEXT.UNKNOWN);
    assert.deepEqual(summarizeTiming(result), []);
  });

  it('does not fabricate plan-comparison metrics for no-plan or unknown history', () => {
    for (const result of [compareExecutionToPlan(null, [record({ planSnapshot: null })], { knownUnplanned: true }), compareExecutionToPlan(null, [record()])]) {
      assert.equal(result.comparable, false);
      assert.equal(result.metrics.startOffsetMinutes, null);
      assert.equal(result.metrics.finishOffsetMinutes, null);
      assert.equal(result.metrics.durationDifferenceMinutes, null);
      assert.equal(result.metrics.durationRatio, null);
      assert.equal(result.intervalRelation, null);
    }
  });

  it('derives not-started only when there is no live attempt and the displayed plan elapsed', () => {
    const before = compareExecutionToPlan(plan(), [], { now: now('09:30') });
    const after = compareExecutionToPlan(plan(), [], { now: now('10:00') });
    assert.equal(before.notStarted, false);
    assert.equal(after.notStarted, true);
    assert.equal(after.metrics.attemptCount, 0);
    assert.deepEqual(summarizeTiming(after), [TIMING_SUMMARY.NOT_STARTED]);
  });

  it('pins the not-started truth table', () => {
    const elapsed = { now: now('11:00') };

    const elapsedNoDoNoCompletion = compareExecutionToPlan(plan(), [], elapsed);
    assert.equal(elapsedNoDoNoCompletion.notStarted, true);

    const futureNoDoNoCompletion = compareExecutionToPlan(plan(), [], { now: now('09:30') });
    assert.equal(futureNoDoNoCompletion.notStarted, false);

    const elapsedWithDo = compareExecutionToPlan(plan(), [record({ endTime: '09:10' })], elapsed);
    assert.equal(elapsedWithDo.notStarted, false);

    const completedPlan = plan({ id: 'p1', completionStatus: COMPLETION_STATUS.COMPLETED });
    const elapsedNoDoWithCompletion = compareExecutionToPlan(completedPlan, [], elapsed);
    assert.equal(elapsedNoDoWithCompletion.notStarted, false);
  });

  it('rejects zero-minute placeholders because Do is execution evidence', () => {
    assert.throws(
      () => record({ source: 'completion', planSnapshot: null, endTime: '09:00' }),
      TypeError,
    );
  });

  it('handles cross-midnight civil comparisons', () => {
    const result = compareExecutionToPlan({ date: '2026-09-19', startTime: '23:40', duration: 40 }, [record({ date: '2026-09-19', startTime: '23:50', endDate: '2026-09-20', endTime: '00:35' })]);
    assert.equal(result.metrics.startOffsetMinutes, 10);
    assert.equal(result.metrics.finishOffsetMinutes, 15);
    assert.equal(result.metrics.durationDifferenceMinutes, 5);
  });

  it('ignores tombstoned attempts but does not erase them from the caller collection', () => {
    const deleted = record({ deleted: true });
    const live = record({ startTime: '09:10', endTime: '09:40' });
    const result = compareExecutionToPlan(plan(), [deleted, live]);
    assert.equal(result.metrics.attemptCount, 1);
    assert.equal(deleted.deleted, true);
  });

  it('requires duplicate IDs to be merged before analysis', () => {
    const r = record();
    assert.throws(() => compareExecutionToPlan(plan(), [r, r]), TypeError);
  });
});

describe('Allen interval relation coverage', () => {
  const cases = [
    ['before', { startTime: '07:00', endTime: '08:00' }, ALLEN_RELATION.BEFORE],
    ['meets', { startTime: '08:00', endTime: '09:00' }, ALLEN_RELATION.MEETS],
    ['overlaps', { startTime: '08:30', endTime: '09:30' }, ALLEN_RELATION.OVERLAPS],
    ['starts', { startTime: '09:00', endTime: '09:30' }, ALLEN_RELATION.STARTS],
    ['during', { startTime: '09:15', endTime: '09:45' }, ALLEN_RELATION.DURING],
    ['finishes', { startTime: '09:30', endTime: '10:00' }, ALLEN_RELATION.FINISHES],
    ['equals', { startTime: '09:00', endTime: '10:00' }, ALLEN_RELATION.EQUALS],
    ['started-by', { startTime: '09:00', endTime: '10:30' }, ALLEN_RELATION.STARTED_BY],
    ['contains', { startTime: '08:30', endTime: '10:30' }, ALLEN_RELATION.CONTAINS],
    ['finished-by', { startTime: '08:30', endTime: '10:00' }, ALLEN_RELATION.FINISHED_BY],
    ['overlapped-by', { startTime: '09:30', endTime: '10:30' }, ALLEN_RELATION.OVERLAPPED_BY],
    ['met-by', { startTime: '10:00', endTime: '11:00' }, ALLEN_RELATION.MET_BY],
    ['after', { startTime: '10:30', endTime: '11:00' }, ALLEN_RELATION.AFTER],
  ];
  for (const [name, patch, expected] of cases) {
    it(`classifies ${name}`, () => {
      const result = compareExecutionToPlan(plan(), [record(patch)]);
      assert.equal(result.intervalRelation, expected);
    });
  }
});
