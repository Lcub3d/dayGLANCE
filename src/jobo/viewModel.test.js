import { describe, it, expect } from 'vitest';
import {
  assignOverlapColumns,
  buildJoboDayModel,
  latestJoboAttempt,
  resolveEditableDoRecord,
  sortJoboAttempts,
  timedSliceOnDate,
} from './viewModel.js';

const T0 = '2026-09-24T09:00:00.000Z';
const rec = (over = {}) => ({
  id: 'do:t1:a',
  taskId: 't1',
  title: 'Draft report',
  source: 'manual',
  progress: 'completed',
  deleted: false,
  createdAt: T0,
  updatedAt: T0,
  observedAt: T0,
  timing: 'timed',
  date: '2026-09-24',
  startTime: '09:20',
  endDate: '2026-09-24',
  endTime: '09:50',
  planSnapshot: { date: '2026-09-24', startTime: '09:00', duration: 60 },
  ...over,
});

describe('resolveEditableDoRecord', () => {
  it('edits only the current live version and refuses stale or tombstoned dialogs', () => {
    const opened = rec();
    expect(resolveEditableDoRecord([opened], opened)).toBe(opened);

    const newer = rec({ updatedAt: '2026-09-24T09:01:00.000Z', progress: 'mostly' });
    expect(resolveEditableDoRecord([newer], opened)).toBeNull();

    const tombstone = rec({ updatedAt: '2026-09-24T09:02:00.000Z', deleted: true });
    expect(resolveEditableDoRecord([tombstone], opened)).toBeNull();
  });

  it('uses the current tie winner as the edit base when updatedAt has not advanced', () => {
    const opened = rec({ title: 'earlier copy' });
    const winner = rec({ title: 'winning copy', observedAt: '2026-09-24T08:59:59.000Z' });
    expect(resolveEditableDoRecord([winner], opened)).toBe(winner);
  });
});

describe('timedSliceOnDate', () => {
  it('clips a cross-midnight Do to the selected civil day', () => {
    const record = rec({
      date: '2026-09-23',
      startTime: '23:30',
      endDate: '2026-09-24',
      endTime: '00:30',
    });
    expect(timedSliceOnDate(record, '2026-09-24')).toEqual({
      startMinute: 0,
      endMinute: 30,
      durationMinutes: 30,
      clippedStart: true,
      clippedEnd: false,
    });
  });
});

describe('assignOverlapColumns', () => {
  it('places overlapping cards in separate columns but reuses a column later', () => {
    const out = assignOverlapColumns([
      { id: 'a', startMinute: 60, endMinute: 120 },
      { id: 'b', startMinute: 90, endMinute: 150 },
      { id: 'c', startMinute: 150, endMinute: 180 },
    ]);
    expect(out.find((x) => x.id === 'a').columnCount).toBe(2);
    expect(out.find((x) => x.id === 'b').columnCount).toBe(2);
    expect(out.find((x) => x.id === 'c').columnCount).toBe(1);
  });

  it('packs short displayed cards by their minimum pixel footprint when scaled', () => {
    const items = [
      { id: 'a', startMinute: 60, endMinute: 70 },
      { id: 'b', startMinute: 85, endMinute: 95 },
    ];
    expect(assignOverlapColumns(items).map((item) => item.columnCount)).toEqual([1, 1]);
    const scaled = assignOverlapColumns(items, { scale: 60 });
    expect(scaled.map((item) => item.columnCount)).toEqual([2, 2]);
    expect(scaled.find((item) => item.id === 'a').startMinute).toBe(60);
    expect(scaled.find((item) => item.id === 'a').endMinute).toBe(70);
  });
});

