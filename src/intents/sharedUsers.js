import { webdavFetch } from '../utils/cloudSyncProviders.js';
import * as icloudFileTransport from './icloudFileTransport.js';
import { directAccessTransport } from '../sync/directAccessTransport.js';

const USERS_FILENAME = 'glance-users.json';
const DEFAULT_USERS_PATH = '/GLANCE/users/';

/**
 * Derive the WebDAV base URL and auth from a cloudSyncConfig object.
 * Supports the 'nextcloud', 'koofr', and 'webdav' provider shapes.
 * Returns null if the config is missing required fields.
 */
export function resolveWebDAV(cloudSyncConfig) {
  if (!cloudSyncConfig?.enabled) return null;
  const provider = cloudSyncConfig.provider || 'nextcloud';
  if (provider === 'nextcloud') {
    const { nextcloudUrl, username, appPassword } = cloudSyncConfig;
    if (!nextcloudUrl || !username || !appPassword) return null;
    const base = nextcloudUrl.replace(/\/+$/, '');
    const user = encodeURIComponent(username);
    return { baseUrl: `${base}/remote.php/dav/files/${user}`, username, appPassword };
  } else if (provider === 'koofr') {
    // Koofr configs carry no URL key — the WebDAV root is fixed (mirrors the
    // koofr provider in @glance-apps/sync providers.js).
    const { username, appPassword } = cloudSyncConfig;
    if (!username || !appPassword) return null;
    return { baseUrl: 'https://app.koofr.net/dav/Koofr', username, appPassword };
  } else {
    const { webdavUrl, username, appPassword } = cloudSyncConfig;
    if (!webdavUrl || !username || !appPassword) return null;
    return { baseUrl: webdavUrl.replace(/\/+$/, ''), username, appPassword };
  }
}

function usersDir(baseUrl, usersPath) {
  const path = (usersPath ?? DEFAULT_USERS_PATH).replace(/\/+$/, '') + '/';
  return `${baseUrl}${path}`;
}

// Encode credentials as Base64 for Basic auth. btoa() alone throws
// InvalidCharacterError on codepoints > 255 (accented chars, CJK, emoji), so
// UTF-8-encode first — matching toBase64() used everywhere else in the app.
function authHeaders(username, appPassword) {
  const raw = `${username}:${appPassword}`;
  const cred = btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
  return { 'X-WebDAV-Auth': `Basic ${cred}` };
}

// lastGLANCE's SharedUser schema: { id: sync_id, name, updatedAt, deleted? }
// dayGLANCE's user schema:        { id: local_id, syncId: sync_id, name, ... }
//
// At the WebDAV boundary we use lastGLANCE's schema (id = sync_id) so both apps
// read/write the same field. These helpers translate between the two shapes.

function toWireFormat(u) {
  return { id: u.syncId ?? u.id, name: u.name, updatedAt: u.updatedAt, ...(u.deleted ? { deleted: true } : {}) };
}

// Given a wire entry { id: sync_id, ... } and the matching local user (if any),
// reconstruct a dayGLANCE user shape so the local id is preserved.
function fromWireFormat(entry, localUser) {
  if (localUser) {
    // Keep the local user but update mutable fields from the wire entry.
    return { ...localUser, name: entry.name, updatedAt: entry.updatedAt, ...(entry.deleted ? { deleted: true } : { deleted: undefined }) };
  }
  // New user introduced by another app: wire id IS the syncId; no local id yet.
  return { id: entry.id, syncId: entry.id, name: entry.name, updatedAt: entry.updatedAt, ...(entry.deleted ? { deleted: true } : {}) };
}

// Merge remote wire entries into the local user list.
// Remote entries are keyed by sync_id (entry.id). Local users are keyed by syncId ?? id.
// Last-write-wins by updatedAt.
function mergeUsers(localUsers, remoteWire) {
  // Index local users by their sync_id (syncId field, falling back to id).
  const bySyncId = new Map(localUsers.map(u => [u.syncId ?? u.id, u]));

  const result = new Map(localUsers.map(u => [u.syncId ?? u.id, u]));

  for (const entry of remoteWire) {
    const syncId = entry.id; // wire format: id = sync_id
    const local = bySyncId.get(syncId);
    const existing = result.get(syncId);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      result.set(syncId, fromWireFormat(entry, local));
    }
  }

  return [...result.values()];
}

/**
 * Sync the local user list with glance-users.json on WebDAV using the
 * cloud sync credentials (default path: GLANCE/users/glance-users.json).
 * - If the file doesn't exist, write local users (this app is first).
 * - If it exists, merge remote + local (last-write-wins by updatedAt per syncId)
 *   and write the merged result back.
 * usersPath is read from the intent config (config.usersPath).
 * Returns the merged user array, or null if cloud sync is not configured.
 */
