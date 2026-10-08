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
 *   • health-store counts are stripped from every copy written out, on the
 *     transports that ask for it (`transport.stripsHealthLogs`): iCloud does,
 *     for Apple's guideline 5.1.3; Direct Access is someone else's folder and
 *     carries them, exactly as GLANCEvault and WebDAV do;
 *   • a write happens only when what would be written differs from the file,
 *     and an apply only when the merged data differs from local state. The
 *     merge's own flags are necessary, not sufficient: with the strip above
 *     they fired on every cycle of every Mac holding health counts, and the
 *     resulting identical rewrites starved every phone (2026-10-05);
 *   • a change made on this device is written at once; a change that reached
 *     this device by another road is only relayed once the file has sat
 *     unchanged, still lacking it, for RELAY_CONFIRM_MS. A change reaches a
 *     device by two roads at different speeds, GLANCEvault in seconds and the
 *     folder's syncing tool in tens of seconds, so the second Mac learned of
 *     an iPhone's edit from the vault, found its folder copy stale, wrote the
 *     same data with a fresh stamp, and Nextcloud reported a conflict on
 *     every change (2026-10-08). Deferring every write by one poll did not
 *     help: it held the originating device's write back too, which only
 *     lengthened the window in which the others relayed it. "Made here" is
 *     the device's own last-edit stamp (LOCAL_EDIT_KEY, set by the persist
 *     pass for an edit and not for an apply) being newer than this device's
 *     last write to, or before that last read of, this file.
 *
 * Nothing here touches React. The hook (hooks/useSnapshotFileSync.js) owns the
 * poll, the mutex and the prompt state; App.jsx owns i18n and status UI.
 */

import { evaluateMissingSnapshot } from '../utils/icloudSeedGuard.js';
import { shouldPromptFirstRun, payloadHasData } from '../utils/icloudSyncPref.js';
import { sliceDiffs, writeWorthy } from './snapshotMergeExplain.js';

/** Shared with the WebDAV engine: when this device last changed synced data. */
export const LOCAL_MODIFIED_KEY = 'day-planner-cloud-sync-local-modified';

/**
 * When this device itself last changed its data. Set by the persist pass for
 * an edit made here and not for an apply from a transport
 * (hooks/useDataPersistence.js). Device-local, never synced.
 */
export const LOCAL_EDIT_KEY = 'day-planner-local-edit-at';

/**
 * How long a change that reached this device by another road must stay
 * missing from an unchanged file before this device relays it. Longer than
 * the folder's syncing tool takes to deliver the originating device's own
 * write (Nextcloud's desktop client polls every 30 s without push), so the
 * relay only happens when nobody else carried it.
 */
export const RELAY_CONFIRM_MS = 90 * 1000;

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
 * @param {boolean}  [args.transport.stripsHealthLogs=true]  strip health-store counts from what is written
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
 * @param {() => string|null} [args.io.lastLocalEditAt]      when this device itself last changed its data (default: LOCAL_EDIT_KEY in storage)
 * @param {() => number} [args.io.now]
 * @param {Console}  [args.io.log]
 * @param {{missingSince: number, lastWriteAt: number, lastWrittenAt?: number, pendingWrite?: {fingerprint: string, at: number}|null}} args.state  carried between cycles
 * @returns {Promise<{state: {missingSince: number, lastWriteAt: number, lastWrittenAt: number, pendingWrite: object|null}, outcome: object}>}
 *   outcome.kind is one of:
 *     'skipped'   (reason: 'missing-grace' | 'empty-state-guard' | 'downloading' |
 *                  'unparseable' | 'no-data' | 'encrypted-unreadable')
 *     'seeded'    the absent file was written from local data (wrote: boolean)
 *     'reseeded'  an undecryptable envelope was replaced with local plaintext
 *     'error'     (reason: 'unavailable', error) the transport reported an error
 *     'prompted'  (info) a first-run restore choice is needed; nothing was written
 *     'merged'    (localChanged, remoteChanged, applied, wrote, deferred, ownEdits)
 *                 deferred: a relay is wanted and waits for the file to catch up
 *                 ownEdits: this device has a change of its own not yet written
 */
