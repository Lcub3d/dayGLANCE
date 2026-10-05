/**
 * Explains what a snapshot-file sync cycle would do, without doing it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-10-05 an idle Mac was seen rewriting dayglance-sync.json on every
 * cycle: each diagnostics report showed the file modified ~30 ms after the
 * cycle's read, with nothing changed on any device. Every such write made the
 * phone's copy non-current, the phone then waited minutes for the download, and
 * edits made on the phone in that window reached nobody. The write decision is
 * taken from the merge's `remoteChanged` flag, which a dozen places in
 * mergeSync.js can raise, several of them already annotated with past churn
 * incidents. Timestamps alone could not say which one was firing.
 *
 * This module runs the same merge the cycle runs (local state against the file)
 * and reports two things side by side:
 *
 *   • the flags the merge raised (`localChanged` → the apply, `remoteChanged` →
 *     the write), which is what the cycle actually acts on;
 *   • per top-level slice, whether the merge OUTPUT really differs from the file
 *     (and from local state), compared by content with arrays of ids matched by
 *     id and order noted separately.
 *
 * A flag raised with no slice differing is a change-flag bug (an identity
 * comparison, a per-device value overriding the result); a slice that differs
 * on every run with nothing edited is a value that cannot converge. Either way
 * the report names it.
 *
 * Pure: no React, no storage, no bridge. The merge is injected so this stays
 * testable and so the diagnostics panel and a test can run the identical code.
 */

/** JSON with object keys sorted at every level, so equal content compares equal. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

const isIdList = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && x.id !== undefined);
const isPrimitiveList = (v) =>
  Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');

/**
 * Slices the merge re-stamps on every run by design, so they differ from the
 * file on every cycle without meaning anything. `tombstonePrunedBefore` is the
 * fixed 60-day tombstone fence, recomputed from the clock each merge
 * (mergeSync.js). The write decision never reads them; neither does this report.
 */
export const PER_MERGE_STAMPS = ['tombstonePrunedBefore'];

/** An absent slice and an empty one are the same thing to every consumer. */
const isEmptyish = (v) =>
  v === undefined || v === null
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Describes how `merged` differs from `other` for one slice, or null when it
 * does not. `other` is the file for the write question, local state for the
 * apply question.
 *
 * @returns {null | {key: string, kind: string, summary: string}}
 */
export function describeSliceDiff(key, merged, other) {
  if (PER_MERGE_STAMPS.includes(key)) return null;
  if (isEmptyish(merged) && isEmptyish(other)) return null;
  const mergedMissing = merged === undefined;
  const otherMissing = other === undefined;
  if (mergedMissing && otherMissing) return null;
  if (otherMissing) return { key, kind: 'added', summary: `${key}: added` };
  if (mergedMissing) return { key, kind: 'dropped', summary: `${key}: dropped` };

  // Collections of ids: match by id so an order change is reported as what it
  // is rather than as every item differing.
  if ((isIdList(merged) || isIdList(other)) && Array.isArray(merged) && Array.isArray(other)) {
    const byId = (list) => new Map(list.filter((x) => x && x.id !== undefined).map((x) => [String(x.id), x]));
    const m = byId(merged);
    const o = byId(other);
    let changed = 0;
    let onlyMerged = 0;
    let onlyOther = 0;
    const changedIds = [];
    for (const [id, item] of m) {
      if (!o.has(id)) { onlyMerged += 1; continue; }
      if (canonicalJson(item) !== canonicalJson(o.get(id))) {
        changed += 1;
        if (changedIds.length < 5) changedIds.push(id);
      }
    }
    for (const id of o.keys()) if (!m.has(id)) onlyOther += 1;
    const orderDiffers = changed === 0 && onlyMerged === 0 && onlyOther === 0
      && merged.map((x) => String(x?.id)).join('\u0000') !== other.map((x) => String(x?.id)).join('\u0000');
    if (!changed && !onlyMerged && !onlyOther && !orderDiffers) return null;
    const parts = [];
    if (changed) parts.push(`${changed} changed${changedIds.length ? ` (${changedIds.join(', ')}${changed > changedIds.length ? ', …' : ''})` : ''}`);
    if (onlyMerged) parts.push(`+${onlyMerged} only in result`);
    if (onlyOther) parts.push(`-${onlyOther} only on other side`);
    if (orderDiffers) parts.push('order differs');
    return { key, kind: orderDiffers && parts.length === 1 ? 'order' : 'items', summary: `${key}: ${parts.join(', ')}` };
  }

  // Lists of scalars (completedTaskUids and the like): set arithmetic.
  if (isPrimitiveList(merged) && isPrimitiveList(other)) {
    const m = new Set(merged.map(canonicalJson));
    const o = new Set(other.map(canonicalJson));
    let plus = 0;
    let minus = 0;
    for (const v of m) if (!o.has(v)) plus += 1;
    for (const v of o) if (!m.has(v)) minus += 1;
    if (!plus && !minus) {
      if (merged.length !== other.length) return { key, kind: 'duplicates', summary: `${key}: same set, ${merged.length} vs ${other.length} entries` };
      return null;
    }
    return { key, kind: 'set', summary: `${key}: +${plus} / -${minus}` };
  }

  if (canonicalJson(merged) === canonicalJson(other)) return null;

  // Maps keyed by something (habitLogs, dailyNotes, dayWindows…): say how many keys.
  if (merged && other && typeof merged === 'object' && typeof other === 'object' && !Array.isArray(merged) && !Array.isArray(other)) {
    const keys = new Set([...Object.keys(merged), ...Object.keys(other)]);
    let n = 0;
    for (const k of keys) if (canonicalJson(merged[k]) !== canonicalJson(other[k])) n += 1;
    return { key, kind: 'map', summary: `${key}: ${n} of ${keys.size} entries differ` };
  }
  return { key, kind: 'value', summary: `${key}: differs` };
}

/**
 * Runs the merge and explains its outcome.
 *
 * @param {object} args
 * @param {object} args.local          this device's payload `data` (buildSyncPayload().data)
 * @param {object} args.remote         the file's `data`
 * @param {number} args.retentionDays
 * @param {(local, remote, retentionDays) => {data: object, localChanged: boolean, remoteChanged: boolean}} args.merge
 * @returns {{
 *   localChanged: boolean, remoteChanged: boolean,
 *   fileDiffs: Array<{key, kind, summary}>,    merged vs file  (what a write would change)
 *   deviceDiffs: Array<{key, kind, summary}>,  merged vs local (what an apply would change)
 *   flagWithoutDiff: boolean,                  remoteChanged raised but nothing differs from the file
 *   error: string|null,
 * }}
 */
export function explainSnapshotMerge({ local, remote, retentionDays, merge }) {
  let result;
  try {
    result = merge(local, remote, retentionDays);
  } catch (err) {
    return {
      localChanged: false, remoteChanged: false, fileDiffs: [], deviceDiffs: [],
      flagWithoutDiff: false, error: err?.message ?? String(err),
    };
  }
  const merged = result?.data ?? {};
  const keys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  const fileDiffs = keys(merged, remote).map((k) => describeSliceDiff(k, merged[k], remote?.[k])).filter(Boolean);
  const deviceDiffs = keys(merged, local).map((k) => describeSliceDiff(k, merged[k], local?.[k])).filter(Boolean);
  return {
    localChanged: !!result?.localChanged,
    remoteChanged: !!result?.remoteChanged,
    fileDiffs,
    deviceDiffs,
    flagWithoutDiff: !!result?.remoteChanged && fileDiffs.length === 0,
    error: null,
  };
}
