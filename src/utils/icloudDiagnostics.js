/**
 * iCloud diagnostics — what does this device actually see in the container?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A "my data came back after deleting the app" report is hard to diagnose from
 * the outside, because every candidate store is invisible from the UI. The
 * question that matters is narrow and factual:
 *
 *     Does this device resolve an iCloud container, and is dayglance-sync.json
 *     sitting in it right now?
 *
 * Safari Web Inspector can answer that, but only on a Debug or TestFlight build
 * (WebView.swift gates isInspectable on a receipt check that is not reliable),
 * and it needs a Mac, a cable, and two settings toggles. This module answers the
 * same question from inside the app on any build.
 *
 * What it found, on device: the container reported `unavailable` before the app
 * was deleted and `AVAILABLE` after it was reinstalled, with nothing touched in
 * between. Reinstalling re-grants the iCloud entitlement, so the per-app toggle
 * comes back on and the surviving snapshot is read again.
 *
 * Note what that ruled OUT, since an earlier version of this file asserted it:
 * isAvailable() is a bare `containerURL() != nil`, and the theory was that it
 * reported true for containers the user had disabled. It does not — with iCloud
 * off for dayGLANCE it correctly returned `{"available":false}`. Availability is
 * honest; the toggle resetting on reinstall is the actual mechanism.
 *
 * Read-only by construction: nothing here writes, deletes, or triggers a sync.
 * Every platform API is injected so the whole thing is testable without a device.
 */

// The one import here: the key is owned by the seed guard, which writes it. A
// second copy of the string literal is exactly how this module ended up reporting
// a key that belonged to a different sync tier.
import { ICLOUD_LAST_SYNCED_KEY } from './icloudSeedGuard.js';
import { isICloudSyncEnabled } from './icloudSyncPref.js';
import { explainSnapshotMerge } from '../sync/snapshotMergeExplain.js';
import { mergeSyncData } from '../mergeSync.js';
import { stripHealthSourcedLogs } from './healthLogFilter.js';

/** Shape returned when a probe cannot run on this platform. */
const UNSUPPORTED = 'unsupported';

/**
 * Byte length of a UTF-8 string. `str.length` counts UTF-16 code units, which
 * under-reports any payload containing emoji or non-Latin text — and task titles
 * routinely contain both.
 */
export function utf8Bytes(str, TextEncoderImpl = typeof TextEncoder !== 'undefined' ? TextEncoder : null) {
  if (typeof str !== 'string') return 0;
  if (!TextEncoderImpl) return str.length;
  return new TextEncoderImpl().encode(str).length;
}

/** Human-readable byte count. Diagnostics are read by people, not parsers. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '(none)';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Which Apple transport this device has, if any.
 * @returns {'ios'|'macos'|'none'}
 */
export function detectPlatform({ nativeBridge, electronAPI } = {}) {
  if (nativeBridge?.iCloudAvailable) return 'ios';
  // Electron exposes readICloud on every platform, but the main-process handler
  // is a darwin-only no-op — Windows/Linux must report 'none', not 'macos'.
  if (electronAPI?.readICloud && electronAPI.platform === 'darwin') return 'macos';
  return 'none';
}

/**
 * Probes container availability.
 *
 * iOS asks the bridge directly. macOS has no availability probe — electron/icloud.ts
 * resolves the container by raw filesystem path and never registers with the iCloud
 * daemon — so availability there can only be inferred from whether a read succeeds,
 * and is reported as null rather than guessed.
 *
 * @returns {{value: boolean|null, raw: string|null, error: string|null}}
 */
export function probeAvailability({ nativeBridge } = {}) {
  if (!nativeBridge?.iCloudAvailable) {
    return { value: null, raw: null, error: null };
  }
  let raw = null;
  try {
    raw = nativeBridge.iCloudAvailable();
    const parsed = JSON.parse(raw);
    if (parsed?.error) return { value: false, raw, error: String(parsed.error) };
    return { value: parsed?.available === true, raw, error: null };
  } catch (err) {
    return { value: null, raw, error: err?.message ?? String(err) };
  }
}

/**
 * Classifies the raw readICloudSync/readICloud response.
 *
 * The bridge overloads one string return across five outcomes, so this is the
 * single place that untangles them — see ICloudBridge.readSync for the contract.
 *
 * @returns {{state: 'present'|'absent'|'downloading'|'error'|'unsupported',
 *            bytes: number, lastModified: string|null, version: number|null,
 *            taskCount: number|null, inboxCount: number|null, error: string|null}}
 */
