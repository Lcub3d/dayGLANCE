// THE DELIVERY CHECK (2026-09-29, the safety net). Pure.
//
// Whatever the cause, the symptom of the pairing split was one thing: this
// device's intents sat in GLANCEvault, unconsumed, while some copy of the
// vault was applying. The other guards name causes (a stale pairing, a held
// count); this one watches the effect, so it also covers causes nobody has
// met yet. The stream module remembers the ids it sent for a few hours; on
// a schedule, the sync cycle probes the oldest ones that have waited longer
// than DELIVERY_WAIT_MS. A row that is gone was consumed. A row still there
// while the applier lease is live means something is applying and not
// applying this device's changes, and the device says so. No live lease is
// the neutral waiting state phones live in (no Obsidian open anywhere), not
// an alarm.
//
// Cost: at most one lease read and DELIVERY_PROBES_PER_CHECK row reads per
// DELIVERY_CHECK_EVERY_MS, and only while an old unconsumed id exists.

export const SENT_INTENTS_KEY = 'dayglance-bridge-sent';
export const DELIVERY_STATE_KEY = 'dayglance-bridge-delivery';
export const DELIVERY_WAIT_MS = 10 * 60 * 1000;
export const DELIVERY_CHECK_EVERY_MS = 10 * 60 * 1000;
export const SENT_RETAIN_MS = 6 * 60 * 60 * 1000;
export const SENT_CAP = 200;
export const DELIVERY_PROBES_PER_CHECK = 5;

const ts = (s) => Date.parse(String(s ?? '')) || 0;

/** Drop entries older than the retention, and the oldest beyond the cap. */
export function pruneSentIntents(sent, nowMs = Date.now()) {
  const entries = Object.entries(sent && typeof sent === 'object' ? sent : {})
    .filter(([, at]) => nowMs - ts(at) <= SENT_RETAIN_MS)
    .sort((a, b) => ts(a[1]) - ts(b[1]));
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - SENT_CAP)));
}

/** Remember ids acknowledged by the vault at `nowMs`. */
export function recordSentIntents(sent, ids, nowMs = Date.now()) {
  const at = new Date(nowMs).toISOString();
  const next = { ...(sent && typeof sent === 'object' ? sent : {}) };
  for (const id of ids || []) if (id) next[String(id)] = at;
  return pruneSentIntents(next, nowMs);
}

/**
 * Which ids to probe now: none unless a check is due and some id has
 * waited longer than DELIVERY_WAIT_MS; then the oldest few.
 * @returns {{ due: boolean, ids: string[] }}
 */
export function selectDeliveryProbes(sent, nowMs = Date.now(), lastCheckMs = 0) {
  const old = Object.entries(sent && typeof sent === 'object' ? sent : {})
    .filter(([, at]) => nowMs - ts(at) >= DELIVERY_WAIT_MS)
    .sort((a, b) => ts(a[1]) - ts(b[1]))
    .map(([id]) => id);
  if (old.length === 0) return { due: false, ids: [] };
  if (nowMs - (Number(lastCheckMs) || 0) < DELIVERY_CHECK_EVERY_MS) return { due: false, ids: [] };
  return { due: true, ids: old.slice(0, DELIVERY_PROBES_PER_CHECK) };
}

/**
 * The verdict over a probe's results.
 * @param {{ present: string[], leaseUntilMs: number|null, nowMs?: number }} a
 *   present: probed ids whose row is still live; leaseUntilMs: the applier
 *   lease's expiry, null when no lease row exists
 * @returns {{ waiting: number, leaseLive: boolean, alarm: boolean }}
 */
export function deliveryVerdict({ present, leaseUntilMs, nowMs = Date.now() }) {
  const waiting = (present || []).length;
  const leaseLive = Number.isFinite(leaseUntilMs) && leaseUntilMs > nowMs;
  return { waiting, leaseLive, alarm: leaseLive && waiting > 0 };
}
