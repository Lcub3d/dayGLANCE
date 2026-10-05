/**
 * Compares what a snapshot-file sync cycle would write and apply against what
 * is already there, slice by slice.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-10-05 every Mac in a fleet was seen rewriting dayglance-sync.json on
 * every cycle: each diagnostics report showed the file modified ~30 ms after
 * the cycle's read, with nothing changed on any device. Every such write made
 * the phone's copy non-current, the phone then waited minutes for the download,
 * and edits made on the phone in that window reached nobody.
 *
 * The cause was a collision of two correct rules. The iCloud write strips
 * HealthKit-derived habit counts from the file (Apple guideline 5.1.3,
 * utils/healthLogFilter.js), while the Macs hold those counts locally because
 * they arrive through GLANCEvault. So every merge saw 214 days of counts the
 * file lacked, raised `remoteChanged`, wrote a stripped file identical to the
 * one already there, and did it again next cycle. The merge's change flags
 * answer "did the merge pick anything from local?", not "would the file
 * change?", and only the second question should start a write.
 *
 * So the cycle now asks both: a write needs a flag AND a real difference
 * between the outgoing (stripped) data and the file; an apply needs a flag AND
 * a real difference between the merged data and local state. This module is
 * that comparison, and the diagnostics panel runs the identical function so
 * what it reports is what the cycle decides.
 *
 * Comparison rules: arrays of ids are matched by id with order noted
 * separately, scalar lists compare as sets, maps by entry, everything else by
 * canonical JSON. Absent and empty slices are equal, and so are absent and
 * empty entries inside a map. Slices the merge
 * re-stamps on every run (the tombstone fence) are ignored. For the apply
 * question, slices the merge output simply does not carry are ignored too:
 * applyEngineData leaves absent keys alone.
 *
 * Pure: no React, no storage, no bridge.
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

  // Maps keyed by something (habitLogs, dailyNotes, dayWindows…): say how many.
  // An empty entry and an absent one are the same thing here too: the HealthKit
  // strip leaves a day whose only count it removed as `{}`, and the file may
  // hold that day or not depending on which device last wrote it.
  if (merged && other && typeof merged === 'object' && typeof other === 'object' && !Array.isArray(merged) && !Array.isArray(other)) {
    const keys = new Set([...Object.keys(merged), ...Object.keys(other)]);
    let n = 0;
    for (const k of keys) {
      if (isEmptyish(merged[k]) && isEmptyish(other[k])) continue;
      if (canonicalJson(merged[k]) !== canonicalJson(other[k])) n += 1;
    }
    if (n === 0) return null;
    return { key, kind: 'map', summary: `${key}: ${n} of ${keys.size} entries differ` };
  }
  return { key, kind: 'value', summary: `${key}: differs` };
}

/**
 * Every slice in which `a` differs from `b`.
 *
 * @param {object} a    the data about to be written or applied
 * @param {object} b    the data already there (file, or local state)
 * @param {{ignoreDropped?: boolean}} [opts]  skip slices `a` does not carry
 *        at all (for the apply question: absent keys are left alone)
 * @returns {Array<{key: string, kind: string, summary: string}>}
 */
export function sliceDiffs(a, b, { ignoreDropped = false } = {}) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  const out = [];
  for (const k of keys) {
    if (ignoreDropped && a?.[k] === undefined) continue;
    const d = describeSliceDiff(k, a?.[k], b?.[k]);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Runs the merge and explains its outcome, with the write and apply decisions
 * the cycle makes from it.
 *
 * @param {object} args
 * @param {object} args.local          this device's payload `data` (buildSyncPayload().data)
 * @param {object} args.remote         the file's `data`
 * @param {number} args.retentionDays
 * @param {(local, remote, retentionDays) => {data: object, localChanged: boolean, remoteChanged: boolean}} args.merge
 * @param {(data: object) => object} [args.outgoing]  what the transport would
 *        actually write (the iCloud HealthKit strip); identity by default
 * @returns {{
 *   localChanged: boolean, remoteChanged: boolean,   the merge's own flags
 *   fileDiffs: Array<{key, kind, summary}>,          outgoing vs file
 *   deviceDiffs: Array<{key, kind, summary}>,        merged vs local (dropped slices ignored)
 *   wouldWrite: boolean,                             a flag AND a file difference
 *   wouldApply: boolean,                             localChanged AND a device difference
 *   flagWithoutDiff: boolean,                        a write flag with no file difference
 *   error: string|null,
 * }}
 */
export function explainSnapshotMerge({ local, remote, retentionDays, merge, outgoing = (d) => d }) {
  const empty = {
    localChanged: false, remoteChanged: false, fileDiffs: [], deviceDiffs: [],
    wouldWrite: false, wouldApply: false, flagWithoutDiff: false, error: null,
  };
  let result;
  try {
    result = merge(local, remote, retentionDays);
  } catch (err) {
    return { ...empty, error: err?.message ?? String(err) };
  }
  const merged = result?.data ?? {};
  const localChanged = !!result?.localChanged;
  const remoteChanged = !!result?.remoteChanged;
  let out;
  try { out = outgoing(merged) ?? merged; } catch (err) { return { ...empty, localChanged, remoteChanged, error: err?.message ?? String(err) }; }
  const fileDiffs = sliceDiffs(out, remote);
  const deviceDiffs = sliceDiffs(merged, local, { ignoreDropped: true });
  const flagged = remoteChanged || localChanged;
  return {
    localChanged,
    remoteChanged,
    fileDiffs,
    deviceDiffs,
    wouldWrite: flagged && fileDiffs.length > 0,
    wouldApply: localChanged && deviceDiffs.length > 0,
    flagWithoutDiff: flagged && fileDiffs.length === 0,
    error: null,
  };
}
