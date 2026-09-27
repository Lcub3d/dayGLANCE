import { describe, it, expect, vi } from 'vitest';
import { togglePlanCompletion } from './nativePlanAdapter.js';
describe('Slice 5 native checkbox', () => {
  it('calls only the native handler for a live completable task', () => {
    const toggleComplete = vi.fn();
    const task = { id: 't1', completed: false };
    const item = { currentTask: task, historical: false };
    expect(togglePlanCompletion({ toggleComplete }, item)).toBe(true);
    expect(toggleComplete).toHaveBeenCalledExactlyOnceWith('t1', false);
    expect(task.completed).toBe(false);
  });
  it.each([
    { historical: true, currentTask: { id: 't1' } },
    { currentTask: { id: 't1', isJoboSyntheticOccurrence: true } },
    { currentTask: { id: 't1', imported: true } },
    { currentTask: null },
  ])('never mutates captured or non-completable Plans', item => {
    const toggleComplete = vi.fn();
    expect(togglePlanCompletion({ toggleComplete }, item)).toBe(false);
    expect(toggleComplete).not.toHaveBeenCalled();
  });
});
