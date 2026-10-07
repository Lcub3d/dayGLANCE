/**
 * iCloud as a snapshot-file transport (sync/snapshotFileSync.js).
 *
 * Wraps the two Apple bridges behind the one shape the shared cycle and hook
 * consume, so Direct Access (docs/direct-access-sync.md) can be a second
 * transport rather than a second copy of the loop:
 *
 *   • iOS WKWebView — window.DayGlanceNative.readICloudSync() / writeICloudSync()
 *     are synchronous bridge calls; availability is re-probed every cycle.
 *   • macOS Electron — window.electronAPI.readICloud() / writeICloud() are IPC
 *     promises into electron/icloud.ts, which also pushes 'icloud:changed' when
 *     the container file changes under it.
 *
 * iCloud Drive is already encrypted by Apple at rest and in transit, so this
 * transport reads and writes plaintext. If the file happens to be an encrypted
 * envelope written by an older build, the cycle decrypts it once with the
 * cached key and writes it back as plaintext; `allowsPlaintextReseed` is what
 * permits that here and forbids it for a third-party folder.
 */

import { isNativeIOS } from '../native.js';
import { ICLOUD_LAST_SYNCED_KEY } from '../utils/icloudSeedGuard.js';
import { getICloudSyncPref, isICloudSyncEnabled, setICloudSyncEnabled } from '../utils/icloudSyncPref.js';

/** Poll cadence. The daemon does the network work; we read the local file. */
export const ICLOUD_POLL_MS = 15 * 1000;

/**
 * Bird's full round-trip (local write → CloudKit upload → server-truth
 * sync-down) takes ~5-10 s on a healthy link. Writing faster than that piles
 * new conflict versions onto the CloudKit document zone, because each upload
 * races bird's pending sync-down ACK.
 */
export const ICLOUD_WRITE_THROTTLE_MS = 5000;

/**
 * How long a non-current local copy is waited out before the transport reads
 * the bytes the device already holds.
 *
 * ICloudBridge.readSync answers {"downloading":true} whenever a newer version
 * exists remotely and has not finished arriving, and the cycle skips until it
 * has. That is right for seconds and wrong for minutes: on 2026-10-05 an idle
 * Mac rewriting the file every cycle kept a phone in that state for twelve
 * minutes, and every edit made on the phone in that window reached nobody.
 * Past this window the transport asks the bridge for the last fully downloaded
 * version (iOS `.downloaded`), the cycle merges the device's edits into it and
 * writes, and the next successful download merges again. The union merge is
 * built for a stale base; the cost is one extra write. A file with no bytes
 * at all (`.notDownloaded`, a .icloud stub) still reports downloading.
 */
export const ICLOUD_DOWNLOAD_GRACE_MS = 2 * 60 * 1000;

const isDownloadingSentinel = (str) => {
  if (typeof str !== 'string' || !str.startsWith('{')) return false;
  try { return JSON.parse(str)?.downloading === true; } catch { return false; }
};

const isElectronMac = () =>
  typeof window !== 'undefined' &&
  !!(window.electronAPI?.isElectron && window.electronAPI?.platform === 'darwin');

/**
 * @param {object} [deps]
 * @param {() => number} [deps.now]
 * @param {number} [deps.downloadGraceMs]
 */
export function createICloudSnapshotTransport({ now = Date.now, downloadGraceMs = ICLOUD_DOWNLOAD_GRACE_MS } = {}) {
  const onIOS = () => isNativeIOS();
  const onMac = () => !onIOS() && isElectronMac();
  // Epoch ms of the first consecutive cycle that found the copy non-current, or 0.
  let downloadingSince = 0;

  const readIOS = () => {
    const fresh = window.DayGlanceNative.readICloudSync();
    if (!isDownloadingSentinel(fresh)) {
      downloadingSince = 0;
      return fresh;
    }
    const t = now();
    if (!downloadingSince) downloadingSince = t;
    if (t - downloadingSince < downloadGraceMs) return fresh;
    // Stalled past the window: take the last downloaded version if there is one.
    const stale = window.DayGlanceNative.readICloudSync(true);
    if (!stale || isDownloadingSentinel(stale)) return fresh;
    console.warn(`[icloud] download stalled for ${Math.round((t - downloadingSince) / 1000)} s; merging into the last downloaded copy`);
    return stale;
  };

  return {
    id: 'icloud',
    pollMs: ICLOUD_POLL_MS,
    writeThrottleMs: ICLOUD_WRITE_THROTTLE_MS,
    lastSyncedKey: ICLOUD_LAST_SYNCED_KEY,
    allowsPlaintextReseed: true,
    /** Apple guideline 5.1.3: no HealthKit-derived data in iCloud (utils/healthLogFilter.js). */
    stripsHealthLogs: true,

    /** Platform has an iCloud bridge at all. Decides whether the poll even starts. */
    isSupported: () => onIOS() || onMac(),

    /**
     * Reachable right now. iOS re-probes every cycle rather than caching: a
     * sticky result meant disabling iCloud Drive mid-session left it `true`,
     * so every poll read the container, got an error, and flashed a transient
     * sync error until relaunch. Re-probing is cheap (a nil-container check)
     * and self-healing: silent while iCloud is off, resumes when it returns.
     */
    isAvailable: () => {
      if (onIOS()) {
        try {
          return JSON.parse(window.DayGlanceNative.iCloudAvailable()).available === true;
        } catch { return false; }
      }
      return onMac();
    },

    // macOS answers downloading only for a .icloud stub, which has no bytes to
    // fall back to, so the bounded wait applies to iOS alone.
    read: async () => (onIOS() ? readIOS() : await window.electronAPI.readICloud()),

    write: async (text) => {
      if (onIOS()) {
        try {
          const r = JSON.parse(window.DayGlanceNative.writeICloudSync(text));
          if (!r.ok) console.error('iCloud write failed:', r.error);
          return r.ok === true;
        } catch {
          console.error('iCloud write failed');
          return false;
        }
      }
      return (await window.electronAPI.writeICloud(text)) === true;
    },

    /**
     * macOS only: the main process watches the container (fs.watch) and sends
     * 'icloud:changed' when the iOS app wrote. iOS reaches the hook through the
     * dayglanceForeground event instead (ICloudBridge's NSMetadataQuery posts
     * it), which App.jsx already routes to runSync.
     */
    onChanged: (cb) => (onMac() ? window.electronAPI.onICloudChanged?.(cb) : undefined),

    /** macOS re-syncs when the window comes to the foreground; iOS uses dayglanceForeground. */
    kicksOnVisibility: () => onMac(),

    // Per-device switch and the first-run decision behind it. Tri-state on
    // purpose: absence means ON (utils/icloudSyncPref.js).
    isEnabled: () => isICloudSyncEnabled(),
    setEnabled: (enabled) => setICloudSyncEnabled(enabled),
    firstRunDecided: () => getICloudSyncPref() !== null,
  };
}
