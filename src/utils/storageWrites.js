// Writes that can fail, and the persistent record of the ones that did (#2139).
//
// localStorage throws when it is at its quota. Bare `setItem` calls let that
// throw escape: from an effect it reached the app-wide ErrorBoundary (the
// "Something went wrong" screen), from an event handler it aborted the action
// halfway through, and the save pass's one transient toast was the only sign
// that writes had stopped landing. `writeItem` never throws. It reports
// whether the write landed and, when the store is full, records the key so a
// persistent banner can say so until a later write of that key succeeds.
//
// Use it for anything the app reads back. A write whose failure must stop an
// action (a tombstone written before the deletion it licenses) checks the
// return value and aborts.

const failed = new Set(); // keys whose last write hit the quota
const listeners = new Set();

const notify = () => {
  for (const listener of listeners) {
    try { listener(); } catch { /* a listener must never break a write */ }
  }
};

export const isQuotaError = (error) =>
  !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22);

/** Write `value` under `key`. Returns true when it landed; never throws. */
export function writeItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`[storage] could not write ${key}:`, error);
    if (isQuotaError(error) && !failed.has(key)) {
      failed.add(key);
      notify();
    }
    return false;
  }
  if (failed.delete(key)) notify();
  return true;
}

/** Keys whose most recent write was rejected for lack of space. */
export function getWriteFailures() {
  return [...failed];
}

export function subscribeWriteFailures(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam. */
export function resetWriteFailures() {
  failed.clear();
  listeners.clear();
}
