/**
 * One cycle of snapshot-file sync, over an injected transport.
 *
 * A snapshot-file transport is a local file that something else ferries
 * between devices: the iCloud ubiquity container today, a Google Drive /
 * Dropbox / Syncthing folder with Direct Access (docs/direct-access-sync.md).
 * There is no server and no ETag, so the cycle is: read the whole file, merge
 * it with local state by the same three-way merge the WebDAV tier uses, apply
 * what changed locally, and write the merged result back.
 *
 * This module is the iCloud loop that used to live in App.jsx, lifted out so a
 * second transport cannot drift from it. Every guard that loop carried is here,
 * unchanged, and each has a test that fails when it is removed:
 *
 *   • an ABSENT file is seeded from local data, but only once the seed guard
 *     (utils/icloudSeedGuard.js) says absence is not a transient eviction, and
 *     only when the payload is not an empty copy of a populated localStorage;
 *   • a 'downloading' placeholder and an unparseable file skip the cycle;
 *   • an 'error' object is surfaced, never merged;
 *   • an encrypted envelope is decrypted when the key is cached; when it cannot
 *     be, the transport decides whether local data may be written over it as
 *     plaintext (iCloud: yes, it is a legacy cleanup inside Apple's container;
 *     Direct Access: never, the folder is someone else's cloud);
 *   • a real snapshot stamps the transport's own last-synced key BEFORE the
 *     first-run prompt, because reading it is what proves the transport works;
 *   • a fresh device facing a populated snapshot is asked, not restored;
 *   • writes are throttled per transport so a daemon's round-trip is not raced;
 *   • HealthKit-derived counts are stripped from every copy written out.
 *
 * Nothing here touches React. The hook (hooks/useSnapshotFileSync.js) owns the
 * poll, the mutex and the prompt state; App.jsx owns i18n and status UI.
 */

import { evaluateMissingSnapshot } from '../utils/icloudSeedGuard.js';
import { shouldPromptFirstRun, payloadHasData } from '../utils/icloudSyncPref.js';

/** Shared with the WebDAV engine: when this device last changed synced data. */
export const LOCAL_MODIFIED_KEY = 'day-planner-cloud-sync-local-modified';

/**
 * Classifies the raw text a transport read.
 *
 * @param {string|null|undefined} str
 * @returns {{kind: 'absent'}
 *        | {kind: 'unparseable'}
 *        | {kind: 'downloading'}
 *        | {kind: 'error', error: string}
 *        | {kind: 'snapshot', remote: object}}
 */
export function classifySnapshotText(str) {
  if (!str || str === 'null') return { kind: 'absent' };
  let remote;
  try { remote = JSON.parse(str); } catch { return { kind: 'unparseable' }; }
  if (remote?.downloading) return { kind: 'downloading' };
  if (remote?.error) return { kind: 'error', error: String(remote.error) };
  return { kind: 'snapshot', remote };
}

const count = (storage, key) => {
  try { return JSON.parse(storage.getItem(key) || '[]').length; }
  catch { return 0; }
};

/**
 * Runs one cycle. Never throws for a transport outcome; a thrown error from
 * `io` (a bug) propagates so the caller's `finally` still releases its lock.
 *
 * @param {object} args
 * @param {object} args.transport
 * @param {string}   args.transport.id                     for log lines
 * @param {() => Promise<string|null>} args.transport.read
 * @param {(text: string) => Promise<boolean>} args.transport.write
 * @param {string}   args.transport.lastSyncedKey          storage key this transport stamps
 * @param {() => boolean} args.transport.firstRunDecided   has the user answered the restore prompt
 * @param {number}   args.transport.writeThrottleMs
 * @param {boolean}  args.transport.allowsPlaintextReseed  may an undecryptable envelope be overwritten
 * @param {object} args.io
 * @param {() => object} args.io.buildSyncPayload          `{ version, lastModified?, data }`
 * @param {(data: object, opts: {allowEmpty: boolean}) => void} args.io.applyEngineData
 * @param {(local: object, remote: object, retentionDays: number) => {data: object, localChanged: boolean, remoteChanged: boolean}} args.io.mergeSyncData
 * @param {(payload: object, habits: Array) => object} args.io.stripHealthSourcedLogs
 * @param {Array}    args.io.habits
 * @param {number}   args.io.syncRetentionDays
 * @param {(envelope: object) => boolean} args.io.isEncryptedEnvelope
 * @param {(envelope: object) => Promise<object>} args.io.decryptData
 * @param {Storage}  args.io.storage                        localStorage-like
 * @param {() => number} [args.io.now]
 * @param {Console}  [args.io.log]
 * @param {{missingSince: number, lastWriteAt: number}} args.state  carried between cycles
 * @returns {Promise<{state: {missingSince: number, lastWriteAt: number}, outcome: object}>}
 *   outcome.kind is one of:
 *     'skipped'   (reason: 'missing-grace' | 'empty-state-guard' | 'downloading' |
 *                  'unparseable' | 'no-data' | 'encrypted-unreadable')
 *     'seeded'    the absent file was written from local data (wrote: boolean)
 *     'reseeded'  an undecryptable envelope was replaced with local plaintext
 *     'error'     (reason: 'unavailable', error) the transport reported an error
 *     'prompted'  (info) a first-run restore choice is needed; nothing was written
 *     'merged'    (localChanged, remoteChanged, wrote)
 */
