// Proposed JOBO merge protocol v2. Deliberately not wired into the v1 picker.
// See docs/jobo-capture-merge.md before using this on a sync transport.
import { createDoRecord, updateDoRecord, tombstoneDoRecord } from './core.js';

const META = '_joboMerge';
const CAPTURE = new Set([
  'id', 'taskId', 'title', 'planSnapshot', 'source', 'createdAt', 'observedAt',
]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// The core validates acyclic JSON before this helper is called. Canonicalize
// nested objects, retain array order, and compare code units, never locale.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function validObservation(value, record) {
  // Reuse core's full timestamp validation without introducing another parser.
  try {
    createDoRecord({ ...record, observedAt: value });
    return true;
  } catch { return false; }
}

function split(record) {
  const validated = createDoRecord(record); // validates and defensively copies
  const capture = Object.create(null), revision = Object.create(null);
  for (const [key, value] of Object.entries(validated)) {
    if (key === META) continue;
    (CAPTURE.has(key) ? capture : revision)[key] = value;
  }
  const revisionKey = canonical(revision);
  let revisionObservedAt = validated.observedAt;
  if (own(validated, META)) {
    const meta = validated[META];
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)
      || canonical(Object.keys(meta).sort()) !== canonical(['revisionKey', 'revisionObservedAt', 'version'])
      || meta.version !== 2 || !validObservation(meta.revisionObservedAt, validated)
      || meta.revisionKey !== revisionKey) {
      throw new TypeError('Invalid or stale JOBO v2 merge metadata; use the v2 edit wrappers');
    }
    revisionObservedAt = meta.revisionObservedAt;
  }
  return { capture, revision, revisionObservedAt };
}

function compose({ capture, revision, revisionObservedAt }) {
  return createDoRecord({
    ...capture, ...revision,
    [META]: { version: 2, revisionObservedAt, revisionKey: canonical(revision) },
  });
}

/** Explicit lossless upgrade of a COMPLETE core record; never invent history. */
export function upgradeCaptureSafeDoRecord(record) {
  return compose(split(record));
}

/** Construct a new v2 row. Reserved merge metadata is not caller input. */
export function createCaptureSafeDoRecord(input) {
  if (input && own(input, META)) throw new TypeError(`${META} is reserved`);
  return upgradeCaptureSafeDoRecord(createDoRecord(input));
}

function earlierCapture(a, b) {
  const ta = Date.parse(a.observedAt), tb = Date.parse(b.observedAt);
  if (ta !== tb) return ta < tb ? a : b;
  return canonical(a) <= canonical(b) ? a : b;
}

function newerRevision(a, b) {
  const ta = Date.parse(a.revision.updatedAt), tb = Date.parse(b.revision.updatedAt);
  if (ta !== tb) return ta > tb ? a : b;
  const oa = Date.parse(a.revisionObservedAt), ob = Date.parse(b.revisionObservedAt);
  if (oa !== ob) return oa < ob ? a : b;
  // Never include the composite capture in this tie-break. Include the raw
  // observation representation so equivalent ISO offsets also converge bytewise.
  const ka = canonical({ observedAt: a.revisionObservedAt, value: a.revision });
  const kb = canonical({ observedAt: b.revisionObservedAt, value: b.revision });
  return ka <= kb ? a : b;
}

/**
 * Product of two independently ranked registers: earliest captured history,
 * latest editable version. May return a NEW COMPOSITE, never one-operand-only.
 * Both operands must be complete core rows, optionally already upgraded to v2.
 */
export function mergeCaptureSafeDoRecords(a, b) {
  if (a == null && b == null) return null;
  if (a == null) return upgradeCaptureSafeDoRecord(b);
  if (b == null) return upgradeCaptureSafeDoRecord(a);
  const left = split(a), right = split(b);
  if (left.capture.id !== right.capture.id) throw new TypeError('Expected the same Do id');
  const winner = newerRevision(left, right);
  return compose({
    capture: earlierCapture(left.capture, right.capture),
    revision: winner.revision,
    revisionObservedAt: winner.revisionObservedAt,
  });
}

function edit(record, operation) {
  const before = split(record);
  const prepared = compose(before);
  const next = operation(prepared);
  if (next === prepared) return prepared;
  // The existing core preserves opaque fields, including the OLD merge key.
  // Remove it deliberately, then attach the revised value to the same lineage.
  const withoutMeta = { ...next };
  delete withoutMeta[META];
  const after = split(withoutMeta);
  return compose({ ...after, revisionObservedAt: before.revisionObservedAt });
}

/** An explicit local edit with the core's same allowed fields/time rules. */
export function updateCaptureSafeDoRecord(record, patch, updatedAt) {
  return edit(record, row => updateDoRecord(row, patch, updatedAt));
}

/** Retained tombstone, with the core's timestamp and no-resurrection rules. */
export function tombstoneCaptureSafeDoRecord(record, updatedAt) {
  return edit(record, row => tombstoneDoRecord(row, updatedAt));
}