describe('attempt ordering and comparison metadata', () => {
  it('uses createdAt and a stable id tie-break, so an old correction stays old', () => {
    const old = rec({
      id: 'do:t1:old',
      createdAt: '2026-09-24T09:00:00.000Z',
      updatedAt: '2026-09-24T12:00:00.000Z',
    });
    const recent = rec({
      id: 'do:t1:recent',
      createdAt: '2026-09-24T10:00:00.000Z',
      updatedAt: '2026-09-24T10:00:00.000Z',
    });
    expect(sortJoboAttempts([recent, old]).map((item) => item.id)).toEqual(['do:t1:recent', 'do:t1:old']);
    expect(latestJoboAttempt([old, recent])).toBe(recent);
  });

  it('exposes a non-comparable mixed history and its measured timed subset', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [{ id: 't1', title: 'Draft report', date: '2026-09-24', startTime: '09:00', duration: 60 }],
      records: [rec(), rec({
        id: 'do:t1:untimed', timing: 'untimed', startTime: null, endDate: null, endTime: null,
      })],
    });
    const plan = model.plans[0];
    expect(plan.comparison.comparable).toBe(false);
    expect(plan.comparisonMeta.measured.comparable).toBe(true);
    expect(plan.comparisonMeta.measured.timedSessionCount).toBe(1);
    expect(plan.comparisonMeta.measured.untimedAttemptCount).toBe(1);
  });
});

