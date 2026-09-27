import { useEffect, useRef, useState } from 'react';
import { buildPomodoroRecord, createPomodoroTarget } from '../jobo/pomodoro.js';

/** Task binding and durable rounds for the existing Focus Mode timer. */
export default function useTaskPomodoro({ records, readWorkingSet, recordJobo, loaded, writable }) {
  const [target, setTarget] = useState(null);
  const [saveState, setSaveState] = useState('');
  const targetRef = useRef(null);
  const cycleRef = useRef(null);
  const pending = useRef(new Map());
  const busy = useRef(false);
  const ended = useRef(false);

  useEffect(() => {
    for (const [id, entry] of pending.current) {
      if (records?.find(record => record.id === entry.target.recordId)?.pomodoroSessions?.some(session => session.id === id)) {
        pending.current.delete(id);
      }
    }
    if (!pending.current.size && targetRef.current) setSaveState(previous => previous ? 'saved' : '');
  }, [records]);

  const retry = async () => {
    if (busy.current || !pending.current.size) return;
    busy.current = true;
    setSaveState('saving');
    try {
      for (const [id, entry] of pending.current) {
        const record = buildPomodoroRecord({ ...entry, records: readWorkingSet() || [] });
        const result = await recordJobo([record]);
        if (!result?.ok) throw new Error(result?.error || 'storageWrite');
        const committed = result.value?.find(row => row.id === record.id);
        if (!committed || committed.deleted || !committed.pomodoroSessions?.some(session => session.id === id)) throw new Error('recordChanged');
        pending.current.delete(id);
      }
      setSaveState('saved');
    } catch { setSaveState('error'); }
    finally { busy.current = false; }
  };

  return {
    target, saveState, retry,
    bind(task, record = null) {
      if (!loaded || !writable || pending.current.size) return false;
      const next = createPomodoroTarget(task, record, `focus:${crypto.randomUUID()}`);
      targetRef.current = next;
      setTarget(next);
      cycleRef.current = null;
      ended.current = false;
      setSaveState('');
      return true;
    },
    clear() {
      targetRef.current = null;
      setTarget(null);
      cycleRef.current = null;
      ended.current = false;
    },
    startCycle(minutes, now = Date.now()) {
      if (!targetRef.current) return;
      cycleRef.current = { id: `pomodoro:${crypto.randomUUID()}`, startedAt: now, minutes };
    },
    finishCycle(endedAt = Date.now()) {
      if (!targetRef.current || !cycleRef.current) return;
      const cycle = cycleRef.current;
      cycleRef.current = null;
      pending.current.set(cycle.id, { target: targetRef.current, cycle, endedAt });
      void retry();
    },
    skipCycle() { cycleRef.current = null; },
    finishSession() {
      cycleRef.current = null;
      if (ended.current) return false;
      ended.current = true;
      return true;
    },
  };
}
