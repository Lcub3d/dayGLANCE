// The launcher heartbeat (docs/launcher-integration.md, "Freshness"): what the
// app writes beside its snapshot so the GLANCElauncher can measure staleness
// from the last CONFIRMATION rather than the last change. The snapshot is
// pushed only when its content changes, so its stamp says when something last
// moved; `checkedAt` says when the app last looked, and `syncedAt` when a sync
// tier last completed a cycle, which is the moment other devices' changes are
// known to be in.

/** The latest of several ISO stamps (null and malformed values ignored), or null. */
export function latestSyncedAt(...stamps) {
  let best = null;
  for (const s of stamps) {
    if (typeof s !== 'string' || !s) continue;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** The refresh outcomes the app records (the launcher's diagnostics read them). */
export const REFRESH_OUTCOMES = Object.freeze({
  /** The receiver queued it for the live renderer. */
  QUEUED: 'queued',
  /** Dropped: another refresh was already in flight. */
  COALESCED: 'coalesced',
  /** The app was not running and nothing could run it (yet). */
  DEFERRED: 'deferred',
  /** The sync cycle ran and the snapshot was pushed. */
  RAN: 'ran',
  /** The sync cycle threw; `reason` says why. */
  FAILED: 'failed',
});
