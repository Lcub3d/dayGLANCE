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

const isElectronMac = () =>
  typeof window !== 'undefined' &&
  !!(window.electronAPI?.isElectron && window.electronAPI?.platform === 'darwin');

export function createICloudSnapshotTransport() {
  const onIOS = () => isNativeIOS();
  const onMac = () => !onIOS() && isElectronMac();

  return {
    id: 'icloud',
    pollMs: ICLOUD_POLL_MS,
    writeThrottleMs: ICLOUD_WRITE_THROTTLE_MS,
    lastSyncedKey: ICLOUD_LAST_SYNCED_KEY,
    allowsPlaintextReseed: true,

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

    read: async () => (onIOS()
      ? window.DayGlanceNative.readICloudSync()
      : await window.electronAPI.readICloud()),

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
