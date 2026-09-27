import { useCallback, useEffect, useRef, useState } from 'react';
import { pickJoboRecord, validateDoRecord } from '../jobo/core.js';

// This is a UI receipt, not another writer/queue. Only recordJobo owns the
// mutation and its retry. No task completion, task field, storage, or undo is
// coupled to a Do edit. Pending receipts must never be reported as durable.
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

export default function useJoboViewWriter({ records, recordJobo }) {
  const live = useRef({ records, recordJobo });
  live.current = { records, recordJobo };
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
    if (sameDoValue(live.current.records?.find(row => row?.id === record.id), record)) return { ok: true };
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
      } else if (result?.held) {
        receipt.accepted = true;
        const state = receiptState(record, live.current.records);
        if (state !== 'pending') {
          receipts.current.delete(record.id);
          if (state === 'superseded' && mounted.current) setConflict(true);
        }
      } else receipts.current.delete(record.id);
      return result;
    } catch (error) {
      receipts.current.delete(record.id);
      throw error;
    } finally { publish(); }
  }, [publish]);
  return { write, pendingIds, conflict };
}
