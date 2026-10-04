/**
 * Direct Access on Android: window.DayGlanceDirectAccess (DirectAccessBridge.kt)
 * adapted to the promise-based bridge shape the transport already consumes on
 * Electron (electronAPI.directAccess), so sync/directAccessTransport.js, the
 * hook and the cycle run unchanged.
 *
 * The native calls are synchronous JavascriptInterface methods returning JSON
 * text. The one asynchronous step is the folder picker: pickFolder() launches
 * the Storage Access Framework tree picker and MainActivity delivers the
 * result through `window.__dgDirectAccessPicked(statusOrNull)`.
 *
 * There is no folder watcher on SAF content URIs, so `onChanged` is absent;
 * the poll and the foreground kick cover remote changes.
 */

/** Present only inside the Android WebView; iOS never defines this object. */
export const isAndroidDirectAccessAvailable = () =>
  typeof window !== 'undefined' && !!window.DayGlanceDirectAccess && !window.DayGlanceIOS;

const PICK_CALLBACK = '__dgDirectAccessPicked';

/**
 * @param {object} [deps]
 * @param {() => object} [deps.native]  the Kotlin bridge object
 * @param {() => object} [deps.win]     where the pick callback is registered
 */
export function createAndroidDirectAccessBridge({
  native = () => window.DayGlanceDirectAccess,
  win = () => window,
} = {}) {
  const parse = (value) => {
    if (value == null) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
  };

  return {
    restore: async () => parse(native().status()),
    status: async () => parse(native().status()),

    // Resolves with the new status, or null when the picker was cancelled or
    // could not be launched. One pick at a time: a second call before the
    // first resolves replaces its callback, and the earlier promise settles
    // null when the result finally arrives for the later one.
    pick: () => new Promise((resolve) => {
      const w = win();
      const previous = w[PICK_CALLBACK];
      w[PICK_CALLBACK] = (result) => {
        if (w[PICK_CALLBACK] === handler) delete w[PICK_CALLBACK];
        resolve(parse(result));
      };
      const handler = w[PICK_CALLBACK];
      if (typeof previous === 'function') previous(null);
      try {
        native().pickFolder();
      } catch {
        if (w[PICK_CALLBACK] === handler) delete w[PICK_CALLBACK];
        resolve(null);
      }
    }),

    disconnect: async () => native().disconnect() === true,
    read: async () => parse(native().read()),
    write: async (text) => native().write(text) === true,
    deleteFile: async () => native().deleteSnapshot() === true,
  };
}
