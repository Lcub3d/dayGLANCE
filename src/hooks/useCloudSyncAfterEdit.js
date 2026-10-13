// The file-tier sync that follows a local edit: five seconds after the data
// last changed, run one sync cycle (#2065).
//
// THE CYCLE, NEVER A BARE UPLOAD. A write with no read behind it cannot carry a
// validator the server could refuse (the overwrite #2065 closed), and it also
// always 412s once a cycle has written, because the verified ETag comes from a
// read and never from a write: the engine swallows that 412 and the edit waits
// for the 60-second poll instead of five seconds. The call goes through
// utils/syncNowAction.js runSyncAfterEdit, whose signature has no upload to pass.
//
// THE APPLY GUARD. applyEngineData sets suppressCloudUploadRef while a cycle's
// own merge is landing, so the state change it causes does not arm another
// cycle. The engine applies only when a merge changed local data, so a cycle
// that finds nothing new cannot re-trigger itself either.
//
// Extracted from App.jsx so the wiring is under test: the adapter tests cover
// the engine, and nothing else would notice this line turning back into
// engine.upload().

import { useEffect } from 'react';
import { runSyncAfterEdit } from '../utils/syncNowAction.js';

export const SYNC_AFTER_EDIT_DELAY_MS = 5000;

/**
 * @param {object} deps
 * @param {boolean} deps.enabled          file-tier sync is on (and this is not the tray)
 * @param {boolean} deps.dataLoaded
 * @param {boolean} deps.syncKeyReady     re-runs the effect when the key arrives
 * @param {{current: boolean}} deps.syncKeyReadyRef
 * @param {{current: boolean}} deps.suppressCloudUploadRef  set while remote data is applied
 * @param {{current: any}} deps.cloudSyncDebounceRef        the pending timer
 * @param {{current: (() => void) | null}} deps.cloudSyncDownloadRef  engine.download()
 * @param {unknown[]} deps.changeKeys     the synced data slices; any change re-arms the timer
 */
export default function useCloudSyncAfterEdit({
  enabled, dataLoaded, syncKeyReady, syncKeyReadyRef,
  suppressCloudUploadRef, cloudSyncDebounceRef, cloudSyncDownloadRef, changeKeys,
}) {
  useEffect(() => {
    if (!enabled || !dataLoaded || suppressCloudUploadRef.current || !syncKeyReadyRef.current) return;
    if (cloudSyncDebounceRef.current) clearTimeout(cloudSyncDebounceRef.current);
    cloudSyncDebounceRef.current = setTimeout(() => {
      runSyncAfterEdit({ cloudSyncDownload: cloudSyncDownloadRef.current });
    }, SYNC_AFTER_EDIT_DELAY_MS);
    return () => { if (cloudSyncDebounceRef.current) clearTimeout(cloudSyncDebounceRef.current); };
    // The data slices arrive as one list so App.jsx keeps naming them; the refs
    // are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...changeKeys, enabled, dataLoaded, syncKeyReady]);
}
