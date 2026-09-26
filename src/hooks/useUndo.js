import { useState, useRef, useEffect } from 'react';

/** One chronological history for native snapshots and explicit async actions. */
export function createUndoHistory({ captureSnapshot, restoreSnapshot, onSuccess, onFailure, onBusy, limit = 50 }) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Undo history limit must be a positive integer');
  let undoStack = [];
  let redoStack = [];
  let running = null;
  let revision = 0;

  const register = (entry) => {
    const previousRedo = redoStack;
    undoStack = [...undoStack, entry].slice(-limit);
    redoStack = [];
    const registeredAt = ++revision;
    // Reserve chronological position before awaiting storage; remove this
    // reservation if the writer refuses the mutation (rather than holds it).
    return () => {
      if (running === entry || !undoStack.includes(entry)) return false;
      undoStack = undoStack.filter(value => value !== entry);
      if (revision === registeredAt) redoStack = previousRedo;
      revision += 1;
      return true;
    };
  };

  const perform = async (direction) => {
    if (running) {
      onBusy?.(direction);
      return false;
    }
    const source = direction === 'undo' ? undoStack : redoStack;
    const entry = source.at(-1);
    if (!entry) return false;
    running = entry;
    const startedAt = revision;
    try {
      let inverse = entry;
      if (entry.kind === 'snapshot') {
        inverse = { kind: 'snapshot', snapshot: captureSnapshot() };
        // Native state setters retain their synchronous behavior.
        restoreSnapshot(entry.snapshot);
      } else if (await entry[direction]() === false) {
        onFailure?.(direction);
        return false;
      }
      if (direction === 'undo') {
        undoStack = undoStack.filter(value => value !== entry);
        // New mutations during async undo invalidate redo without removing
        // those newer mutations from their place on the undo stack.
        if (revision === startedAt) redoStack = [...redoStack, inverse];
      } else {
        redoStack = redoStack.filter(value => value !== entry);
        if (revision === startedAt) undoStack = [...undoStack, inverse].slice(-limit);
      }
      onSuccess?.(direction);
      return true;
    } catch (error) {
      onFailure?.(direction, error);
      return false;
    } finally {
      running = null;
    }
  };

  return {
    pushUndo: () => register({ kind: 'snapshot', snapshot: captureSnapshot() }),
    pushUndoAction: (action) => {
      if (typeof action?.undo !== 'function' || typeof action?.redo !== 'function') {
        throw new TypeError('Undo actions require undo and redo functions');
      }
      return register({ kind: 'action', undo: action.undo, redo: action.redo });
    },
    performUndo: () => perform('undo'),
    performRedo: () => perform('redo'),
  };
}

const useUndo = ({ tasks, unscheduledTasks, recycleBin, recurringTasks, setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks, playUISound }) => {
  const [undoToast, setUndoToast] = useState(null);
  const latest = useRef(null);
  latest.current = { tasks, unscheduledTasks, recycleBin, recurringTasks, setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks, playUISound };
  const history = useRef(null);
  if (history.current === null) {
    history.current = createUndoHistory({
      captureSnapshot: () => {
        const state = latest.current;
        return structuredClone({ tasks: state.tasks, unscheduledTasks: state.unscheduledTasks, recycleBin: state.recycleBin, recurringTasks: state.recurringTasks });
      },
      restoreSnapshot: (saved) => {
        const snapshot = structuredClone(saved);
        const state = latest.current;
        const mergeNative = (current) => [...snapshot.tasks.filter(task => !task._native), ...current.filter(task => task._native)];
        latest.current = { ...state, ...snapshot, tasks: mergeNative(state.tasks) };
        state.setTasks(mergeNative);
        state.setUnscheduledTasks(snapshot.unscheduledTasks);
        state.setRecycleBin(snapshot.recycleBin);
        state.setRecurringTasks(snapshot.recurringTasks);
      },
      onSuccess: (direction) => {
        latest.current.playUISound('undo');
        setUndoToast({ message: direction === 'undo' ? 'Undone' : 'Redone', actionable: false });
      },
      onFailure: (direction) => setUndoToast({ message: direction === 'undo'
        ? 'Unable to undo: this change is still saving or changed elsewhere.'
        : 'Unable to redo: this change is still saving or changed elsewhere.', actionable: false }),
      onBusy: () => setUndoToast({ message: 'Please wait for the current undo or redo to finish.', actionable: false }),
    });
  }

  // Auto-dismiss undo/redo toast — 4s for actionable, 2s for passive.
  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => setUndoToast(null), undoToast.actionable ? 4000 : 2000);
    return () => clearTimeout(timer);
  }, [undoToast]);

  return { undoToast, setUndoToast, ...history.current };
};

export default useUndo;
