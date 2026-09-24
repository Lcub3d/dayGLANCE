// The completion detector's pure half (JOBO slice 4).
//
// Completing a task writes a Do record; the record is a by-product of working.
// This module is a planner over prev → next snapshots of task state, in the
// shape of useCompletionLog's planner, with the record construction beside it.
// No React, no storage, no clock: the hook (useJoboDetector) supplies the
// snapshots, the ledger's current records and the observation time, and
// commits what this returns through recordJobo, the ledger's only writer.
// docs/jobo-ledger-persistence.md, "Identity, and idempotent creation".
//
// THE RULES IT ENFORCES
// - EVERY COMPLETION COUNTS, ONCE. The edge is the completion state
//   transition, so DAY, LIST, SCHED, phone, widgets, voice, MCP and an
//   Obsidian checkbox all produce the same Do. Two devices observing the same
//   completion produce the same id (deterministic, from the task's own
//   completion stamp), creation is ensure-present, and the merge rule picks
//   one copy. A key is never built from the observing device's clock.
// - FIRST SIGHT IS NEVER A TRANSITION. A task that arrives completed (import,
//   restore, the first render) was not completed now.
// - A DO RECORD NEVER CHANGES THE PLAN. Nothing here touches a task.
// - A COMPLETION IS UNTIMED. A checkbox says the work happened, not when it
//   began, so the record is `timing: 'untimed'` with the plan captured as it
//   stands. Untimed never means zero minutes; the interval can be corrected in
//   the view later, under the same id.
// - UN-COMPLETING TARGETS THE RECORD BY THE PREVIOUS KEY. The uncheck clears
//   the stamp in `next`, so the key comes from `prev`. The attempt drops to
//   Partially completed and is never deleted. Completing again is a new key.
// - A COMPLETION WITHOUT A STAMP MAKES NO RECORD. Every current completion
//   path stamps `completedAt` (ordinary) or `completedDatesTimestamps`
//   (recurring); a legacy recurring completion with no stamp keys on the
//   template and date alone, permanently. An ordinary completion with no
//   stamp has no source event to anchor to, and fabricating one from this
//   device's clock would defeat convergence, so it is skipped.

import { completeDoAttempt, reassessDoProgress, DO_PROGRESS, DO_TIMING } from './core.js';

const isStamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// A stamp that carries its offset names the completing device's civil date in
// its first ten characters, which every observer reads the same way.
const OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?[+-]\d{2}:\d{2}$/;

/** Deterministic ids. Exported so the view and importers can name a record. */
export const completionKey = (taskId, completedAt) => `do:${taskId}:${completedAt}`;
export const recurringKey = (templateId, instanceDate, stamp) =>
  (stamp ? `do:${templateId}:${instanceDate}:${stamp}` : `do:${templateId}:${instanceDate}`);

/**
 * Minimal snapshot: enough to see a completion edge in either direction and
 * to rebuild the key of a completion that has since been undone.
 *   items[id]            → false | true (completed, stamp unknown) | completedAt
 *   recurring[id][date]  → null (no stamp) | the per-date stamp
 */
export function snapshotJoboState(tasks, unscheduledTasks, recurringTasks) {
  const items = {};
  for (const t of [...(tasks || []), ...(unscheduledTasks || [])]) {
    if (!t || t.id == null) continue;
    items[String(t.id)] = t.completed ? (isStamp(t.completedAt) ? t.completedAt : true) : false;
  }
  const recurring = {};
  for (const r of recurringTasks || []) {
    if (!r || r.id == null) continue;
    const stamps = r.completedDatesTimestamps || {};
    const dates = {};
    for (const d of r.completedDates || []) dates[d] = isStamp(stamps[d]) ? stamps[d] : null;
    recurring[String(r.id)] = dates;
  }
  return { items, recurring };
}

