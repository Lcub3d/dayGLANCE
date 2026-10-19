// Buckets that failed to load, and the guard that keeps the save pass off them
// (#2138).
//
// An unreadable bucket is NOT an empty one. Before this, a JSON.parse failure
// (or a throw anywhere in the load) was treated as "no data": the app came up
// with empty state, called itself loaded, and the next save pass wrote that
// empty state over the stored copy. One corrupt key took down every key loaded
// after it, permanently for anyone without sync or a backup.
//
// Now the load records each bucket it could not read, together with the raw
// string it found, and every writer that would persist state over that key asks
// `isLoadProtected` first. The protection holds for as long as the key still
// holds that same unreadable string. When something deliberately writes valid
// data there (a sync apply or a backup restore, both of which set state and
// storage together), the raw value has changed and the protection lifts by
// itself, so recovery needs no extra wiring at each of those writers.
//
// Module state on purpose: there is one app instance per page, and the daily
// notes are read in a useState initializer before any hook state exists.

const failures = new Map(); // storage key -> { raw, message }
const listeners = new Set();

const notify = () => {
  for (const listener of listeners) {
    try { listener(); } catch { /* a listener must never break a load */ }
  }
};

const readRaw = (key) => {
  try { return { ok: true, raw: localStorage.getItem(key) }; } catch { return { ok: false, raw: undefined }; }
};

/** Record that `key` could not be read. `raw` is the string found there, if any. */
export function recordLoadFailure(key, error, raw) {
  failures.set(key, { raw, message: error?.message ? String(error.message) : String(error) });
  console.error(`[load] could not read ${key}; it will not be saved over until resolved:`, error);
  notify();
}

/**
 * True while `key` failed to load and still holds the value that failed.
 * A key whose stored value has since been replaced (by a sync apply or a
 * restore) is released here.
 */
export function isLoadProtected(key) {
  const failure = failures.get(key);
  if (!failure) return false;
  const now = readRaw(key);
  // Storage that cannot even be read stays protected: nothing has replaced it.
  if (!now.ok || now.raw === failure.raw) return true;
  failures.delete(key);
  notify();
  return false;
}

/** The buckets currently protected, as `{ key, raw, message }`. */
export function getLoadFailures() {
  return [...failures.keys()]
    .filter(isLoadProtected)
    .map(key => ({ key, ...failures.get(key) }));
}

/**
 * The user chose to give the unreadable data up. Releases every key so the
 * save pass may write current state over it. The caller offers a download
 * first; nothing here keeps a copy.
 */
export function discardLoadFailures() {
  if (failures.size === 0) return;
  failures.clear();
  notify();
}

export function subscribeLoadFailures(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam. */
export function resetLoadFailures() {
  failures.clear();
  listeners.clear();
}
