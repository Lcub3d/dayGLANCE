import { describe, expect, it } from 'vitest';
import { buildJoboDayModel } from './viewModel.js';
import { getProblemNoteKeys, isProblemPlan, problemReasons } from './checkReview.js';

const DATE = '2026-09-24';
const STAMP = '2026-09-24T09:00:00.000Z';

const task = (overrides = {}) => ({
  id: 't1',
  title: 'Draft report',
  date: DATE,
  startTime: '09:00',
  duration: 60,
  completed: false,
  color: 'bg-blue-500',
  ...overrides,
});

const record = (overrides = {}) => ({
  id: 'do:t1:one',
  taskId: 't1',
  title: 'Draft report',
  source: 'manual',
  progress: 'completed',
  deleted: false,
  createdAt: STAMP,
  updatedAt: STAMP,
  observedAt: STAMP,
  timing: 'timed',
  date: DATE,
  startTime: '09:00',
  endDate: DATE,
  endTime: '10:00',
  planSnapshot: { date: DATE, startTime: '09:00', duration: 60 },
  ...overrides,
});

function modelFor({ currentTask = task(), records = [] } = {}) {
  return buildJoboDayModel({ date: DATE, tasks: [currentTask], taskLookup: [currentTask], records });
}

describe('check review selector', () => {
  it('selects an incomplete current Plan even without a Do', () => {
    const model = modelFor({ currentTask: task({ completed: false }) });
    expect(getProblemNoteKeys(model)).toEqual(new Set(['t1']));
    expect(problemReasons(model.plans[0])).toEqual({ incomplete: true, timing: false });
  });

  it('uses current Plan completion and does not flag a completed on-plan Plan', () => {
    const model = modelFor({ currentTask: task({ completed: true }), records: [record()] });
    expect(model.plans[0].comparison.comparable).toBe(true);
    expect(getProblemNoteKeys(model)).toEqual(new Set());
  });

  it('selects a completed Plan when the model comparison is late or longer', () => {
    const model = modelFor({
      currentTask: task({ completed: true }),
      records: [record({ startTime: '09:30', endTime: '10:45' })],
    });
    expect(model.plans[0].comparison).toMatchObject({
      startTiming: 'late',
      finishTiming: 'late',
      durationComparison: 'longer',
    });
    expect(getProblemNoteKeys(model)).toEqual(new Set(['t1']));
    expect(problemReasons(model.plans[0])).toEqual({ incomplete: false, timing: true });
  });

  it('does not use an unrelated record or a deleted record to flag a completed Plan', () => {
    const unrelated = record({ id: 'do:other:late', taskId: 'other', startTime: '12:00', endTime: '14:00' });
    const deleted = record({ id: 'do:t1:deleted', deleted: true, startTime: '12:00', endTime: '14:00' });
    const model = modelFor({ currentTask: task({ completed: true }), records: [unrelated, deleted] });
    expect(getProblemNoteKeys(model)).toEqual(new Set());
    expect(model.plans.find(plan => plan.currentTask)?.comparison?.metrics.attemptCount).toBe(0);
  });

  it('checks a historical captured Plan against the live source task', () => {
    const moved = task({ completed: true, title: 'Draft report moved', startTime: '13:00' });
    const old = record({ startTime: '10:00', endTime: '12:30' });
    const model = modelFor({ currentTask: moved, records: [old] });
    const historical = model.plans.find(plan => plan.historical);
    expect(historical).toBeTruthy();
    expect(historical.currentTask).toBeNull();
    expect(historical.sourceTask).toBe(moved);
    expect(problemReasons(historical)).toEqual({ incomplete: false, timing: true });
    expect(getProblemNoteKeys(model)).toEqual(new Set(['t1']));
  });

  it('uses the live source task completion for a historical capture', () => {
    const moved = task({ completed: false, title: 'Draft report moved', startTime: '13:00' });
    const old = record({ startTime: '09:00', endTime: '10:00' });
    const model = modelFor({ currentTask: moved, records: [old] });
    const historical = model.plans.find(plan => plan.historical);
    expect(historical.currentTask).toBeNull();
    expect(problemReasons(historical)).toEqual({ incomplete: true, timing: false });
    expect(getProblemNoteKeys(model)).toEqual(new Set(['t1']));
  });

  it('does not review a historical capture without a real source task', () => {
    const model = buildJoboDayModel({ date: DATE, tasks: [], taskLookup: [], records: [record({ startTime: '10:00', endTime: '12:00' })] });
    expect(model.plans[0].historical).toBe(true);
    expect(model.plans[0].sourceTask).toBeNull();
    expect(getProblemNoteKeys(model)).toEqual(new Set());
  });

  it('keeps recurring occurrence comparison on its captured date', () => {
    const occurrence24 = {
      id: 'recurring-r1-2026-09-24', recurringTemplateId: 'r1', title: 'Review 24',
      date: '2026-09-24', startTime: '09:00', duration: 60, completed: false,
    };
    const occurrence25 = {
      id: 'recurring-r1-2026-09-25', recurringTemplateId: 'r1', title: 'Review 25',
      date: '2026-09-25', startTime: '09:00', duration: 60, completed: true,
    };
    const lateOn24 = record({
      id: 'do:r1:2026-09-24:late', taskId: 'r1', date: '2026-09-24',
      startTime: '10:00', endDate: '2026-09-24', endTime: '12:00',
      planSnapshot: { date: '2026-09-24', startTime: '09:00', duration: 60 },
    });
    const model = buildJoboDayModel({
      date: '2026-09-25',
      tasks: [occurrence25],
      taskLookup: [occurrence24, occurrence25],
      records: [lateOn24],
    });
    expect(model.plans).toHaveLength(1);
    expect(model.plans[0].currentTask).toBe(occurrence25);
    expect(model.plans[0].comparison.metrics.attemptCount).toBe(0);
    expect(getProblemNoteKeys(model)).toEqual(new Set());
  });

  it('accepts a plans array and leaves manual visibility policy to the caller', () => {
    const model = modelFor({ currentTask: task({ completed: false }) });
    const plan = model.plans[0];
    expect(getProblemNoteKeys(model.plans)).toEqual(new Set(['t1']));
    expect(isProblemPlan(plan)).toBe(true);
  });
});