/** The civil date a completion stamp names, as every observer would read it. */
export function civilDateOf(stamp, now = new Date()) {
  if (OFFSET_RE.test(stamp)) return stamp.slice(0, 10);
  const d = isStamp(stamp) ? new Date(stamp) : now;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The plan as it stands, or null when there is no timed plan to copy. */
export function planSnapshotOf(task, date = task?.date) {
  if (!task || !DATE_RE.test(date || '') || !TIME_RE.test(task.startTime || '')) return null;
  const duration = task.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
  return { date, startTime: task.startTime, duration };
}

const titleOf = (task) => String(task?.title ?? '').trim() || 'Untitled';

/**
 * Pure edge finder: what completed, and what was un-completed, between prev
 * and next. `completions` carry everything the record needs except the
 * observation time; `uncompletions` carry the previous key and the source
 * stamp of the uncheck where one exists (recurring), else null.
 */
export function findJoboEdges(prev, next, { tasks, unscheduledTasks, recurringTasks } = {}) {
  const completions = [];
  const uncompletions = [];
  for (const t of [...(tasks || []), ...(unscheduledTasks || [])]) {
    if (!t || t.id == null) continue;
    const id = String(t.id);
    const was = prev.items[id];
    const is = next.items[id];
    if (was === undefined) continue; // first sight
    if (was === false && is !== false) {
      if (typeof is !== 'string') continue; // completed with no stamp: no source event to key on
      completions.push({
        id: completionKey(id, is), taskId: t.id, title: titleOf(t),
        date: civilDateOf(is), planSnapshot: planSnapshotOf(t), completedAt: is,
      });
    } else if (was !== false && is === false) {
      if (typeof was !== 'string') continue; // the completion we saw had no stamp; nothing to target
      uncompletions.push({ id: completionKey(id, was), uncheckedAt: null });
    }
  }
  for (const r of recurringTasks || []) {
    if (!r || r.id == null) continue;
    const id = String(r.id);
    const prevDates = prev.recurring[id];
    if (prevDates === undefined) continue; // first sight of the template
    const nextDates = next.recurring[id] || {};
    for (const [date, stamp] of Object.entries(nextDates)) {
      if (date in prevDates) continue;
      completions.push({
        id: recurringKey(id, date, stamp), taskId: r.id, title: titleOf(r),
        date, planSnapshot: planSnapshotOf(r, date), completedAt: stamp,
      });
    }
    for (const [date, stamp] of Object.entries(prevDates)) {
      if (date in nextDates) continue;
      // The uncheck overwrote this date's stamp with the uncheck time, so the
      // live template carries the source stamp of the un-completion.
      const uncheckedAt = r.completedDatesTimestamps?.[date];
      uncompletions.push({ id: recurringKey(id, date, stamp), uncheckedAt: isStamp(uncheckedAt) ? uncheckedAt : null });
    }
  }
  return { completions, uncompletions };
}

/**
 * The gate around the edge finder, in useCompletionLog's terms. Returns
 * { edges, advanceTo }: `edges` null means nothing to do this render;
 * `advanceTo` null means hold the snapshot. Edges only ever come with a
 * held snapshot, which the caller advances after its write attempt.
 */
export function planJoboTransitions(prev, next, {
  tasks, unscheduledTasks, recurringTasks,
  isRemoteApply = false, enabled = true, loaded = true, writable = true, inFlight = false,
} = {}) {
  if (prev === null) return { edges: null, advanceTo: next };
  if (inFlight) return { edges: null, advanceTo: null };
  // A remote apply HOLDS, never consumes (useCompletionLog's 2026-09-01
  // lesson): local edges inside an apply window would otherwise be lost, and
  // remote-arrived completions are this device's to record too, since the
  // completing device may have the flag off. Convergence handles the double.
  if (isRemoteApply) return { edges: null, advanceTo: null };
  // The flag off CONSUMES: a device with JOBO off does not create records
  // from its own completions, and transitions made while it was off are not
  // retro-created on enable (design doc, invariant 3).
  if (!enabled) return { edges: null, advanceTo: next };
  // Not loaded HOLDS: ensure-present and the uncheck both need the ledger.
  if (!loaded) return { edges: null, advanceTo: null };
  // Read-only CONSUMES: this device cannot write; a device that can will
  // observe the same completion through sync and create the same record.
  if (!writable) return { edges: null, advanceTo: next };
  const edges = findJoboEdges(prev, next, { tasks, unscheduledTasks, recurringTasks });
  if (!edges.completions.length && !edges.uncompletions.length) return { edges: null, advanceTo: next };
  return { edges, advanceTo: null };
}

// The uncheck's updatedAt: the source stamp where the uncheck left one,
// otherwise this device's clock, and in either case later than the record's
// current version or core refuses the edit.
function uncheckVersion(record, uncheckedAt, observedAt) {
  const floor = Date.parse(record.updatedAt);
  for (const candidate of [uncheckedAt, observedAt]) {
    if (isStamp(candidate) && Date.parse(candidate) > floor) return candidate;
  }
  return new Date(floor + 1).toISOString();
}

/**
 * Turn edges into records for the ledger to merge: new Completed attempts
 * (ensure-present against `records`) and Partially completed reassessments of
 * attempts that were un-completed. Records core will not construct (a task
 * with an unusable shape) are skipped with a warning rather than blocking
 * the rest. `updatedAt` of a new record is the completion stamp, the source
 * event, never `observedAt`.
 */
export function buildJoboRecords(edges, records, { observedAt, warn = console.warn } = {}) {
  const current = Array.isArray(records) ? records : [];
  const out = [];
  for (const c of edges?.completions || []) {
    try {
      const next = completeDoAttempt(current, {
        id: c.id, taskId: c.taskId, timing: DO_TIMING.UNTIMED,
        date: c.date, startTime: null, endDate: null, endTime: null,
        title: c.title, planSnapshot: c.planSnapshot,
        createdAt: c.completedAt, updatedAt: c.completedAt, observedAt,
      });
      if (next !== current) out.push(next[next.length - 1]); // absent → created; present → no-op
    } catch (err) {
      warn?.('[jobo] completion not recorded:', c.id, err?.message ?? err);
    }
  }
  for (const u of edges?.uncompletions || []) {
    const record = current.find((r) => r && r.id === u.id);
    // Absent, tombstoned, or already reassessed by the user: nothing to do.
    if (!record || record.deleted || record.progress !== DO_PROGRESS.COMPLETED) continue;
    try {
      out.push(reassessDoProgress(record, DO_PROGRESS.PARTIAL, uncheckVersion(record, u.uncheckedAt, observedAt)));
    } catch (err) {
      warn?.('[jobo] un-completion not recorded:', u.id, err?.message ?? err);
    }
  }
  return out;
}
