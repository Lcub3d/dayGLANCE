// Undo and redo of Do edits made in the JOBO view (#1726). Pure: the hook
// hands in the records and the clock, and writes the result through
// recordJobo like any other edit.
//
// An undo is a fresh edit, never a rollback. It writes the earlier content
// back under the same id with an updatedAt strictly newer than the current
// version, so it wins in both sync tiers by the ordinary pick. That includes
// bringing a deleted record back over its tombstone, which is the one way a
// tombstone is ever superseded, and only by an explicit undo.
//
// Two guards, both from the ledger's side of the contract:
//   - The current winner must still be the version the step left behind.
//     Anything newer (another device, a detector write, a later edit) means
//     the step is stale, and it reports a conflict instead of overwriting.
//   - It moves a record into Completed only where core allows Completed
//     (#1867's canCompleteDo): an unlinked manual Do, or a completion record
//     whose task or occurrence is still completed. Anything else is refused
//     rather than written.
import { canCompleteDo, createDoRecord, pickJoboRecord, DO_PROGRESS } from './core.js';

// Same content, key order aside. The view writer has the same check; this
// module stays free of React.
const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value);
const sameRecord = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * One undoable step: the record as it was (null for a Do the step created)
 * and as the step wrote it. `expect` is the version the ledger should hold
 * now; each successful undo or redo moves it to what that write left.
 */
export function joboUndoEntry(before, after) {
  if (!after?.id) throw new TypeError('An undo step needs the written record');
  return { id: after.id, before: before ?? null, after, expect: after };
}

/** Whether writing `target` over `current` would make the record Completed. */
export function movesIntoCompleted(current, target) {
  return !target.deleted && target.progress === DO_PROGRESS.COMPLETED
    && current.progress !== DO_PROGRESS.COMPLETED;
}

/**
 * What an undo (or redo) of `entry` should write, given the records as they
 * stand. Returns `{ record }`, or `{ conflict: true }` when the record has
 * moved on, or `{ blocked: 'completion' }` when the step would make it
 * Completed where core does not allow it. `isTaskCompleted(record)` reports
 * whether the record's task or occurrence is completed now; it is asked only
 * when the step would restore Completed.
 */
export function planJoboUndo(entry, direction, records, now, { isTaskCompleted = () => false } = {}) {
  if (direction !== 'undo' && direction !== 'redo') throw new TypeError('direction must be undo or redo');
  const copies = (Array.isArray(records) ? records : []).filter((row) => row?.id === entry.id);
  const current = copies.reduce((winner, row) => pickJoboRecord(winner, row), null);
  if (!current || !sameRecord(current, entry.expect)) return { conflict: true };
  // Undoing a creation deletes what it created; everything else writes back
  // the other side's content.
  const target = direction === 'undo'
    ? (entry.before ?? { ...entry.after, deleted: true })
    : entry.after;
  if (movesIntoCompleted(current, target)
    && !canCompleteDo(target, { taskCompleted: isTaskCompleted(target) === true })) return { blocked: 'completion' };
  const version = Math.max(now, Date.parse(current.updatedAt) + 1);
  return { record: createDoRecord({ ...target, updatedAt: new Date(version).toISOString() }) };
}
