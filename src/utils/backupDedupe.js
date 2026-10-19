// Skipping auto-backups whose content has not changed (#2144).
//
// Every auto-backup stores the whole payload, and at the default retention
// that is up to 66 local copies plus as many remote files. Most of them were
// identical: the payload changes only when the user's data does, but the
// cadence fires on the clock. @glance-apps/sync 2.2.0 can skip a local backup
// identical to the last one; it needs a fingerprint from us, because the
// payload's top-level `timestamp` differs on every build and would defeat a
// comparison of the whole thing. The fingerprint covers `payload.data`, whose
// volatile keys (backup and sync markers) deviceSettings already excludes.
//
// Remote uploads get the same treatment here, since only the app knows what it
// last uploaded successfully.

/**
 * SHA-256 (hex) of the payload's `data`, or undefined where WebCrypto is not
 * available. Undefined means "no dedupe": the backup is always saved.
 */
export async function backupFingerprint(payload) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !payload) return undefined;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload.data ?? payload));
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

// The last remote upload that succeeded: { fingerprint, filename, encrypted }.
// Excluded from deviceSettings (it is a backup marker, and capturing it would
// change the next payload's fingerprint after every upload).
export const LAST_REMOTE_BACKUP_KEY = 'day-planner-auto-backup-remote-fingerprint';

export function readLastRemoteBackup(storage = localStorage) {
  try { return JSON.parse(storage.getItem(LAST_REMOTE_BACKUP_KEY) || 'null'); } catch { return null; }
}

export function writeLastRemoteBackup(record, storage = localStorage) {
  try {
    if (record?.fingerprint && record.filename) storage.setItem(LAST_REMOTE_BACKUP_KEY, JSON.stringify(record));
    else storage.removeItem(LAST_REMOTE_BACKUP_KEY);
  } catch { /* the next backup uploads again; nothing is lost */ }
}

/**
 * Whether a remote upload can be skipped because the target already holds a
 * backup of exactly this content. All three must hold:
 *   - the content matches the last successful upload;
 *   - that upload was encrypted the same way (turning encryption on must
 *     re-upload, or the newest remote copy stays plaintext);
 *   - its file is still on the target. A pruned, deleted or different target
 *     (the user switched servers) has no such file, so the upload goes ahead.
 */
export function canSkipRemoteUpload({ fingerprint, encrypted, last, remoteFiles }) {
  if (!fingerprint || !last || last.fingerprint !== fingerprint) return false;
  if (!!last.encrypted !== !!encrypted) return false;
  return Array.isArray(remoteFiles) && remoteFiles.some(f => f?.filename === last.filename);
}
