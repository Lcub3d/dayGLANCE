import { useEffect, useRef } from 'react';
import { doRecordFingerprint, prepareDoUndo } from '../jobo/undo.js';
import { nativeDoCompletionState, sameNativeCompletion } from '../jobo/completionBridge.js';
import { latestDoForTask } from '../jobo/completionPolicy.js';

// View commands share native undo ordering, but compensate one ledger record
// at a time. No whole-ledger restore and no stale timestamp rollback.
export default function useJoboViewWriter({ records, pendingIds = [], recordJobo, pushUndoAction, tasks, unscheduledTasks, recurringTasks, setJoboTaskCompletion, onNotice }) {
  const live = useRef(null);
  live.current = { records: records || [], pendingIds, recordJobo, pushUndoAction, tasks, unscheduledTasks, recurringTasks, setJoboTaskCompletion, onNotice };
  const waiting = useRef(new Set());
  const aliases = useRef(new Map());
  const nativeAliases = useRef(new Map());
  const activeIds = useRef(new Set());
  const notice = message => {
    // Notification failures must never strand a confirmed undo promise.
    try { live.current.onNotice?.(message); } catch { /* The data result still stands. */ }
  };
  const relinquishNative = (entry, conflict = false) => {
    entry.native = null;
    notice(conflict
      ? 'Do 已保存；关联任务在等待期间发生变化，已保留任务当前状态。'
      : 'Do 已保存；关联任务状态更新未完成，后续撤销将保留任务当前状态。');
  };
  const settle = (job, ok, current) => {
    if (job.settled) return;
    job.settled = true;
    waiting.current.delete(job);
    activeIds.current.delete(job.next.id);
    try { job.finish(ok, current); }
    catch { notice('Do 状态已确认，但关联界面更新未完成。'); }
    // Canonical persistence defines success. Native side effects cannot turn
    // an already-applied compensation into a stuck or falsely failed undo.
    finally { job.resolve?.(ok); }
  };
  const currentVersion = record => {
    let result = record;
    const seen = new Set();
    while (result) {
      const key = doRecordFingerprint(result);
      if (seen.has(key) || !aliases.current.has(key)) break;
      seen.add(key);
      result = aliases.current.get(key);
    }
    return result;
  };
  const nativeKey = state => JSON.stringify(state);
  const currentNativeVersion = state => {
    let result = state;
    const seen = new Set();
    while (result && nativeAliases.current.has(nativeKey(result)) && !seen.has(nativeKey(result))) {
      seen.add(nativeKey(result)); result = nativeAliases.current.get(nativeKey(result));
    }
    return result;
  };
  const check = () => {
    for (const job of [...waiting.current]) {
      const current = live.current.records.find(row => row.id === job.next.id);
      if (live.current.pendingIds.includes(job.next.id) || !job.accepted) continue;
      try {
        if (current && doRecordFingerprint(current) === doRecordFingerprint(job.next)) settle(job, true, current);
        else if (current && Date.parse(current.updatedAt) >= Date.parse(job.next.updatedAt)) settle(job, false, current);
      } catch { settle(job, false, current); }
    }
  };
  useEffect(check);

  const compensate = async (entry, target, forward) => {
    const ctx = live.current;
    if (!entry.ready || activeIds.current.has(entry.after.id)) return false;
    if (entry.native && !sameNativeCompletion(nativeDoCompletionState(ctx, entry.after), currentNativeVersion(entry.native.current))) return false;
    const next = prepareDoUndo({ records: ctx.records, pendingIds: ctx.pendingIds,
      expected: currentVersion(entry.expected), target, now: Date.now() });
    if (!next) return false;
    activeIds.current.add(next.id);
    let finish;
    const confirmed = new Promise(resolve => { finish = resolve; });
    const job = { next, accepted: false, resolve: finish, finish: (ok, actual) => {
      if (!ok) return;
      entry.expected = actual;
      if (target) {
        const resolved = currentVersion(target);
        aliases.current.set(doRecordFingerprint(resolved), actual);
        aliases.current.set(doRecordFingerprint(target), actual);
      }
      if (entry.native) {
        try {
          const state = nativeDoCompletionState(live.current, entry.after);
          if (!sameNativeCompletion(state, currentNativeVersion(entry.native.current))) { relinquishNative(entry, true); return; }
          const desired = forward ? entry.native.after : entry.native.before;
          const latest = latestDoForTask(live.current, entry.after);
          // An explicit Plan check has its own grouped inverse, even if an
          // inferred interval moved before another future Do on the timeline.
          const completed = entry.completePlan ? (forward || desired.completed) : latest ? latest.progress === 'completed' : desired.completed;
          const result = live.current.setJoboTaskCompletion(state, completed, entry.completePlan ? entry.after.id : latest?.id || entry.after.id);
          if (!result) { relinquishNative(entry); return; }
          const resolved = currentNativeVersion(desired);
          nativeAliases.current.set(nativeKey(resolved), result);
          nativeAliases.current.set(nativeKey(desired), result);
          entry.native.current = result;
        } catch { relinquishNative(entry); }
      }
    } };
    waiting.current.add(job);
    try {
      const result = await ctx.recordJobo([next]);
      if (!result?.ok && !result?.held) throw new Error('Do undo was refused');
      job.accepted = true;
      check();
      return await confirmed;
    } catch {
      settle(job, false);
      return false;
    }
  };

  return async (input, { completePlan = false } = {}) => {
    if (!Array.isArray(input) || input.length !== 1) throw new TypeError('A view command writes one Do');
    const after = input[0];
    const ctx = live.current;
    if (activeIds.current.has(after.id) || ctx.pendingIds.includes(after.id)) {
      return { ok: false, held: false, error: Object.assign(new Error('Do is still saving'), { code: 'pending' }) };
    }
    const before = ctx.records.find(row => row.id === after.id) || null;
    if (!completePlan && before && doRecordFingerprint(before) === doRecordFingerprint(after)) return { ok: true };
    const entry = { before, after, expected: after, ready: false, native: null, completePlan,
      nativeAtStart: completePlan ? nativeDoCompletionState(ctx, after) : null };
    const cancel = ctx.pushUndoAction({
      undo: () => compensate(entry, before, false),
      redo: () => compensate(entry, after, true),
    });
    activeIds.current.add(after.id);
    const job = { next: after, accepted: false, finish: (ok) => {
      if (!ok) { cancel?.(); return; }
      entry.ready = true;
      // Progress and timeline order both determine the last linked Do. Notes
      // alone do not reassert a checkbox the user may have changed elsewhere.
      if (completePlan || !before || ['progress', 'deleted', 'timing', 'date', 'startTime', 'endDate', 'endTime'].some(key => before[key] !== after[key])) {
        try {
          const state = nativeDoCompletionState(live.current, after);
          if (completePlan && !sameNativeCompletion(state, entry.nativeAtStart)) { relinquishNative(entry, true); return; }
          const latest = latestDoForTask(live.current, after);
          const desired = completePlan || latest?.progress === 'completed';
          if (state && state.completed !== desired) {
            const result = live.current.setJoboTaskCompletion(state, desired, completePlan ? after.id : latest?.id || after.id);
            if (result) entry.native = { before: state, after: result, current: result };
            else relinquishNative(entry);
          }
        } catch { relinquishNative(entry); }
      }
    } };
    waiting.current.add(job);
    try {
      const result = await ctx.recordJobo(input);
      if (!result?.ok && !result?.held) {
        settle(job, false);
      } else { job.accepted = true; check(); }
      return result;
    } catch (error) {
      settle(job, false);
      throw error;
    }
  };
}
