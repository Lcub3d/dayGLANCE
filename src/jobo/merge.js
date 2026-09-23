// Deterministic JOBO record convergence.
// Merge remains schema-agnostic and does not reconstruct records.

import { plain, canonicalJson } from './internal/json.js';
import { validStamp } from './intervals.js';

function versionTime(value) {
  const time = typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).getTime()
    : validStamp(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

export function pickJoboRecord(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  if (!plain(a) || !plain(b) || a.id == null || b.id == null || String(a.id) !== String(b.id)) {
    throw new TypeError('pickJoboRecord requires two copies of the same id');
  }
  const ua = versionTime(a.updatedAt), ub = versionTime(b.updatedAt);
  if (ua !== ub) return ua > ub ? a : b;
  const oa = versionTime(a.observedAt), ob = versionTime(b.observedAt);
  if (oa !== ob) return oa < ob ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}
