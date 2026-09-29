import { useCallback, useEffect, useRef, useState } from 'react';
import { pickJoboRecord, validateDoRecord } from '../jobo/core.js';

// This is a UI receipt, not another writer/queue. Only recordJobo owns the
// mutation and its retry. No task completion, task field or storage is coupled
// to a Do edit. Pending receipts must never be reported as durable. An accepted
// write (saved, or held for retry) is reported to `onWritten` with the version
// it replaced, which is how it becomes an undo step; a superseded one is not.
export function sameDoValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function receiptState(expected, records) {
  const current = records?.find(row => row?.id === expected.id);
  if (!current) return 'pending';
  if (sameDoValue(current, expected)) return 'saved';
  try { return pickJoboRecord(current, expected) === current ? 'superseded' : 'pending'; }
  catch { return 'superseded'; }
}

export default function useJoboViewWriter({ records, recordJobo, onWritten }) {
  const live = useRef({ records, recordJobo, onWritten });
  live.current = { records, recordJobo, onWritten };
  const receipts = useRef(new Map());
  const mounted = useRef(true);
  const [pendingIds, setPendingIds] = useState([]);
  const [conflict, setConflict] = useState(false);
  const publish = useCallback(() => {
    if (mounted.current) setPendingIds([...receipts.current.keys()]);
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let changed = false;
    for (const [id, receipt] of receipts.current) {
      if (!receipt.accepted) continue;
      const state = receiptState(receipt.record, records);
      if (state === 'pending') continue;
      receipts.current.delete(id);
      changed = true;
      if (state === 'superseded') setConflict(true);
    }
    if (changed) publish();
  }, [records, publish]);

  const write = useCallback(async input => {
    if (!Array.isArray(input) || input.length !== 1 || !validateDoRecord(input[0]).ok) {
      throw new TypeError('A view edit submits one canonical Do record');
    }
    const record = input[0];
    if (receipts.current.has(record.id)) return { ok: false, error: 'pending' };
    const before = live.current.records?.find(row => row?.id === record.id) ?? null;
    if (sameDoValue(before, record)) return { ok: true };
    // Recording the undo step must never turn a saved write into a failure.
    const accepted = () => {
      try { live.current.onWritten?.(before, record); } catch (err) { console.error('[jobo] undo step not recorded:', err); }
    };
    const receipt = { record, accepted: false };
    receipts.current.set(record.id, receipt);
    publish();
    if (mounted.current) setConflict(false);
    try {
      const result = await live.current.recordJobo(input);
      if (result?.ok) {
        // A successful merge can still select a newer remote version. Never
        // call that our save, and never restamp/re-submit to defeat the winner.
        const state = receiptState(record, result.value || live.current.records);
        receipts.current.delete(record.id);
        if (state === 'superseded') {
          if (mounted.current) setConflict(true);
          return { ok: false, error: 'recordChanged' };
        }
        accepted();
      } else if (result?.held) {
        receipt.accepted = true;
        const state = receiptState(record, live.current.records);
        if (state !== 'pending') {
          receipts.current.delete(record.id);
          if (state === 'superseded' && mounted.current) setConflict(true);
        }
        if (state !== 'superseded') accepted();
      } else receipts.current.delete(record.id);
      return result;
    } catch (error) {
      receipts.current.delete(record.id);
      throw error;
    } finally { publish(); }
  }, [publish]);
  return { write, pendingIds, conflict };
}
