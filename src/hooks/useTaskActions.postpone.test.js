import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';

// useTaskActions is a plain factory (no React hooks in its body), so it can be
// called directly with just the deps postponeTask touches.
const buildActions = (tasks, { conflicted = false } = {}) => {
  let state = tasks;
  const setTasks = vi.fn(fn => { state = fn(state); });
  const getAdjustedTimeForImportedConflicts = vi.fn(() => ({ conflicted, conflictingEvent: { title: 'Meeting' } }));
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { postponeTask } = useTaskActions({
    tasks, setTasks, getAdjustedTimeForImportedConflicts,
    pushUndo: vi.fn(() => 'Postponed'), setUndoToast: vi.fn(), playUISound: vi.fn(),
    setSyncNotification: vi.fn(),
    onboardingProgress: { hasUsedActionButtons: true }, setOnboardingProgress: vi.fn(),
  });
  return { postponeTask, getState: () => state, setTasks, getAdjustedTimeForImportedConflicts };
};

describe('postponeTask — all-day tasks', () => {
  it.each([null, undefined, ''])('moves an all-day task with startTime %p to the next day', (startTime) => {
    // lastGLANCE intents create date-only tasks with startTime: null.
    const { postponeTask, getState, getAdjustedTimeForImportedConflicts } = buildActions([
      { id: 'a', title: 'From lastGLANCE', date: '2026-10-17', startTime, isAllDay: true, source_app: 'lastglance' },
    ]);

    postponeTask('a');

    expect(getState()[0].date).toBe('2026-10-18');
    expect(getAdjustedTimeForImportedConflicts).not.toHaveBeenCalled();
  });

  it('does not let a timed conflict block an all-day task', () => {
    const { postponeTask, getState } = buildActions([
      { id: 'a', title: 'All day', date: '2026-10-17', startTime: '00:00', isAllDay: true },
    ], { conflicted: true });

    postponeTask('a');

    expect(getState()[0].date).toBe('2026-10-18');
  });

  it('still ignores a timed task with no start time', () => {
    const { postponeTask, setTasks } = buildActions([
      { id: 't', title: 'Broken', date: '2026-10-17', startTime: null, isAllDay: false },
    ]);

    postponeTask('t');

    expect(setTasks).not.toHaveBeenCalled();
  });

  it('still blocks a timed task on a conflict', () => {
    const { postponeTask, setTasks } = buildActions([
      { id: 't', title: 'Timed', date: '2026-10-17', startTime: '09:00', duration: 30, isAllDay: false },
    ], { conflicted: true });

    postponeTask('t');

    expect(setTasks).not.toHaveBeenCalled();
  });
});