export function classifySnapshot(raw, deps = {}) {
  const empty = {
    state: UNSUPPORTED, bytes: 0, lastModified: null, version: null,
    taskCount: null, inboxCount: null, error: null,
  };
  if (raw == null) return { ...empty, state: 'absent' };
  if (raw === 'null' || raw === '') return { ...empty, state: 'absent' };

  const bytes = utf8Bytes(raw, deps.TextEncoderImpl);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Bytes are present but unparseable — a truncated or corrupt file. Worth
    // surfacing as its own state rather than folding into 'error', because it
    // still means the file EXISTS, which is the fact being investigated.
    return { ...empty, state: 'error', bytes, error: `unparseable JSON (${err?.message ?? err})` };
  }

  // Sentinels are the bridge's own status objects, NOT file content, so they get
  // no size. Reporting one read as "32 B" invites the reader to believe a 32-byte
  // file exists — it does not; that is the length of {"error":"iCloud not
  // available"}. The corrupt case above keeps its byte count, because there the
  // bytes really are the file.
  if (parsed?.downloading) return { ...empty, state: 'downloading' };
  if (parsed?.error) return { ...empty, state: 'error', error: String(parsed.error) };

  return {
    state: 'present',
    bytes,
    lastModified: parsed?.lastModified ?? null,
    version: typeof parsed?.version === 'number' ? parsed.version : null,
    taskCount: Array.isArray(parsed?.data?.tasks) ? parsed.data.tasks.length : null,
    inboxCount: Array.isArray(parsed?.data?.unscheduledTasks) ? parsed.data.unscheduledTasks.length : null,
    error: null,
  };
}

/**
 * The OTHER sync transports, so the report can rule them in or out.
 *
 * The first version of this module reported only iCloud, which left a hole: on a
 * device where the container is unavailable, "where did this data come from?" has
 * two remaining answers — local storage survived, or a network tier restored it —
 * and the report could not distinguish them. Any network restore needs config that
 * itself lives in localStorage, so showing whether that config is present is what
 * closes the loop.
 *
 * Note the two tiers keep separate records under different prefixes:
 * `day-planner-cloud-sync-*` for the WebDAV file tier (@glance-apps/sync engine.js)
 * and `dayglance-vault-db-sync-*` for GLANCEvault (dbEngine.js). iCloud writes
 * NEITHER, which is why a device syncing only over iCloud reports "never" for both.
 */
export function readSyncTransports({ localStorage } = {}) {
  const get = (k) => {
    try { return localStorage?.getItem(k) ?? null; } catch { return null; }
  };
  const json = (k) => {
    try { return JSON.parse(get(k) || 'null'); } catch { return null; }
  };

  const webdavCfg = json('day-planner-cloud-sync-config');
  const vaultCfg = json('dayglance-vault-config');

  return {
    // iCloud's own record, written by iCloudSync on every cycle that reads a real
    // snapshot. Before it existed, this panel could only show the WebDAV key, so
    // an iCloud-only device always reported "never" — accurate about WebDAV, and
    // silent about the only tier it actually used.
    icloud: { lastSynced: get(ICLOUD_LAST_SYNCED_KEY) },
    webdav: {
      configured: !!webdavCfg?.enabled,
      provider: webdavCfg?.provider ?? null,
      lastSynced: get('day-planner-cloud-sync-last-synced'),
    },
    vault: {
      // Mirrors isVaultEnabled() in sync/vaultConfig.js — read directly rather
      // than imported so this module stays injectable and testable.
      configured: !!(vaultCfg?.enabled && vaultCfg?.vaultUrl && vaultCfg?.vaultToken && vaultCfg?.accountId),
      lastSynced: get('dayglance-vault-db-sync-last-synced'),
    },
  };
}

/** Local counts + last-sync record, for comparison against the container copy. */
export function readLocalState({ localStorage } = {}) {
  const count = (key) => {
    try {
      const v = JSON.parse(localStorage?.getItem(key) || '[]');
      return Array.isArray(v) ? v.length : 0;
    } catch {
      return 0;
    }
  };
  let lastSynced = null;
  try {
    lastSynced = localStorage?.getItem('day-planner-cloud-sync-last-synced') ?? null;
  } catch {
    lastSynced = null;
  }
  return {
    taskCount: count('day-planner-tasks'),
    inboxCount: count('day-planner-unscheduled'),
    lastSynced,
  };
}

