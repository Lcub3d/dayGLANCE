import { describe, expect, it } from 'vitest';
import {
  EMPTY_JOURNAL_STATE,
  actualBlockMatchesPlan,
  actualBlocksForDate,
  historicalPlansForDate,
  observePlans,
  recordPlanAsActual,
  summarizeJournalDay,
  updateActualBlock,
} from './model.js';

const task = (overrides = {}) => ({
  id: 'task-1',
  title: 'Write report',
  date: '2026-09-11',
  startTime: '09:00',
  duration: 60,
  isAllDay: false,
  color: 'bg-blue-500',
  projectId: 'project-a',
  ...overrides,
});

describe('journal model', () => {
  it('records a plan as a separate actual block without mutating the task', () => {
    const planned = task();
    const before = structuredClone(planned);
    const result = recordPlanAsActual(EMPTY_JOURNAL_STATE, planned, {
      id: 'actual-1',
      recordedAt: '2026-09-11T10:00:00.000Z',
    });

    expect(result.created).toBe(true);
    expect(result.block).toMatchObject({
      id: 'actual-1',
      sourceTaskId: 'task-1',
      date: '2026-09-11',
      startTime: '09:00',
      duration: 60,
      title: 'Write report',
    });
    expect(result.block.planSnapshot.startTime).toBe('09:00');
    expect(planned).toEqual(before);
  });

  it('does not create a duplicate actual block for the same task and same plan slot', () => {
    const first = recordPlanAsActual(EMPTY_JOURNAL_STATE, task(), {
      id: 'actual-1',
      recordedAt: '2026-09-11T10:00:00.000Z',
    });
    const second = recordPlanAsActual(first.state, task(), {
      id: 'actual-2',
      recordedAt: '2026-09-11T10:05:00.000Z',
    });

    expect(second.created).toBe(false);
    expect(second.block.id).toBe('actual-1');
    expect(second.state.actualBlocks).toHaveLength(1);
  });

  it('allows one task to produce multiple actual blocks after the plan moves', () => {
    const first = recordPlanAsActual(EMPTY_JOURNAL_STATE, task(), {
      id: 'actual-1',
      recordedAt: '2026-09-11T10:00:00.000Z',
    });
    const moved = task({ startTime: '16:00', duration: 45 });
    const second = recordPlanAsActual(first.state, moved, {
      id: 'actual-2',
      recordedAt: '2026-09-11T16:50:00.000Z',
      revisionIdFactory: () => 'revision-1',
    });

    expect(second.created).toBe(true);
    expect(second.state.actualBlocks).toHaveLength(2);
    expect(second.state.planRevisions).toHaveLength(1);
    expect(second.state.planRevisions[0].before.startTime).toBe('09:00');
    expect(second.state.planRevisions[0].after.startTime).toBe('16:00');
    expect(first.state.actualBlocks[0].planSnapshot.startTime).toBe('09:00');
  });

  it('observes plan changes even before any actual block is recorded', () => {
    const initial = observePlans(EMPTY_JOURNAL_STATE, [task()], {
      observedAt: '2026-09-11T08:00:00.000Z',
      idFactory: () => 'unused',
    });
    const changed = observePlans(initial.state, [task({ date: '2026-09-12', startTime: '10:30' })], {
      observedAt: '2026-09-11T08:30:00.000Z',
      idFactory: () => 'revision-1',
    });

    expect(changed.state.planRevisions).toHaveLength(1);
    expect(changed.state.planRevisions[0]).toMatchObject({ id: 'revision-1', taskId: 'task-1' });
    expect(changed.state.planRevisions[0].before).toMatchObject({ date: '2026-09-11', startTime: '09:00' });
    expect(changed.state.planRevisions[0].after).toMatchObject({ date: '2026-09-12', startTime: '10:30' });
    expect(historicalPlansForDate(changed.state, '2026-09-11')).toEqual([
      expect.objectContaining({ taskId: 'task-1', startTime: '09:00' }),
    ]);
  });

  it('keeps the earliest changed plan as the visual historical plan for a day', () => {
    const initial = observePlans(EMPTY_JOURNAL_STATE, [task()], {
      observedAt: '2026-09-11T07:00:00.000Z',
      idFactory: () => 'unused',
    });
    const movedOnce = observePlans(initial.state, [task({ startTime: '10:00' })], {
      observedAt: '2026-09-11T07:30:00.000Z',
      idFactory: () => 'revision-1',
    });
    const movedTwice = observePlans(movedOnce.state, [task({ startTime: '16:00' })], {
      observedAt: '2026-09-11T08:00:00.000Z',
      idFactory: () => 'revision-2',
    });

    expect(historicalPlansForDate(movedTwice.state, '2026-09-11')).toHaveLength(1);
    expect(historicalPlansForDate(movedTwice.state, '2026-09-11')[0].startTime).toBe('09:00');
  });

  it('can correct actual time while keeping the captured plan intact', () => {
    const recorded = recordPlanAsActual(EMPTY_JOURNAL_STATE, task(), {
      id: 'actual-1',
      recordedAt: '2026-09-11T10:00:00.000Z',
    });
    const corrected = updateActualBlock(recorded.state, 'actual-1', {
      startTime: '09:15',
      duration: 40,
    }, '2026-09-11T20:00:00.000Z');

    expect(corrected.actualBlocks[0].startTime).toBe('09:15');
    expect(corrected.actualBlocks[0].duration).toBe(40);
    expect(corrected.actualBlocks[0].planSnapshot.startTime).toBe('09:00');
    expect(actualBlockMatchesPlan(corrected.actualBlocks[0], task())).toBe(false);
  });

  it('summarizes actual time and plan revisions by day', () => {
    const first = recordPlanAsActual(EMPTY_JOURNAL_STATE, task(), {
      id: 'actual-1',
      recordedAt: '2026-09-11T10:00:00.000Z',
    });
    const second = recordPlanAsActual(first.state, task({ id: 'task-2', title: 'Meeting', startTime: '10:30', duration: 30 }), {
      id: 'actual-2',
      recordedAt: '2026-09-11T11:00:00.000Z',
    });

    expect(actualBlocksForDate(second.state, '2026-09-11')).toHaveLength(2);
    expect(summarizeJournalDay(second.state, '2026-09-11')).toMatchObject({
      actualCount: 2,
      actualMinutes: 90,
      uniqueTaskCount: 2,
    });
  });
});
