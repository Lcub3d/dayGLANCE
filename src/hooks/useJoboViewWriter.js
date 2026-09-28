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

/** Validate one complete, non-empty batch before it reaches the ledger. */
export function validateDoBatch(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError('A view edit submits one or more canonical Do records');
  }
  const ids = new Set();
  for (const record of input) {
    if (!record || typeof record !== 'object' || ids.has(record.id) || !validateDoRecord(record).ok) {
      throw new TypeError('A view edit submits one or more unique canonical Do records');
    }
    ids.add(record.id);
  }
  return input;
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
    const batch = validateDoBatch(input);
    if (batch.some(record => receipts.current.has(record.id))) return { ok: false, error: 'pending' };
    if (batch.every(record => sameDoValue(live.current.records?.find(row => row?.id === record.id), record))) {
      return { ok: true };
    }
    for (const record of batch) receipts.current.set(record.id, { record, accepted: false });
    publish();
    if (mounted.current) setConflict(false);
    try {
      // One ledger call is the atomic boundary for a view batch.  Never loop
      // over records here: a held write must keep the whole selection together
      // and a storage failure must not leave a partial receipt set.
      const result = await live.current.recordJobo(batch);
      if (result?.ok) {
        // A successful merge can still select a newer remote version. Never
        // call that our save, and never restamp/re-submit to defeat the winner.
        const committed = result.value || live.current.records;
        let superseded = false;
        for (const record of batch) {
          const state = receiptState(record, committed);
          receipts.current.delete(record.id);
          superseded = superseded || state === 'superseded';
        }
        if (superseded) {
          if (mounted.current) setConflict(true);
          return { ok: false, error: 'recordChanged' };
        }
      } else if (result?.held) {
        let superseded = false;
        for (const record of batch) {
          const receipt = receipts.current.get(record.id);
          if (receipt) receipt.accepted = true;
          const state = receiptState(record, live.current.records);
          if (state !== 'pending') {
            receipts.current.delete(record.id);
            superseded = superseded || state === 'superseded';
          }
        }
        if (superseded && mounted.current) setConflict(true);
      } else {
        for (const record of batch) receipts.current.delete(record.id);
      }
      return result;
    } catch (error) {
      for (const record of batch) receipts.current.delete(record.id);
      throw error;
    } finally { publish(); }
  }, [publish]);
  return { write, pendingIds, conflict };
}
