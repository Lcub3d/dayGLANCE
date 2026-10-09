/**
 * Direct Access on the native apps: window.DayGlanceDirectAccess (Android's
 * DirectAccessBridge.kt, iOS's DirectAccessBridge.swift) adapted to the
 * promise-based bridge shape the transport already consumes on Electron
 * (electronAPI.directAccess), so sync/directAccessTransport.js, the hook and
 * the cycle run unchanged on every platform.
 *
 * The native calls are synchronous and answer with JSON text. Android's
 * JavascriptInterface returns real booleans; iOS answers every dgbridge:// call
 * as text, so its booleans arrive as the strings "true"/"false". The adapter
 * accepts both. The one asynchronous step is the folder picker: pickFolder()
 * launches the platform's picker (the Storage Access Framework tree picker,
 * the Files folder picker) and the result is delivered through
 * `window.__dgDirectAccessPicked(statusOrNull)`.
 *
 * Neither platform offers a folder watcher for a picked folder, so `onChanged`
 * is absent; the poll and the foreground kick carry remote changes.
 */

/** Present inside the Android WebView and the iOS shell, never on the web. */
export const isNativeDirectAccessAvailable = () =>
  typeof window !== 'undefined' && !!window.DayGlanceDirectAccess;

const PICK_CALLBACK = '__dgDirectAccessPicked';

/** iOS answers booleans as text; Android as booleans. */
const truthy = (value) => value === true || value === 'true';

/**
 * @param {object} [deps]
 * @param {() => object} [deps.native]  the native bridge object
 * @param {() => object} [deps.win]     where the pick callback is registered
 */
export function createNativeDirectAccessBridge({
  native = () => window.DayGlanceDirectAccess,
  win = () => window,
  // Which shell: Android's bridge offers files by path (`paths`), an iPhone's
  // offers the roster as its own bookmarked file (`users`, a later PR). The
  // iOS proxy answers any method name, so this cannot be felt out at runtime.
  platform = (typeof window !== 'undefined' && window.DayGlanceIOS) ? 'ios' : 'android',
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
    pick: () => launch('pickFolder'),
    // iOS only: a file itself, picked or created (DirectAccessBridge.swift):
    // the snapshot, or with slot 'users' the household roster. Android's
    // bridge has neither method; the call throws and resolves null.
    pickFile: (slot = 'snapshot') => launch('pickFile', slot),
    createFile: (slot = 'snapshot') => launch('createFile', slot),

    disconnect: async () => truthy(native().disconnect()),
    read: async () => parse(native().read()),
    write: async (text) => truthy(native().write(text)),
    deleteFile: async () => truthy(native().deleteSnapshot()),

    // Files by path, relative to the folder and confined to it in the shell
    // (DirectAccessPath.kt). Android only: docs/direct-access-sync.md, Phase 5.
    // The household roster as its own bookmarked file. iOS only: there is no
    // folder to find it in (docs/direct-access-sync.md, Phase 5).
    ...(platform === 'ios' ? {
      users: {
        status: async () => parse(native().usersStatus()),
        read: async () => parse(native().readUsers()) ?? { kind: 'error', error: 'bad answer from the shell' },
        write: async (text) => truthy(native().writeUsers(text)),
        forget: async () => truthy(native().forgetUsers()),
      },
    } : {}),
    ...(platform === 'android' ? {
      paths: {
        list: async (rel) => { const v = parse(native().listFiles(rel)); return Array.isArray(v) ? v : null; },
        read: async (rel) => parse(native().readFile(rel)) ?? { kind: 'error', error: 'bad answer from the shell' },
        write: async (rel, text) => truthy(native().writeFile(rel, text)),
        remove: async (rel) => truthy(native().deleteFileAt(rel)),
        makeDir: async (rel) => truthy(native().makeDir(rel)),
      },
    } : {}),
  };

  function launch(method, ...args) {
    return new Promise((resolve) => {
      const w = win();
      const previous = w[PICK_CALLBACK];
      const handler = (result) => {
        if (w[PICK_CALLBACK] === handler) delete w[PICK_CALLBACK];
        const parsed = parse(result);
        // A failed pick is reported, not swallowed: the shell says what went
        // wrong (no bookmark, no view controller) and the transport carries
        // {error, …} to the card and the diagnostics report.
        if (parsed && typeof parsed === 'object' && parsed.error) console.error('[direct-access] folder pick failed:', parsed);
        resolve(parsed);
      };
      w[PICK_CALLBACK] = handler;
      if (typeof previous === 'function') previous(null);
      try {
        native()[method](...args);
      } catch {
        if (w[PICK_CALLBACK] === handler) delete w[PICK_CALLBACK];
        resolve(null);
      }
    });
  }
}