export async function runSnapshotFileCycle({ transport, io, state }) {
  const log = io.log ?? console;
  const now = io.now ?? Date.now;
  const next = { missingSince: state?.missingSince ?? 0, lastWriteAt: state?.lastWriteAt ?? 0 };

  // Writing faster than the daemon's round-trip piles conflict versions onto
  // the remote; skip writes inside the window. The next poll re-runs the merge
  // and writes any genuinely deferred change. The stamp is taken before the
  // write so a failing write is throttled like a succeeding one.
  const throttledWrite = async (text) => {
    if (now() - next.lastWriteAt < transport.writeThrottleMs) return false;
    next.lastWriteAt = now();
    const ok = await transport.write(text);
    if (!ok) log.error(`[${transport.id}] snapshot write failed`);
    return ok;
  };
  const outgoing = (payload) => JSON.stringify(io.stripHealthSourcedLogs(payload, io.habits));

  const read = classifySnapshotText(await transport.read());

  if (read.kind === 'absent') {
    // No remote file yet — seed it with local data, but only if the absence is
    // real (not a transient eviction) and state is hydrated: if React state is
    // empty while localStorage has tasks, seeding would wipe the remote copy.
    const missing = evaluateMissingSnapshot({
      hasSyncedBefore: !!io.storage.getItem(transport.lastSyncedKey),
      missingSince: next.missingSince,
      now: now(),
    });
    next.missingSince = missing.missingSince;
    if (missing.skip) return { state: next, outcome: { kind: 'skipped', reason: 'missing-grace' } };
    const localCount = count(io.storage, 'day-planner-tasks') + count(io.storage, 'day-planner-unscheduled');
    const payload = io.buildSyncPayload();
    const payloadCount = (payload.data?.tasks?.length || 0) + (payload.data?.unscheduledTasks?.length || 0);
    if (localCount > 0 && payloadCount === 0) {
      return { state: next, outcome: { kind: 'skipped', reason: 'empty-state-guard' } };
    }
    const wrote = await throttledWrite(outgoing(payload));
    return { state: next, outcome: { kind: 'seeded', wrote } };
  }

  // Exists but is still coming down from the cloud, or is mid-write by the
  // daemon: let the next poll retry.
  if (read.kind === 'downloading') return { state: next, outcome: { kind: 'skipped', reason: 'downloading' } };
  if (read.kind === 'unparseable') return { state: next, outcome: { kind: 'skipped', reason: 'unparseable' } };
  if (read.kind === 'error') {
    return { state: next, outcome: { kind: 'error', reason: 'unavailable', error: read.error } };
  }

  let remote = read.remote;
  if (io.isEncryptedEnvelope(remote)) {
    try { remote = await io.decryptData(remote); }
    catch (decErr) {
      log.warn(`[${transport.id}] encrypted snapshot could not be decrypted:`, decErr?.message ?? decErr);
      remote = null;
    }
    if (!remote?.data) {
      if (!transport.allowsPlaintextReseed) {
        // Someone else's cloud folder: never downgrade a file we cannot read.
        return { state: next, outcome: { kind: 'skipped', reason: 'encrypted-unreadable' } };
      }
      const wrote = await throttledWrite(outgoing(io.buildSyncPayload()));
      return { state: next, outcome: { kind: 'reseeded', wrote } };
    }
  }
  if (!remote?.data) return { state: next, outcome: { kind: 'skipped', reason: 'no-data' } };

  // A real snapshot came back, so the transport demonstrably works from this
  // device. Record that — it is what a later absence is measured against — and
  // record it BEFORE the first-run prompt: reading the snapshot is what proves
  // the transport works, whatever the user then chooses to do with it.
  io.storage.setItem(transport.lastSyncedKey, new Date(now()).toISOString());
  next.missingSince = 0;

  // First launch on a device with no data of its own, facing a populated
  // remote copy. Ask instead of restoring silently (utils/icloudSyncPref.js).
  const localData = io.buildSyncPayload().data;
  if (shouldPromptFirstRun({
    decided: transport.firstRunDecided(),
    remoteHasData: payloadHasData(remote.data),
    localHasData: payloadHasData(localData),
    icloudAvailable: true,
  })) {
    return {
      state: next,
      outcome: {
        kind: 'prompted',
        info: {
          taskCount: remote.data.tasks?.length ?? 0,
          inboxCount: remote.data.unscheduledTasks?.length ?? 0,
          lastModified: remote.lastModified ?? null,
        },
      },
    };
  }

  const { data: mergedData, localChanged, remoteChanged } =
    io.mergeSyncData(localData, remote.data, io.syncRetentionDays);

  if (localChanged) {
    // Apply the FULL merged data locally (health-sourced counts stay on-device).
    io.applyEngineData(mergedData, { allowEmpty: !!remote.lastModified });
    io.storage.setItem(LOCAL_MODIFIED_KEY, new Date(now()).toISOString());
  }
  let wrote = false;
  if (remoteChanged || localChanged) {
    wrote = await throttledWrite(outgoing({
      version: 2,
      lastModified: new Date(now()).toISOString(),
      data: mergedData,
    }));
  }
  return { state: next, outcome: { kind: 'merged', localChanged, remoteChanged, wrote } };
}