export async function runSnapshotFileCycle({ transport, io, state }) {
  const log = io.log ?? console;
  const now = io.now ?? Date.now;
  const next = {
    missingSince: state?.missingSince ?? 0,
    lastWriteAt: state?.lastWriteAt ?? 0,
    // The last SUCCESSFUL write to this file (lastWriteAt counts attempts, for
    // the throttle), or before any, the read before this cycle: the baseline
    // an edit made here has to be newer than to count as not yet written.
    lastWrittenAt: state?.lastWrittenAt ?? 0,
    pendingWrite: state?.pendingWrite ?? null,
  };
  const lastLocalEdit = (() => {
    try {
      const v = io.lastLocalEditAt ? io.lastLocalEditAt() : io.storage.getItem(LOCAL_EDIT_KEY);
      const t = v ? new Date(v).getTime() : NaN;
      return Number.isFinite(t) ? t : 0;
    } catch { return 0; }
  })();

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
  // Apple forbids HealthKit-derived data in iCloud (guideline 5.1.3), so the
  // iCloud transport strips health-store counts from what it writes. The rule
  // is Apple's and about Apple's container: a Direct Access folder is the
  // user's own cloud, and stripping there is what kept an Android phone's
  // Health Connect steps from ever reaching the Macs (2026-10-07). The vault
  // and WebDAV tiers carry those counts; this tier does too, unless the
  // transport says otherwise. Absent means strip, so a transport that does not
  // know the property keeps the stricter behaviour.
  const strip = transport.stripsHealthLogs === false
    ? (payload) => payload
    : (payload) => io.stripHealthSourcedLogs(payload, io.habits);
  const outgoing = (payload) => JSON.stringify(strip(payload));

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
  const previousRead = (() => {
    try { const v = io.storage.getItem(transport.lastSyncedKey); const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : 0; }
    catch { return 0; }
  })();
  io.storage.setItem(transport.lastSyncedKey, new Date(now()).toISOString());
  next.missingSince = 0;
  if (!next.lastWrittenAt) next.lastWrittenAt = previousRead;

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

  // The merge's flags say whether it picked anything from either side. They do
  // NOT say whether the file or the device would actually change, and the two
  // questions differ: the iCloud write strips HealthKit-derived habit counts
  // (utils/healthLogFilter.js), so a device that holds those counts (any Mac
  // receiving them through GLANCEvault) sees them "missing" from the file on
  // every cycle, and the flag alone rewrote an identical stripped file every
  // 15 s on every Mac in a fleet — which kept every phone's copy non-current
  // and its edits stuck for minutes (2026-10-05). So a write needs a flag AND
  // a real difference between what would be written and the file; an apply
  // needs the flag AND a real difference between the merged data and local
  // state. sync/snapshotMergeExplain.js is that comparison, and the iCloud
  // diagnostics panel runs the identical function. An order-only difference
  // does not count for the write: the merge keeps each device's own order,
  // so writing it changes nothing on the other device (writeWorthy).
  const outPayload = strip({
    version: 2,
    lastModified: new Date(now()).toISOString(),
    data: mergedData,
  });
  const applyNeeded = localChanged && sliceDiffs(mergedData, localData, { ignoreDropped: true }).length > 0;
  const writable = (remoteChanged || localChanged) ? writeWorthy(sliceDiffs(outPayload.data, remote.data)) : [];
  const writeNeeded = writable.length > 0;

  if (applyNeeded) {
    // Apply the FULL merged data locally (health-sourced counts stay on-device).
    io.applyEngineData(mergedData, { allowEmpty: !!remote.lastModified });
    io.storage.setItem(LOCAL_MODIFIED_KEY, new Date(now()).toISOString());
  }

  // Made here, or relayed (header). A change of this device's own goes out
  // now. Anything else is relayed only after the file has sat unchanged,
  // still lacking it, for RELAY_CONFIRM_MS: what was seen (the differences a
  // write would resolve, against the file version they were seen on) has to
  // be seen again that much later. A different file version starts over,
  // since the slower road may just have delivered it.
  const ownEdits = lastLocalEdit > next.lastWrittenAt;
  let wrote = false;
  let deferred = false;
  if (writeNeeded && ownEdits) {
    wrote = await throttledWrite(JSON.stringify(outPayload));
    if (wrote) next.lastWrittenAt = now();
    next.pendingWrite = null;
  } else if (writeNeeded) {
    const fingerprint = `${remote.lastModified ?? ''}\u0000${writable.map((d) => d.summary).join('\n')}`;
    const pending = next.pendingWrite;
    if (pending && pending.fingerprint === fingerprint && now() - pending.at >= RELAY_CONFIRM_MS) {
      wrote = await throttledWrite(JSON.stringify(outPayload));
      if (wrote) next.lastWrittenAt = now();
    } else {
      if (!pending || pending.fingerprint !== fingerprint) next.pendingWrite = { fingerprint, at: now() };
      deferred = true;
    }
  } else {
    next.pendingWrite = null;
  }
  return {
    state: next,
    outcome: { kind: 'merged', localChanged, remoteChanged, applied: applyNeeded, wrote, deferred, ownEdits },
  };
}