const defaultDeps = () => ({
  nativeBridge: typeof window !== 'undefined' ? window.DayGlanceNative : null,
  electronAPI: typeof window !== 'undefined' ? window.electronAPI : null,
  localStorage: typeof window !== 'undefined' ? window.localStorage : null,
  // The dry-run merge needs this device's payload, which only the app can
  // build; the panel passes it in from the sync context. Absent → no dry run.
  buildSyncPayload: null,
  getSyncRetentionDays: null,
  merge: mergeSyncData,
  // The Direct Access transport (sync/directAccessTransport.js), so the same
  // readout covers its file. The panel passes the singleton; null → no section.
  directAccess: null,
});

/**
 * The same readout for the Direct Access file: what this device sees in the
 * folder, and what its cycle would do with it. Reads through the transport
 * the cycle itself uses, so the classification is the cycle's own.
 *
 * Two Macs were seen trading rewrites of an identical Nextcloud file while
 * the iCloud file held still (2026-10-05); nothing in the app could say which
 * slice they disagreed on, because the dry run only looked at iCloud.
 *
 * @returns {Promise<null | {status: string, name: string|null, enabled: boolean,
 *   snapshot: object|null, merge: object|null}>}  null when the platform has
 *   no Direct Access bridge at all.
 */
export async function probeDirectAccess(deps = {}) {
  const transport = deps.directAccess;
  if (!transport || typeof transport.isSupported !== 'function' || !transport.isSupported()) return null;
  const s = typeof transport.getSnapshot === 'function' ? transport.getSnapshot() : {};
  const head = { status: s?.status ?? 'unknown', name: s?.name ?? null, enabled: s?.enabled !== false };
  if (!s?.connected) return { ...head, snapshot: null, merge: null };
  let raw;
  try {
    raw = await transport.read();
  } catch (err) {
    raw = JSON.stringify({ error: err?.message ?? String(err) });
  }
  const snapshot = classifySnapshot(raw, deps);
  const merge = snapshot.state === 'present' ? dryRunMerge(raw, deps) : null;
  return { ...head, snapshot, merge };
}

/**
 * Runs the cycle's merge against the file WITHOUT applying or writing, and says
 * what it would have done and why (sync/snapshotMergeExplain.js). This is the
 * row that answers "why does this idle Mac rewrite the file every cycle?", which
 * the timestamps alone could only hint at.
 *
 * @returns {object|null} null when there is no snapshot or no payload builder.
 */
export function dryRunMerge(raw, deps = {}) {
  if (typeof deps.buildSyncPayload !== 'function') return null;
  let remote;
  try { remote = JSON.parse(raw); } catch { return null; }
  if (!remote || typeof remote !== 'object' || remote.downloading || remote.error || !remote.data) return null;
  let local;
  try { local = deps.buildSyncPayload()?.data; } catch (err) {
    return { localChanged: false, remoteChanged: false, fileDiffs: [], deviceDiffs: [], flagWithoutDiff: false, error: `payload: ${err?.message ?? err}` };
  }
  if (!local) return null;
  const retentionDays = typeof deps.getSyncRetentionDays === 'function' ? (deps.getSyncRetentionDays() ?? 90) : 90;
  // The file never carries HealthKit-derived counts (healthLogFilter.js), so
  // the write question is asked of the stripped data, exactly as the cycle
  // asks it. The habit definitions ride in the payload itself.
  const strip = deps.strip ?? ((data) => stripHealthSourcedLogs({ data }, data?.habits ?? local?.habits ?? []).data);
  return explainSnapshotMerge({ local, remote: remote.data, retentionDays, merge: deps.merge ?? mergeSyncData, outgoing: strip });
}

/**
 * Runs every probe and returns a flat report.
 *
 * Deliberately user-triggered rather than run on render: readICloudSync is a
 * SYNCHRONOUS bridge call on iOS that returns the entire snapshot, so on a large
 * dataset it blocks the JS thread. Fine for a button press, not for mounting a
 * settings pane.
 *
 * @returns {Promise<{platform, available, snapshot, local}>}
 */
export async function collectICloudDiagnostics(deps = defaultDeps()) {
  const platform = detectPlatform(deps);
  const available = probeAvailability(deps);

  let raw = null;
  if (platform === 'ios') {
    try {
      raw = deps.nativeBridge.readICloudSync();
    } catch (err) {
      raw = JSON.stringify({ error: err?.message ?? String(err) });
    }
  } else if (platform === 'macos') {
    try {
      raw = await deps.electronAPI.readICloud();
    } catch (err) {
      raw = JSON.stringify({ error: err?.message ?? String(err) });
    }
  }

  const snapshot = platform === 'none'
    ? { state: UNSUPPORTED, bytes: 0, lastModified: null, version: null, taskCount: null, inboxCount: null, error: null }
    : classifySnapshot(raw, deps);

  const merge = snapshot.state === 'present' ? dryRunMerge(raw, deps) : null;
  const directAccess = await probeDirectAccess(deps);

  return {
    platform,
    available,
    snapshot,
    merge,
    directAccess,
    // The in-app preference is separate from container availability: a device can
    // resolve the container perfectly and still be deliberately not syncing,
    // because the user chose "start fresh" at first run or switched it off in
    // settings. Reporting only availability would show those as healthy.
    syncEnabled: isICloudSyncEnabled(deps.localStorage),
    local: readLocalState(deps),
    transports: readSyncTransports(deps),
  };
}

