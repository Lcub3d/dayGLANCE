import { useState, useRef, useEffect } from 'react';

const useUndo = ({ tasks, unscheduledTasks, recycleBin, recurringTasks, setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks, playUISound, t }) => {
  // Toast text, translated when the app passes t (tests may not).
  const say = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const tasksRef = useRef(tasks);
  const unscheduledTasksRef = useRef(unscheduledTasks);
  const recycleBinRef = useRef(recycleBin);
  const recurringTasksRef = useRef(recurringTasks);

  const [undoToast, setUndoToast] = useState(null);
  // Action steps (a JOBO Do edit) run one at a time, in the order pressed.
  const actionQueueRef = useRef(Promise.resolve());

  // Keep refs in sync with state
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { unscheduledTasksRef.current = unscheduledTasks; }, [unscheduledTasks]);
  useEffect(() => { recycleBinRef.current = recycleBin; }, [recycleBin]);
  useEffect(() => { recurringTasksRef.current = recurringTasks; }, [recurringTasks]);

  // Auto-dismiss undo/redo toast — 4s for actionable (with Undo button), 2s
  // for passive, 10s when it also offers a follow-up: that one is a decision
  // about what comes next, not a reflex. A toast the pointer or keyboard is
  // on (`held`) stays until it is left, then gets its full time again.
  useEffect(() => {
    if (!undoToast || undoToast.held) return;
    const delay = undoToast.followUp ? 10000 : undoToast.actionable ? 4000 : 2000;
    const timer = setTimeout(() => setUndoToast(null), delay);
    return () => clearTimeout(timer);
  }, [undoToast]);

  // Undo/redo: snapshot all 4 state arrays (read from refs for latest state)
  const pushUndo = () => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      {
        tasks: structuredClone(tasksRef.current),
        unscheduledTasks: structuredClone(unscheduledTasksRef.current),
        recycleBin: structuredClone(recycleBinRef.current),
        recurringTasks: structuredClone(recurringTasksRef.current),
      }
    ];
    redoStackRef.current = [];
  };

  // A step that is not a task snapshot: something another subsystem can undo
  // and redo itself, such as a Do edit in JOBO. It shares this history, so
  // Cmd+Z reverses whatever was done last. `undo` and `redo` are async and
  // resolve to { ok, message }.
  const pushUndoAction = (action) => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), { action }];
    redoStackRef.current = [];
  };

  // The step moves to the other stack at once, so the order of the two
  // stacks is the order pressed; it comes off again if it cannot run (the
  // record changed, or the write failed), and the toast says why.
  const runAction = (entry, direction, otherStackRef, done) => {
    otherStackRef.current = [...otherStackRef.current, entry];
    actionQueueRef.current = actionQueueRef.current.then(async () => {
      let result;
      try { result = await entry.action[direction](); } catch { result = { ok: false }; }
      if (result?.ok) {
        playUISound('undo');
        // An action step can name what it did ("Do change undone"), so an
        // undo that lands off screen still says what changed.
        setUndoToast({ message: result.message || done, actionable: false });
      } else {
        otherStackRef.current = otherStackRef.current.filter((e) => e !== entry);
        setUndoToast({ message: result?.message || (direction === 'undo' ? say('common.undoFailed', 'Could not undo') : say('common.redoFailed', 'Could not redo')), actionable: false });
      }
    });
  };

  const performUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const snapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    if (snapshot.action) { runAction(snapshot, 'undo', redoStackRef, say('common.undone', 'Undone')); return; }
    redoStackRef.current = [
      ...redoStackRef.current,
      {
        tasks: structuredClone(tasksRef.current),
        unscheduledTasks: structuredClone(unscheduledTasksRef.current),
        recycleBin: structuredClone(recycleBinRef.current),
        recurringTasks: structuredClone(recurringTasksRef.current),
      }
    ];
    setTasks(prev => [...snapshot.tasks.filter(t => !t._native), ...prev.filter(t => t._native)]);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    playUISound('undo');
    setUndoToast({ message: say('common.undone', 'Undone'), actionable: false });
  };

  const performRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    if (snapshot.action) { runAction(snapshot, 'redo', undoStackRef, say('common.redone', 'Redone')); return; }
    undoStackRef.current = [
      ...undoStackRef.current,
      {
        tasks: structuredClone(tasksRef.current),
        unscheduledTasks: structuredClone(unscheduledTasksRef.current),
        recycleBin: structuredClone(recycleBinRef.current),
        recurringTasks: structuredClone(recurringTasksRef.current),
      }
    ];
    setTasks(prev => [...snapshot.tasks.filter(t => !t._native), ...prev.filter(t => t._native)]);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    playUISound('undo');
    setUndoToast({ message: say('common.redone', 'Redone'), actionable: false });
  };

  return { undoToast, setUndoToast, pushUndo, pushUndoAction, performUndo, performRedo };
};

export default useUndo;
