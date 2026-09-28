import { useCallback, useRef } from 'react';
import { joboUndoEntry, planJoboUndo } from '../jobo/undo.js';

// Puts Do edits from the JOBO view into the app's one undo history, beside the
// task snapshots, so Cmd+Z reverses whatever was done last, task or Do.
//
// The view reports each accepted write; this hook turns it into an undo step
// whose undo and redo plan against the ledger as it stands at that moment and
// write through recordJobo, the ledger's only writer. It reads the working
// set, as the detector does, so a step whose write is still held for retry
// can be undone; the working set is read here, never published as state.
export default function useJoboUndo({ joboRecords, readJoboWorkingSet, recordJobo, pushUndoAction, t }) {
  const live = useRef(null);
  live.current = { joboRecords, readJoboWorkingSet, recordJobo, pushUndoAction, t };

  return useCallback((before, after) => {
    const entry = joboUndoEntry(before, after);
    const run = (direction) => async () => {
      const { joboRecords: committed, readJoboWorkingSet: read, recordJobo: write, t: tr } = live.current;
      const records = read?.() ?? committed;
      if (!Array.isArray(records)) return { ok: false, message: tr('jobo.undo.failed') };
      const plan = planJoboUndo(entry, direction, records, Date.now());
      if (plan.conflict) return { ok: false, message: tr('jobo.undo.changed') };
      if (plan.blocked) return { ok: false, message: tr('jobo.undo.completionBlocked') };
      try {
        const result = await write([plan.record]);
        if (result?.ok || result?.held) {
          entry.expect = plan.record;
          return { ok: true };
        }
      } catch (err) {
        console.error('[jobo] undo write failed:', err);
      }
      return { ok: false, message: tr('jobo.undo.failed') };
    };
    live.current.pushUndoAction({ undo: run('undo'), redo: run('redo') });
  }, []);
}