/**
 * Plain-text report for the copy-to-clipboard button, so a user can paste the
 * findings into an issue without retyping or screenshotting them.
 */
const snapshotLines = (snapshot, indent, none) => {
  const lines = [`${indent}file:          ${snapshot.state}`];
  // Size/mtime/counts only mean something when there are real file bytes; for a
  // sentinel state they would all read as blanks or, worse, as a tiny file.
  if (snapshot.state === 'present' || snapshot.bytes > 0) {
    lines.push(
      `${indent}  size:          ${formatBytes(snapshot.bytes)}`,
      `${indent}  lastModified:  ${snapshot.lastModified ?? none}`,
      `${indent}  tasks/inbox:   ${snapshot.taskCount ?? none} / ${snapshot.inboxCount ?? none}`,
    );
  }
  if (snapshot.error) lines.push(`${indent}  error:         ${snapshot.error}`);
  return lines;
};

const mergeLines = (merge, indent, none) => {
  if (!merge) return [];
  if (merge.error) return [`${indent}merge dry-run:   error: ${merge.error}`];
  const lines = [
    `${indent}merge dry-run:   would write: ${merge.wouldWrite ? 'YES' : 'no'} / would apply: ${merge.wouldApply ? 'YES' : 'no'}`,
    `${indent}  merge flags:   write ${merge.remoteChanged ? 'YES' : 'no'} / apply ${merge.localChanged ? 'YES' : 'no'}`,
    `${indent}  file differs:  ${merge.fileDiffs.length ? merge.fileDiffs.map((d) => d.summary).join('; ') : none}`,
    `${indent}  device differs:${merge.deviceDiffs.length ? ' ' + merge.deviceDiffs.map((d) => d.summary).join('; ') : ' ' + none}`,
  ];
  if (merge.flagWithoutDiff) lines.push(`${indent}  note:          the merge flagged a write although nothing would change in the file; the write is skipped`);
  return lines;
};

export function formatDiagnosticsReport({ platform, available, snapshot, local, transports, syncEnabled, merge, directAccess }) {
  const none = '(none)';
  const lines = [
    'dayGLANCE iCloud diagnostics',
    `platform:        ${platform}`,
    `container:       ${available.value === null ? 'not probeable on this platform' : available.value ? 'AVAILABLE' : 'unavailable'}`,
  ];
  if (available.raw) lines.push(`  raw:           ${available.raw}`);
  if (available.error) lines.push(`  error:         ${available.error}`);
  lines.push(`snapshot file:   ${snapshot.state}`);
  lines.push(...snapshotLines(snapshot, '', none).slice(1));

  const t = transports ?? { icloud: {}, webdav: {}, vault: {} };
  lines.push(
    `sync on device:  ${syncEnabled === false ? 'OFF' : 'on'}`,
    `icloud synced:   ${t.icloud?.lastSynced ?? 'never'}`,
    `webdav sync:     ${t.webdav.configured ? `configured (${t.webdav.provider ?? 'unknown'})` : 'not configured'}`,
    `  last synced:   ${t.webdav.lastSynced ?? 'never'}`,
    `glancevault:     ${t.vault.configured ? 'configured' : 'not configured'}`,
    `  last synced:   ${t.vault.lastSynced ?? 'never'}`,
    `local tasks:     ${local.taskCount}`,
    `local inbox:     ${local.inboxCount}`,
  );
  lines.push(...mergeLines(merge, '', none));

  if (directAccess) {
    const da = directAccess;
    lines.push(
      '',
      'direct access:   ' + (da.snapshot ? `${da.status} (${da.name ?? none})` : da.status === 'unreachable' ? `unreachable (${da.name ?? none})` : 'not connected'),
      `  sync on device: ${da.enabled === false ? 'OFF' : 'on'}`,
    );
    if (da.snapshot) lines.push(...snapshotLines(da.snapshot, '  ', none));
    lines.push(...mergeLines(da.merge, '  ', none));
  }
  return lines.join('\n');
}
