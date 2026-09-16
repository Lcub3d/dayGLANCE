// The sent-notes journal (report docs/reports/obsidian-linked-note-append.md,
// F3). Device-local, like the bridge outbox: it lives in this device's web
// storage and does not survive a storage purge. What it covers: the body of
// every notes migration this device committed, so text that left the record
// on enqueue can be read back after the intent row was consumed, after a
// server-side loss, or while debugging. Pruned at 30 days. Pure over the
// storage passed in.

export const NOTES_JOURNAL_KEY = 'day-planner-obsidian-notes-sent';
export const NOTES_JOURNAL_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/** {id → {target, body, at}} */
export function readSentNotes(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(NOTES_JOURNAL_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Records one migration's body under the task id, pruning aged entries. */
export function recordSentNotes({ id, target, body }, storage = defaultStorage(), nowMs = Date.now()) {
  const cutoff = nowMs - NOTES_JOURNAL_RETAIN_MS;
  const next = {};
  for (const [k, e] of Object.entries(readSentNotes(storage))) {
    const at = e && typeof e.at === 'string' ? Date.parse(e.at) : NaN;
    if (!Number.isNaN(at) && at >= cutoff) next[k] = e;
  }
  next[String(id)] = { target: String(target ?? ''), body: String(body ?? ''), at: new Date(nowMs).toISOString() };
  try { storage?.setItem(NOTES_JOURNAL_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
