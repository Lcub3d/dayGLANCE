/**
 * Direct Access as a snapshot-file transport (sync/snapshotFileSync.js).
 *
 * The user picks a folder that a third-party tool already keeps in step across
 * devices (Google Drive for desktop, Dropbox, OneDrive, Syncthing, a network
 * share). dayGLANCE reads and writes dayglance-sync.json in it; the tool moves
 * it. The cycle, the merge and every data-safety guard are the ones iCloud
 * uses (docs/direct-access-sync.md); this module is the bridge to the Electron
 * main process (electron/directAccess.ts), which holds the folder, plus the
 * small state machine the settings panel renders.
 *
 * Differences from the iCloud transport, each deliberate:
 *
 *   • OFF until a folder is picked. There is no entitlement to come back on by
 *     itself, so there is no tri-state preference and no first-run prompt:
 *     picking the folder IS the decision, and the snapshot in it is applied.
 *   • `allowsPlaintextReseed` is false. The folder is someone else's cloud; an
 *     encrypted file this device cannot read is left exactly as it is.
 *   • A longer write throttle: third-party tools round-trip slower than the
 *     iCloud daemon, and each write inside that window risks a conflict copy.
 *   • An unreachable folder (the streaming tool not running, a share not
 *     mounted) is reported once and then waited out quietly: the transport
 *     marks itself unreachable, the hook stops cycling, and each poll tick
 *     re-probes the folder so sync resumes by itself when it is back.
 *
 * The folder path and the macOS bookmark live in the main process only. The
 * renderer sees a folder name for the settings card and nothing else.
 */

/** Poll cadence: the tool does the network work; we read the local file. */
export const DIRECT_ACCESS_POLL_MS = 15 * 1000;
/** Drive, Dropbox and OneDrive take seconds to a minute to round-trip a change. */
export const DIRECT_ACCESS_WRITE_THROTTLE_MS = 15 * 1000;
/** Stamped by the shared cycle on every read of a real snapshot (seed guard). */
export const DIRECT_ACCESS_LAST_SYNCED_KEY = 'dayglance-direct-access-last-synced';
/** 'true' | 'false' | absent. Absent means ON once a folder is connected. */
export const DIRECT_ACCESS_PREF_KEY = 'dayglance-direct-access-enabled';

const defaultBridge = () =>
  (typeof window !== 'undefined' ? window.electronAPI?.directAccess ?? null : null);
const defaultStorage = () =>
  (typeof window !== 'undefined' ? window.localStorage : null);

/** Electron only, every desktop platform. Decides whether the poll even starts. */
export const isDirectAccessSupported = () => !!defaultBridge();

/**
 * @param {object} [deps]
 * @param {() => object|null} [deps.bridge]   window.electronAPI.directAccess, or a fake
 * @param {() => Storage|null} [deps.storage]
 * @param {Pick<Console,'warn'>} [deps.log]
 */
