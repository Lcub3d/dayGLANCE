import { describe, it, expect } from 'vitest';
import {
  assignOverlapColumns,
  buildJoboDayModel,
  resolveEditableDoRecord,
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