describe('buildJoboDayModel', () => {
  const task = {
    id: 't1',
    title: 'Draft report',
    date: '2026-09-24',
    startTime: '09:00',
    duration: 60,
    color: 'bg-blue-500',
  };

  it('keeps untimed completion evidence visible without inventing an interval', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [rec({
        timing: 'untimed',
        startTime: null,
        endDate: null,
        endTime: null,
        source: 'completion',
      })],
    });
    expect(model.timedRecords).toHaveLength(0);
    expect(model.untimedRecords).toHaveLength(1);
    expect(model.untimedRecords[0].record.id).toBe('do:t1:a');
    expect(model.untimedRecords[0].groupKey).toBeTruthy();
    expect(model.untimedRecords[0].groupKey).toBe(model.plans[0].groupKey);
  });

  it.each(['timed', 'untimed'])('marks a linked all-day task with a null snapshot as unplanned (%s)', (timing) => {
    const allDayTask = { ...task, isAllDay: true };
    const record = rec({
      timing,
      planSnapshot: null,
      ...(timing === 'untimed' ? {
        source: 'completion', startTime: null, endDate: null, endTime: null,
      } : {}),
    });
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [allDayTask],
      records: [record],
    });
    const items = timing === 'timed' ? model.timedRecords : model.untimedRecords;
    expect(model.invalidRecordCount).toBe(0);
    expect(model.plans).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0].task).toBe(allDayTask);
    expect(items[0].groupKey).toBeTruthy();
    expect(items[0].labels).toEqual(['unplanned']);
  });

  it('derives late + longer + split from Slice 2 rather than persisting a view status', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [
        rec(),
        rec({
          id: 'do:t1:b',
          createdAt: '2026-09-24T10:10:00.000Z',
          updatedAt: '2026-09-24T10:10:00.000Z',
          observedAt: '2026-09-24T10:10:00.000Z',
          startTime: '10:10',
          endTime: '10:50',
        }),
      ],
    });
    expect(model.plans[0].labels).toEqual(['late', 'longer', 'split']);
    expect(model.timedRecords[0].labels).toEqual(['late', 'longer', 'split']);
  });

  it('marks an elapsed Plan with no Do as not started when now is supplied', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [],
      now: { date: '2026-09-24', time: '11:00' },
    });
    expect(model.plans[0].labels).toEqual(['notStarted']);
  });

  it('also derives not started when reviewing a past day', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [],
      now: { date: '2026-09-25', time: '08:00' },
    });
    expect(model.plans[0].labels).toEqual(['notStarted']);
  });

  it('does not infer no recorded execution from an invalid ledger row', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [{ id: 'broken', taskId: 't1' }],
      now: { date: '2026-09-25', time: '08:00' },
    });
    expect(model.invalidRecordCount).toBe(1);
    expect(model.plans[0].labels).toEqual([]);
  });

  it('does not mix another Final Plan for the same task into this Plan', () => {
    const otherPlanAttempt = rec({
      id: 'do:t1:older-plan',
      createdAt: '2026-09-23T09:20:00.000Z',
      updatedAt: '2026-09-23T09:20:00.000Z',
      observedAt: '2026-09-23T09:20:00.000Z',
      date: '2026-09-23',
      startTime: '09:20',
      endDate: '2026-09-23',
      endTime: '09:50',
      planSnapshot: { date: '2026-09-23', startTime: '09:00', duration: 60 },
    });
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [otherPlanAttempt],
      now: { date: '2026-09-24', time: '11:00' },
    });
    expect(model.plans[0].labels).toEqual(['notStarted']);
  });

  it('uses later-day execution when comparing a selected-day Plan', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [rec({
        date: '2026-09-25',
        startTime: '09:20',
        endDate: '2026-09-25',
        endTime: '09:50',
      })],
      now: { date: '2026-09-25', time: '12:00' },
    });
    expect(model.timedRecords).toHaveLength(0);
    expect(model.plans[0].labels).toEqual(['late']);
  });

  it('derives split from all attempts in the plan group, not only the visible day', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [
        rec(),
        rec({
          id: 'do:t1:later',
          createdAt: '2026-09-25T09:20:00.000Z',
          updatedAt: '2026-09-25T09:20:00.000Z',
          observedAt: '2026-09-25T09:20:00.000Z',
          date: '2026-09-25',
          startTime: '09:20',
          endDate: '2026-09-25',
          endTime: '09:50',
        }),
      ],
    });
    expect(model.timedRecords).toHaveLength(1);
    expect(model.timedRecords[0].labels).toContain('split');
    expect(model.plans[0].labels).toContain('split');
  });

  it('does not derive split across unrelated unlinked manual Do records', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [],
      records: [
        rec({ id: 'manual:a', taskId: null, planSnapshot: null, title: 'A' }),
        rec({
          id: 'manual:b',
          taskId: null,
          planSnapshot: null,
          title: 'B',
          startTime: '11:00',
          endTime: '11:20',
          createdAt: '2026-09-24T11:00:00.000Z',
          updatedAt: '2026-09-24T11:00:00.000Z',
          observedAt: '2026-09-24T11:00:00.000Z',
        }),
      ],
    });
    expect(model.timedRecords).toHaveLength(2);
    for (const item of model.timedRecords) {
      expect(item.labels).toEqual(['unplanned']);
    }
  });

  it('links Slice 4 recurring template ids to the visible recurring occurrence', () => {
    const recurring = {
      id: 'recurring-r1-2026-09-24',
      recurringTemplateId: 'r1',
      title: 'Weekly review',
      date: '2026-09-24',
      startTime: '15:00',
      duration: 45,
      color: 'bg-green-500',
    };
    const record = rec({
      id: 'do:r1:2026-09-24:x',
      taskId: 'r1',
      title: 'Weekly review',
      startTime: '15:10',
      endTime: '15:40',
      planSnapshot: { date: '2026-09-24', startTime: '15:00', duration: 45 },
    });
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [recurring],
      taskLookup: [recurring],
      records: [record],
    });
    expect(model.timedRecords[0].task.id).toBe(recurring.id);
    expect(model.plans[0].labels).toEqual(['late']);
  });

  it('resolves a cross-day recurring Do to its captured occurrence, not the displayed day', () => {
    const occurrence24 = {
      id: 'recurring-r1-2026-09-24', recurringTemplateId: 'r1', title: 'Review 24',
      date: '2026-09-24', startTime: '23:00', duration: 60, notes: 'notes for 24',
    };
    const occurrence25 = {
      id: 'recurring-r1-2026-09-25', recurringTemplateId: 'r1', title: 'Review 25',
      date: '2026-09-25', startTime: '23:00', duration: 60, notes: 'notes for 25',
    };
    const crossDay = rec({
      id: 'manual:r1:cross-day', taskId: 'r1', source: 'manual',
      date: '2026-09-24', startTime: '23:30', endDate: '2026-09-25', endTime: '00:30',
      title: 'Review 24',
      planSnapshot: { date: '2026-09-24', startTime: '23:00', duration: 60 },
    });
    const model = buildJoboDayModel({
      date: '2026-09-25', tasks: [occurrence25], taskLookup: [occurrence24, occurrence25], records: [crossDay],
    });
    expect(model.timedRecords[0].task).toBe(occurrence24);
    expect(model.timedRecords[0].noteKey).toBe(occurrence24.id);
    expect(model.timedRecords[0].task).not.toBe(occurrence25);
  });

  it('expands a supplied recurring template only for captured/source dates', () => {
    const template = {
      id: 'r1', title: 'Routine', startTime: '09:00', duration: 30,
      color: 'bg-blue-500', recurrence: { type: 'daily' },
      completedDates: ['2026-09-24'], assignedUserSyncIds: ['u1'], notes: 'series notes', exceptions: {
        '2026-09-24': { title: 'Routine exception', color: 'bg-red-500' },
      },
    };
    const record = rec({
      id: 'do:r1:2026-09-24:2026-09-24T09:30:00.000Z', taskId: 'r1', source: 'completion',
      timing: 'untimed', date: '2026-09-24', startTime: null, endDate: null, endTime: null,
      planSnapshot: null,
    });
    const model = buildJoboDayModel({ date: '2026-09-24', tasks: [], taskLookup: [], recurringTasks: [template], records: [record] });
    const occurrence = model.untimedRecords[0].task;
    expect(model.untimedRecords[0].noteKey).toBe('recurring-r1-2026-09-24');
    expect(occurrence).toMatchObject({
      id: 'recurring-r1-2026-09-24', title: 'Routine exception', color: 'bg-red-500',
      completed: true, isRecurring: true, recurrenceType: 'daily',
      assignedUserSyncIds: ['u1'], notes: 'series notes', isJoboSyntheticOccurrence: true,
    });
  });

  it('keeps a synthesized recurring occurrence read-only for native Plan actions', () => {
    const template = { id: 'r1', title: 'Routine', startTime: '09:00', duration: 30, completedDates: ['2026-09-24'] };
    const record = rec({
      id: 'do:r1:2026-09-24:2026-09-24T09:30:00.000Z', taskId: 'r1', source: 'completion',
      date: '2026-09-24', timing: 'timed', startTime: '09:15', endDate: '2026-09-24', endTime: '09:30',
      planSnapshot: { date: '2026-09-24', startTime: '09:00', duration: 30 },
    });
    const model = buildJoboDayModel({ date: '2026-09-24', tasks: [], taskLookup: [], recurringTasks: [template], records: [record] });
    expect(model.plans[0].currentTask).toBeNull();
    expect(model.plans[0].sourceTask.isJoboSyntheticOccurrence).toBe(true);
  });

  it.each(['manual', 'focus'])('does not link an ambiguous recurring %s row with a null Plan snapshot', (source) => {
    const occurrences = [
      { id: 'recurring-r1-2026-09-24', recurringTemplateId: 'r1', title: '24', date: '2026-09-24', startTime: '09:00', duration: 30 },
      { id: 'recurring-r1-2026-09-25', recurringTemplateId: 'r1', title: '25', date: '2026-09-25', startTime: '09:00', duration: 30 },
    ];
    const row = rec({
      id: 'manual:r1:ambiguous', taskId: 'r1', source, planSnapshot: null,
      date: '2026-09-25', startTime: '10:00', endDate: '2026-09-25', endTime: '10:30',
    });
    const model = buildJoboDayModel({ date: '2026-09-25', tasks: occurrences.slice(1), taskLookup: occurrences, records: [row] });
    expect(model.timedRecords[0].task).toBeNull();
    expect(model.timedRecords[0].noteKey).toBeNull();
  });

  it('groups timed recurring manual and completion attempts with their shared captured Plan', () => {
    const recurring = {
      ...task,
      id: 'recurring-r1-2026-09-24',
      recurringTemplateId: 'r1',
    };
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [recurring],
      records: [
        rec({ id: 'manual:r1:a', taskId: 'r1', source: 'manual' }),
        rec({
          id: 'do:r1:2026-09-24:2026-09-24T10:15:00.000Z',
          taskId: 'r1',
          source: 'completion',
          startTime: '10:00',
          endTime: '10:15',
        }),
      ],
    });
    expect(model.invalidRecordCount).toBe(0);
    expect(model.plans).toHaveLength(1);
    expect(model.timedRecords).toHaveLength(2);
    const plan = model.plans[0];
    expect(plan.groupKey).toBeTruthy();
    expect(plan.currentTask).toBe(recurring);
    expect(plan.labels).toContain('split');
    for (const item of model.timedRecords) {
      expect(item.groupKey).toBe(plan.groupKey);
      expect(item.task).toBe(recurring);
      expect(item.labels).toEqual(plan.labels);
    }
  });

  it('renders the captured Final Plan even after the live task was rescheduled and renamed', () => {
    const movedTask = {
      ...task,
      title: 'Draft report — renamed',
      startTime: '13:00',
    };
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [movedTask],
      taskLookup: [movedTask],
      records: [rec({ title: 'Draft report' })],
    });
    const captured = model.plans.find((item) => item.plan.startTime === '09:00');
    const current = model.plans.find((item) => item.plan.startTime === '13:00');
    expect(captured.task.title).toBe('Draft report');
    expect(captured.labels).toEqual(['late']);
    expect(current.task.title).toBe('Draft report — renamed');
    expect(captured.groupKey).toBeTruthy();
    expect(current.groupKey).toBeTruthy();
    expect(captured.groupKey).not.toBe(current.groupKey);
    expect(model.timedRecords[0].groupKey).toBe(captured.groupKey);
    expect(captured.currentTask).toBeNull();
    expect(captured.historical).toBe(true);
    expect(current.currentTask).toBe(movedTask);
    expect(current.historical).toBe(false);
  });

  it('keeps the real live task for native reopen when the captured Plan still matches', () => {
    const liveTask = Object.freeze({
      ...task,
      title: 'Current task title',
      completed: true,
      completedAt: T0,
    });
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [liveTask],
      records: [rec({ title: 'Captured task title', source: 'completion' })],
    });
    expect(model.plans).toHaveLength(1);
    const captured = model.plans[0];
    expect(captured.task.title).toBe('Captured task title');
    expect(captured.currentTask).toBe(liveTask);
    expect(captured.currentTask.title).toBe('Current task title');
    expect(captured.currentTask.completedAt).toBe(T0);
    expect(captured.historical).toBe(false);
    expect(captured.groupKey).toBe(model.timedRecords[0].groupKey);
    expect(model.timedRecords[0].task).toBe(liveTask);
  });

  it('keeps a captured Final Plan readable after the live task no longer resolves', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [],
      taskLookup: [],
      records: [rec({ title: 'Historical title' })],
    });
    expect(model.plans).toHaveLength(1);
    expect(model.plans[0].task.title).toBe('Historical title');
    expect(model.plans[0].plan).toEqual({ date: '2026-09-24', startTime: '09:00', duration: 60 });
    expect(model.plans[0].currentTask).toBeNull();
    expect(model.plans[0].historical).toBe(true);
  });

  it.each(['stamped', 'legacy'])('does not derive split across different recurring untimed dates (%s keys)', (keyKind) => {
    const first = rec({
      id: keyKind === 'legacy' ? 'do:r1:2026-09-24' : 'do:r1:2026-09-24:2026-09-24T18:00:00.000Z',
      taskId: 'r1',
      source: 'completion',
      timing: 'untimed',
      date: '2026-09-24',
      startTime: null,
      endDate: null,
      endTime: null,
      planSnapshot: null,
    });
    const second = rec({
      id: keyKind === 'legacy' ? 'do:r1:2026-09-25' : 'do:r1:2026-09-25:2026-09-25T18:00:00.000Z',
      taskId: 'r1',
      source: 'completion',
      timing: 'untimed',
      date: '2026-09-25',
      startTime: null,
      endDate: null,
      endTime: null,
      planSnapshot: null,
      createdAt: '2026-09-25T18:00:00.000Z',
      updatedAt: '2026-09-25T18:00:00.000Z',
      observedAt: '2026-09-25T18:00:01.000Z',
    });
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [],
      records: [first, second],
    });
    expect(model.untimedRecords).toHaveLength(1);
    expect(model.untimedRecords[0].record).toBe(first);
    expect(model.untimedRecords[0].labels).toEqual(['unplanned']);
    const nextDay = buildJoboDayModel({
      date: '2026-09-25',
      tasks: [],
      records: [first, second],
    });
    expect(nextDay.untimedRecords).toHaveLength(1);
    expect(nextDay.untimedRecords[0].record).toBe(second);
    expect(nextDay.untimedRecords[0].labels).toEqual(['unplanned']);
    expect(model.untimedRecords[0].groupKey).toBeTruthy();
    expect(nextDay.untimedRecords[0].groupKey).toBeTruthy();
    expect(model.untimedRecords[0].groupKey).not.toBe(nextDay.untimedRecords[0].groupKey);
  });

  it('drops malformed rows from the view without treating the ledger as empty', () => {
    const model = buildJoboDayModel({
      date: '2026-09-24',
      tasks: [task],
      records: [{ id: 'broken' }],
    });
    expect(model.invalidRecordCount).toBe(1);
    expect(model.timedRecords).toEqual([]);
  });
});