export function createDirectAccessTransport({ bridge = defaultBridge, storage = defaultStorage, log = console } = {}) {
  // status: 'unknown' until the main process has restored its config, then
  // 'disconnected' | 'connected' | 'unreachable'.
  const state = { status: 'unknown', name: null, path: null };
  const statusListeners = new Set();
  const changeListeners = new Set();
  let unsubscribeBridge = null;
  let initPromise = null;
  let reprobing = false;

  const readPref = () => {
    try { return storage()?.getItem(DIRECT_ACCESS_PREF_KEY) ?? null; }
    catch { return null; }
  };
  const isEnabled = () => readPref() !== 'false';
  const isConnected = () => state.status === 'connected' || state.status === 'unreachable';

  // The settings panel reads this through useSyncExternalStore, which needs
  // the same object back until something changed.
  const compute = () => ({
    supported: !!bridge(),
    status: state.status,
    name: state.name,
    path: state.path,
    connected: isConnected(),
    enabled: isEnabled(),
  });
  let snapshot = compute();
  const notify = () => {
    snapshot = compute();
    for (const l of statusListeners) {
      try { l(snapshot); } catch { /* a listener error must not break the others */ }
    }
  };
  const emitChanged = () => {
    for (const cb of changeListeners) {
      try { cb(); } catch { /* ditto */ }
    }
  };

  const applyStatus = (st) => {
    if (!st || !st.configured) {
      state.status = 'disconnected';
      state.name = null;
      state.path = null;
    } else {
      state.status = st.reachable ? 'connected' : 'unreachable';
      state.name = st.name ?? null;
      state.path = st.path ?? null;
    }
    notify();
  };

  // Ask the main process to re-open the folder it remembers. Once per session;
  // every entry point funnels through here so the order of first use does not
  // matter.
  const ensureInit = () => {
    if (initPromise) return initPromise;
    const b = bridge();
    if (!b) {
      initPromise = Promise.resolve();
      return initPromise;
    }
    initPromise = (async () => {
      try {
        applyStatus(await b.restore());
      } catch (e) {
        log.warn('[direct-access] restore failed:', e?.message ?? e);
        applyStatus(null);
      }
    })();
    return initPromise;
  };

  // While unreachable, each poll tick asks the main process whether the folder
  // is back. Resuming also kicks a cycle, so a change that landed while the
  // folder was away is picked up at once rather than a poll later.
  const reprobe = async () => {
    if (reprobing) return;
    reprobing = true;
    try {
      const st = await bridge()?.status();
      const was = state.status;
      applyStatus(st);
      if (was !== 'connected' && state.status === 'connected') emitChanged();
    } catch { /* still away */ }
    finally { reprobing = false; }
  };

  const clearLastSynced = () => {
    try { storage()?.removeItem(DIRECT_ACCESS_LAST_SYNCED_KEY); } catch { /* ignore */ }
  };
  const writePref = (enabled) => {
    try { storage()?.setItem(DIRECT_ACCESS_PREF_KEY, enabled ? 'true' : 'false'); } catch { /* ignore */ }
  };

  return {
    id: 'direct-access',
    pollMs: DIRECT_ACCESS_POLL_MS,
    writeThrottleMs: DIRECT_ACCESS_WRITE_THROTTLE_MS,
    lastSyncedKey: DIRECT_ACCESS_LAST_SYNCED_KEY,
    allowsPlaintextReseed: false,

    isSupported: () => !!bridge(),

    isAvailable: () => {
      if (!bridge()) return false;
      if (state.status === 'unknown') { ensureInit(); return false; }
      if (state.status === 'unreachable') { reprobe(); return false; }
      return state.status === 'connected';
    },

    // Maps the main process's classification onto the string contract the
    // shared cycle reads (classifySnapshotText).
    read: async () => {
      const r = await bridge().read();
      switch (r?.kind) {
        case 'absent': return null;
        case 'downloading': return JSON.stringify({ downloading: true });
        case 'text': return r.text;
        default: {
          // The folder went away under us. Say so once (the cycle surfaces the
          // error), then wait quietly: see reprobe().
          if (state.status === 'connected') {
            state.status = 'unreachable';
            notify();
          }
          return JSON.stringify({ error: r?.error ?? 'folder unavailable' });
        }
      }
    },

    write: async (text) => (await bridge().write(text)) === true,

    // Push signals: the main process's folder watcher, a folder picked or
    // re-enabled in settings, and a folder that came back from unreachable.
    onChanged: (cb) => {
      changeListeners.add(cb);
      if (!unsubscribeBridge) unsubscribeBridge = bridge()?.onChanged?.(() => emitChanged()) ?? null;
      return () => {
        changeListeners.delete(cb);
        if (changeListeners.size === 0 && unsubscribeBridge) {
          unsubscribeBridge();
          unsubscribeBridge = null;
        }
      };
    },

    kicksOnVisibility: () => true,

    isEnabled,
    setEnabled: (enabled) => {
      writePref(enabled);
      notify();
      if (enabled) emitChanged();
    },
    // Picking the folder is the decision; the snapshot in it is applied.
    firstRunDecided: () => true,

    // ── Settings surface ─────────────────────────────────────────────────
    subscribe: (listener) => {
      statusListeners.add(listener);
      ensureInit();
      return () => statusListeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isConnected,

    /** Native folder picker. Resolves to the new snapshot, or null if cancelled. */
    pickFolder: async () => {
      const st = await bridge()?.pick();
      if (!st) return null;
      // A different folder has its own history: the seed guard must not read
      // an empty new folder as an eviction of the old one and wait ten
      // minutes before seeding it.
      clearLastSynced();
      writePref(true);
      applyStatus(st);
      emitChanged();
      return snapshot;
    },

    disconnect: async () => {
      try { await bridge()?.disconnect(); } catch { /* the renderer side still forgets it */ }
      clearLastSynced();
      applyStatus(null);
    },

    /** Deletes the snapshot in the folder (reset scope "everywhere"). */
    deleteSnapshot: async () => (await bridge()?.deleteFile()) === true,
  };
}

/** The app's one Direct Access transport. */
export const directAccessTransport = createDirectAccessTransport();
