import { useEffect, useRef, useReducer } from 'react';
import { snapshotJoboState, planJoboTransitions, buildJoboRecords } from '../jobo/detector.js';
import { isTrayMode } from '../utils/trayMode.js';

// JOBO completion detector (slice 4). Watches task state for completion
// transitions and writes Do records through recordJobo, the ledger's only
// writer. The planning is pure and lives in src/jobo/detector.js; this hook
// owns the snapshot, the in-flight guard and the write, in the shape of
// useCompletionLog.
//
// One-shot, like the completion log: the snapshot advances after the write
// attempt whatever its outcome, so a transition is attempted exactly once
// here. A failed local write is reported by the ledger (joboError) and, when
// another device observes the same completion through sync, produced there
// under the same id.
export default function useJoboDetector({
  tasks, unscheduledTasks, recurringTasks,
  joboRecords, joboLoaded, joboWritable, recordJobo,
  isRemoteApply,
  enabled,
}) {
  const prevRef = useRef(null);
  const inFlightRef = useRef(false);
  const [, bump] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    if (isTrayMode) return;
    const nextSnap = snapshotJoboState(tasks, unscheduledTasks, recurringTasks);
    const { edges, advanceTo } = planJoboTransitions(prevRef.current, nextSnap, {
      tasks, unscheduledTasks, recurringTasks,
      isRemoteApply: !!isRemoteApply?.(),
      enabled: !!enabled,
      loaded: !!joboLoaded,
      writable: joboWritable !== false,
      inFlight: inFlightRef.current,
    });
    if (!edges) {
      if (advanceTo !== null) prevRef.current = advanceTo;
      return;
    }
    const records = buildJoboRecords(edges, joboRecords, { observedAt: new Date().toISOString() });
    if (!records.length) {
      prevRef.current = nextSnap; // every edge was already present, or unusable
      return;
    }
    inFlightRef.current = true;
    Promise.resolve()
      .then(() => recordJobo(records))
      .then((result) => {
        if (result && result.ok === false) console.warn('[jobo] ledger write refused:', result.error);
      })
      .catch((err) => { console.error('[jobo] ledger write failed:', err); })
      .finally(() => {
        prevRef.current = nextSnap;
        inFlightRef.current = false;
        bump(); // catch transitions that arrived during the in-flight window
      });
  });
}
