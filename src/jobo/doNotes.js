// Experimental notes adapter for independent (unlinked) Do records.
//
// This module deliberately stays above slice 2's record rules.  Notes are an
// opaque extension on a canonical record; the ledger remains the only writer.
// A caller passes the record it opened for editing and the current collection,
// then commits the returned record through recordJobo/ledger.commit().

import { createDoRecord, pickJoboRecord, validateDoRecord } from './core.js';

const EDITABLE_SCHEDULE_FIELDS = new Set([
  'timing', 'date', 'startTime', 'endDate', 'endTime', 'progress', 'updatedAt', 'notes',
]);

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function plain(value) {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if ((!plain(value) && !Array.isArray(value)) || ancestors.has(value)) {
    throw new TypeError('Do note data must contain only acyclic JSON data');
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => canonicalJson(entry, ancestors)).join(',')}]`;
  } else {
    result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(',')}}`;
  }
  ancestors.delete(value);
  return result;
}

function assertRecord(record, label = 'record', { validateNotes = true } = {}) {
  if (!plain(record)) throw new TypeError(`${label} must be a plain object`);
  const result = validateDoRecord(record);
  if (!result.ok) throw new TypeError(`Invalid ${label}: ${result.errors.join('; ')}`);
  if (validateNotes && own(record, 'notes') && typeof record.notes !== 'string') {
    throw new TypeError(`${label}.notes must be a string when supplied`);
  }
  // validateDoRecord already checks this, but the explicit call makes opaque
  // extension validation part of this adapter's public boundary too.
  canonicalJson(record);
  return record;
}

function assertRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
}

function independentLive(record) {
  return record.taskId === null && record.deleted === false;
}

function notesValue(record) {
  return own(record, 'notes') ? record.notes : '';
}

function epochFromNow(now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('now must be an epoch millisecond number');
  }
  const epoch = new Date(now).getTime();
  if (!Number.isFinite(epoch) || !Number.isSafeInteger(epoch)) {
    throw new RangeError('now is outside the supported date range');
  }
  return epoch;
}

function monotonicUpdatedAt(record, now) {
  const previous = Date.parse(record.updatedAt);
  if (!Number.isFinite(previous)) throw new TypeError('record.updatedAt must be a valid timestamp');
  const requested = epochFromNow(now);
  const next = Math.max(requested, previous + 1);
  if (!Number.isSafeInteger(next) || !Number.isFinite(next)) {
    throw new RangeError('record version is outside the supported date range');
  }
  return new Date(next).toISOString();
}

function sameValue(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

// If a malformed caller passes two copies of one id, use the same deterministic
// winner as both ledger sync tiers. This keeps note edits from depending on
// array order after a restore or a merge.
function currentRecord(records, id) {
  let current = null;
  for (const [index, candidate] of records.entries()) {
    if (!plain(candidate) || String(candidate.id) !== String(id)) continue;
    assertRecord(candidate, `records[${index}]`, { validateNotes: false });
    current = current === null ? candidate : pickJoboRecord(current, candidate);
  }
  return current;
}

/**
 * Return the independent Do's note text. Linked and deleted Do records are
 * deliberately presented as having no independently editable notes.
 */
export function doNotesText(record) {
  assertRecord(record, 'record', { validateNotes: false });
  if (!independentLive(record)) return '';
  if (own(record, 'notes') && typeof record.notes !== 'string') {
    throw new TypeError('record.notes must be a string when supplied');
  }
  return notesValue(record);
}

/**
 * Prepare one optimistic-safe notes edit.
 *
 * The `record` argument is the version the editor opened. `records` is the
 * latest canonical projection. A newer copy may be reused only when every
 * change since the opened version is a timing/progress change (plus its
 * version stamp) and the note text is unchanged. A note edit/deletion, a
 * tombstone, or any identity/capture/opaque-field change returns null.
 *
 * The returned record is ready for the normal ledger writer. A no-op returns
 * the current canonical record so callers can skip the write by reference or
 * by comparing its note text; null means stale or ineligible.
 */
export function prepareDoNotesEdit({ records, record, text, now } = {}) {
  assertRecords(records);
  assertRecord(record, 'record', { validateNotes: false });
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!independentLive(record)) return null;
  if (own(record, 'notes') && typeof record.notes !== 'string') {
    throw new TypeError('record.notes must be a string when supplied');
  }

  const current = currentRecord(records, record.id);
  if (!current || !independentLive(current)) return null;
  if (own(current, 'notes') && typeof current.notes !== 'string') {
    throw new TypeError('current independent Do notes must be a string when supplied');
  }
  const openedNotes = notesValue(record);
  const currentNotes = notesValue(current);
  if (currentNotes !== openedNotes) return null;

  // Allow the current projection to carry an interval or progress update from
  // another writer. Every other difference is a concurrent edit that must be
  // surfaced to the UI instead of being silently overwritten.
  const keys = new Set([...Object.keys(record), ...Object.keys(current)]);
  for (const key of keys) {
    if (key === 'notes') continue;
    if (!own(record, key) || !own(current, key)) return null;
    if (sameValue(record[key], current[key])) continue;
    if (!EDITABLE_SCHEDULE_FIELDS.has(key)) return null;
  }

  if (text === currentNotes) return current;
  const updatedAt = monotonicUpdatedAt(current, now);
  return createDoRecord({ ...current, notes: text, updatedAt });
}

export const __doNotesInternals = Object.freeze({
  independentLive,
  monotonicUpdatedAt,
});
