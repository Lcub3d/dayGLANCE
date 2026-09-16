// THE RE-APPEND (owner ruling, 2026-09-16; companion spec §4.3, buildout
// 2.8 addendum). Pure.
//
// A task's line can leave a linked note without the task leaving the app:
// the note-scoped deletion inference tombstones the task at the note's
// mtime, and the tombstone channel is last-writer-wins, so a record edited
// after that mtime keeps the task (§3.10 ruling 6: existence follows the
// newer side). Until this ruling that was a dead end for a project task:
// it said it was home, so placement never wrote it, and the ordinary write
// path treats a missing line as something the next scan reconciles. The
// 2026-09-13 merge wipe of a project note left six open tasks in exactly
// that state for three days.
//
// The rule now: a task that survives the existence rule because its record
// is newer than the note has its line re-appended on the next pass. The
// record won existence, so the vault reflects it. What this is NOT: a
// change to what wins. A task whose record is older than the wipe follows
// the vault and is dropped, as before. Open tasks only, like placement.
//
// Once per tombstone stamp: the stamp is the note mtime at which the line
// was confirmed absent, and a device remembers the stamps it has acted on,
// so an append that already landed is not emitted again each pass (the
// applier's append is idempotent, but an intent per pass would be churn).
// A later wipe stamps a newer tombstone and fires again.

import { isObsidianTombstoned } from './obsidianDeletions.js';

export const LINE_REAPPENDS_STORAGE_KEY = 'day-planner-obsidian-line-reappends';

/**
 * The tombstone stamp a re-append should act on, or null.
 *
 * @param {object} task  an app task
 * @param {Record<string,string>} tombstones  deletedObsidianKeys {id → ISO}
 * @returns {string|null}
 */
export function lineReappendStamp(task, tombstones) {
  if (!task || task.importSource !== 'obsidian' || !task.obsidianBlockId || !task.obsidianNotePath) return null;
  if (task.completed || task.archived || task.recurrence || task.recurringTemplateId) return null;
  const id = String(task.id);
  const stamp = tombstones && typeof tombstones === 'object' ? tombstones[id] : undefined;
  if (typeof stamp !== 'string' || !stamp) return null;
  // The tombstone at least as new as the record: the task is leaving, not returning.
  if (isObsidianTombstoned(tombstones, id, task.lastModified)) return null;
  return stamp;
}

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/** The stamps this device has already re-appended for: {id → stamp}. */
export function readLineReappends(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(LINE_REAPPENDS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Persist the acted-on stamps, keeping only entries whose tombstone still
 * carries that exact stamp (a pruned or renewed tombstone frees the entry).
 */
export function writeLineReappends(acted, tombstones, storage = defaultStorage()) {
  const next = {};
  for (const [id, stamp] of Object.entries(acted || {})) {
    if (tombstones && tombstones[id] === stamp) next[id] = stamp;
  }
  try {
    if (!storage) return next;
    if (Object.keys(next).length === 0) storage.removeItem(LINE_REAPPENDS_STORAGE_KEY);
    else storage.setItem(LINE_REAPPENDS_STORAGE_KEY, JSON.stringify(next));
  } catch { /* storage unavailable: the worst case is one extra idempotent append */ }
  return next;
}