export async function syncSharedUsers(cloudSyncConfig, usersPath, localUsers) {
  const webdav = resolveWebDAV(cloudSyncConfig);
  if (!webdav) return null;

  const { baseUrl, username, appPassword } = webdav;
  const dir = usersDir(baseUrl, usersPath);
  const fileUrl = `${dir}${USERS_FILENAME}`;
  const headers = authHeaders(username, appPassword);
  const putHeaders = { ...headers, 'Content-Type': 'application/json' };

  const getRes = await webdavFetch('GET', fileUrl, headers);

  let merged;
  if (getRes.ok) {
    let remoteWire = [];
    try {
      const data = await getRes.json();
      remoteWire = Array.isArray(data.users) ? data.users : [];
    } catch {
      remoteWire = [];
    }
    merged = mergeUsers(localUsers, remoteWire);
  } else if (getRes.status === 404) {
    merged = localUsers;
  } else {
    console.warn('[shared-users] GET failed:', getRes.status);
    return null;
  }

  // Write using lastGLANCE's wire format so both apps share the same schema.
  const wire = merged.map(toWireFormat);
  const body = JSON.stringify({ version: 1, users: wire, updated_at: new Date().toISOString() });

  let putRes = await webdavFetch('PUT', fileUrl, putHeaders, body);
  if (putRes.status === 403 || putRes.status === 404 || putRes.status === 409) {
    await webdavFetch('MKCOL', dir, headers);
    putRes = await webdavFetch('PUT', fileUrl, putHeaders, body);
  }
  if (!putRes.ok) {
    console.warn('[shared-users] PUT failed:', putRes.status);
  }

  return merged;
}

/** The roster's directory and file, relative to a folder root (no leading slash). */
function relativeRosterPaths(usersPath) {
  const dirPath = (usersPath ?? DEFAULT_USERS_PATH).replace(/^\//, '').replace(/\/*$/, '') + '/';
  return { dirPath, filePath: dirPath + USERS_FILENAME };
}

/**
 * What a folder-based roster sync does with what it read: the merged roster
 * and the body to write back, or null when the file is still downloading and
 * the caller should retry next cycle. `remoteRaw` follows the snapshot read
 * contract: null for an absent file, '{"downloading":true}', or the text.
 * Shared by the iCloud and Direct Access roster syncs.
 */
export function reconcileRoster(remoteRaw, localUsers) {
  if (remoteRaw && typeof remoteRaw === 'string') {
    try {
      const parsed = JSON.parse(remoteRaw);
      if (parsed?.downloading === true) return null;
    } catch { /* not JSON — treat as content */ }
  }
  let merged;
  if (remoteRaw === null || remoteRaw === undefined || remoteRaw === 'null') {
    // File doesn't exist yet — this app is first
    merged = localUsers;
  } else {
    let remoteWire = [];
    try {
      const data = JSON.parse(remoteRaw);
      remoteWire = Array.isArray(data.users) ? data.users : [];
    } catch {
      remoteWire = [];
    }
    merged = mergeUsers(localUsers, remoteWire);
  }
  const body = JSON.stringify({ version: 1, users: merged.map(toWireFormat), updated_at: new Date().toISOString() });
  return { merged, body };
}

/**
 * Sync the local user list with glance-users.json on iCloud Drive, using the
 * same directory structure as WebDAV: GLANCE/users/glance-users.json under
 * the Documents/ folder of the iCloud container.
 *
 * Returns the merged user array, or null if iCloud is not available or the
 * file is still downloading (caller should retry on next sync cycle).
 */
export async function syncSharedUsersViaICloud(usersPath, localUsers) {
  if (!icloudFileTransport.isAvailable()) return null;

  const { dirPath, filePath } = relativeRosterPaths(usersPath);

  let remoteRaw;
  try {
    remoteRaw = await icloudFileTransport.readFile(filePath);
  } catch (err) {
    console.warn('[shared-users/icloud] readFile error:', err.message);
    return null;
  }

  const r = reconcileRoster(remoteRaw, localUsers);
  if (!r) return null; // still downloading — caller should retry
  const { merged, body } = r;

  let ok = await icloudFileTransport.writeFile(filePath, body);
  if (!ok) {
    // Directory may not exist — create it and retry
    await icloudFileTransport.makeDir(dirPath);
    ok = await icloudFileTransport.writeFile(filePath, body);
  }
  if (!ok) {
    console.warn('[shared-users/icloud] writeFile failed');
  }

  return merged;
}

/**
 * Sync the local user list with glance-users.json in the Direct Access folder
 * (docs/direct-access-sync.md, Phase 5), at the same relative path WebDAV
 * uses, through the transport's roster slot: files by path on desktop and
 * Android, the roster's own bookmarked file on an iPhone.
 *
 * Returns the merged user array, or null when no folder is connected, the
 * folder or roster is unreachable (nothing is written then), or the file is
 * still being delivered (retry next cycle).
 */
export async function syncSharedUsersViaDirectAccess(usersPath, localUsers, transport = directAccessTransport) {
  if (!transport?.isSupported?.() || !transport.rosterSupported?.()) return null;
  if (!transport.isAvailable()) return null;

  const { filePath } = relativeRosterPaths(usersPath);

  let remoteRaw;
  try {
    remoteRaw = await transport.rosterRead(filePath);
  } catch (err) {
    console.warn('[shared-users/direct-access] read error:', err?.message ?? err);
    return null;
  }
  // An error object (the folder went away, a roster that cannot be reached):
  // say nothing and write nothing. Seeding over a folder we cannot read would
  // be the resurrection the snapshot cycle guards against.
  if (remoteRaw && typeof remoteRaw === 'string') {
    try {
      const parsed = JSON.parse(remoteRaw);
      if (parsed && typeof parsed === 'object' && parsed.error) {
        console.warn('[shared-users/direct-access] roster unavailable:', parsed.error);
        return null;
      }
    } catch { /* content */ }
  }

  const r = reconcileRoster(remoteRaw, localUsers);
  if (!r) return null;
  const { merged, body } = r;

  const ok = await transport.rosterWrite(filePath, body);
  if (!ok) console.warn('[shared-users/direct-access] write failed');
  return merged;
}
