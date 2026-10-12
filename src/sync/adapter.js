// dayGLANCE adapter for @glance-apps/sync.
//
// Pins every dayGLANCE-specific engine config (storage prefixes, file names,
// app identity, native bridge wiring) and the two safety validators that
// previously lived inline in App.jsx (the empty-payload upload guard and the
// empty-merge apply guard). The four data callbacks (buildPayload,
// buildBackupPayload, applyPayload) plus all event callbacks come from App.jsx
// — they close over React state that this module deliberately does not see.

import { createSyncEngine } from '@glance-apps/sync';
import { mergeSyncData } from '../mergeSync.js';
import { nativeHttpRequest } from '../native.js';
import {
  createAbsentRemoteSeedGuard,
  installAbsentRemoteSeedGuard,
} from './absentRemoteSeedGuard.js';

const isNativeApp =
  typeof window !== 'undefined' &&
  !!window.DayGlanceNative?.httpRequest;

const electronProxyFetch =
  typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? (...args) => window.electronAPI.proxyFetch(...args)
    : null;

const DAYGLANCE_CONFIG = {
  storageKeyPrefix:     'day-planner',
  cryptoDBName:         'dayglance-crypto',
  autoBackupDBName:     'dayglance-auto-backups',
  syncFilename:         'dayglance-sync.json',
  backupFilenamePrefix: 'dayglance-backup-',
  appId:                'dayglance',
  appName:              'dayGLANCE',

  nativeHttpRequest: isNativeApp ? nativeHttpRequest : null,
  electronProxyFetch,
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL ?? '',

  nativeGetSyncKey:
    isNativeApp && window?.DayGlanceNative?.getSyncKey
      ? () => window.DayGlanceNative.getSyncKey()
      : null,
  nativeStoreSyncKey:
    isNativeApp && window?.DayGlanceNative?.storeSyncKey
      ? (val) => window.DayGlanceNative.storeSyncKey(val)
      : null,
};

// The file engine's own "this device has completed a sync" key
// (`${storageKeyPrefix}-cloud-sync-last-synced`). It is what the seed guard
// reads to tell a first run from an absence on a device whose remote copy is
// known to have existed. Derived from the prefix so the two cannot drift.
const LAST_SYNCED_KEY = `${DAYGLANCE_CONFIG.storageKeyPrefix}-cloud-sync-last-synced`;

// Mirrors App.jsx 4799-4806 pre-extraction. Refuses to upload an empty payload
// when localStorage still has data — a sign of a stale-state race that would
// otherwise wipe the remote.
//
// The absent-remote seed guard rides the same seam: it refuses the engine's
// "the remote file is 404, so seed it from local state" write on a device that
// has synced before, until the absence outlasts its grace window. Both are
// refusals of a write that would otherwise be unconditional, and the engine
// treats either one as "nothing was written, so this cycle is not a success".
const validateUploadPayload = (envelope, seedGuard, report) => {
  // Consume the read observation for THIS upload whatever the verdict, so an
  // absence can never be judged against a later upload it did not precede.
  const seed = seedGuard ? seedGuard.decideUpload() : { allowed: true };

  const localTaskCount   = JSON.parse(localStorage.getItem('day-planner-tasks')        || '[]').length;
  const localInboxCount  = JSON.parse(localStorage.getItem('day-planner-unscheduled')  || '[]').length;
  const payloadTaskCount = (envelope.data?.tasks?.length || 0) + (envelope.data?.unscheduledTasks?.length || 0);
  if (localTaskCount + localInboxCount > 0 && payloadTaskCount === 0) {
    return {
      valid: false,
      reason: `payload has 0 tasks but localStorage has ${localTaskCount + localInboxCount}`,
    };
  }

  if (!seed.allowed) {
    report?.hold?.(seed.reason);
    return { valid: false, reason: seed.reason };
  }
  return { valid: true };
};

// Mirrors App.jsx 4858-4864 pre-extraction. Refuses to apply an empty merge
// result when local has data unless the remote claimed a real lastModified
// (an intentional "delete everything" propagation, allowEmpty:true).
const validateApplyPayload = async (envelope) => {
  const localTaskCount  = JSON.parse(localStorage.getItem('day-planner-tasks')       || '[]').length;
  const localInboxCount = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]').length;
  const remoteTaskCount = (envelope.data?.tasks?.length || 0) + (envelope.data?.unscheduledTasks?.length || 0);
  if (!envelope.lastModified && localTaskCount + localInboxCount > 0 && remoteTaskCount === 0) {
    return {
      valid: false,
      reason: `remote has 0 tasks but local has ${localTaskCount + localInboxCount}`,
    };
  }
  return { valid: true };
};

/**
 * Build the dayGLANCE sync engine.
 *
 * @param {object} callbacks - data + event callbacks from App.jsx
 * @param {() => object|Promise<object>}          callbacks.buildPayload
 * @param {() => object|Promise<object>}          callbacks.buildBackupPayload
 * @param {(data, opts) => void|Promise<void>}    callbacks.applyPayload
 * @param {(status) => void}                      callbacks.onStatusChange
 * @param {(msg, code, isHardStop) => void}       callbacks.onError
 * @param {(iso) => void}                         callbacks.onLastSyncedChange
 * @param {(remoteData, remoteMod, etag) => void} callbacks.onConflict
 * @param {() => void}                            callbacks.onPassphraseRequired
 * @param {() => void}                            callbacks.onFirstSyncReload
 * @param {() => number}                          callbacks.getSyncRetentionDays
 * @param {object} [options]
 * @param {string} [options.appFolderName]        the sync folder in the server
 * @param {Record<string, object>} [options.providers]  transport override, for
 *   tests that script a provider; the engine builds its own when unset
 */
export const createDayGlanceEngine = (callbacks, { appFolderName = 'GLANCE/dayglance', providers: providerOverrides } = {}) => {
  // One guard per engine: the absence streak belongs to the configured folder,
  // and App.jsx rebuilds the engine when that folder changes.
  const absentRemoteSeedGuard = createAbsentRemoteSeedGuard({
    hasSyncedBefore: () => !!localStorage.getItem(LAST_SYNCED_KEY),
  });

  const engine = createSyncEngine({
    ...DAYGLANCE_CONFIG,
    appFolderName,
    buildPayload:        callbacks.buildPayload,
    buildBackupPayload:  callbacks.buildBackupPayload,
    applyPayload:        callbacks.applyPayload,
    mergePayloads:       (local, remote) => mergeSyncData(local, remote, callbacks.getSyncRetentionDays()),
    validateUploadPayload: (envelope) => validateUploadPayload(envelope, absentRemoteSeedGuard, {
      // The engine reports a refused upload as a quiet non-success — status
      // 'idle', nothing surfaced — and App.jsx drops an 'idle' that arrives while
      // the status still reads 'downloading'/'uploading', so a hold would leave
      // the UI on "syncing…" indefinitely. Move the status off the in-flight pair
      // first; the engine's own 'idle' then lands on top of it.
      hold: (reason) => {
        callbacks.onStatusChange?.('error');
        callbacks.onError?.(reason, 'ABSENT_REMOTE_HOLD', false);
      },
    }),
    validateApplyPayload,
    onStatusChange:      callbacks.onStatusChange,
    onError:             callbacks.onError,
    onLastSyncedChange:  callbacks.onLastSyncedChange,
    onConflict:          callbacks.onConflict,
    onPassphraseRequired: callbacks.onPassphraseRequired,
    onFirstSyncReload:   callbacks.onFirstSyncReload,
    retentionDays:       callbacks.getSyncRetentionDays(),
  });

  // Transport override — a scripted provider injected by tests, the same seam
  // dbEngine.js takes as `callbacks.fetchImpl`. Applied BEFORE the seed guard is
  // installed so the production path wraps the injected transport too, rather
  // than the test wrapping it on its own and proving nothing. The engine builds
  // its own providers when this is unset, and `engine.providers` IS the map the
  // engine reads (the package returns it by reference).
  if (providerOverrides) Object.assign(engine.providers, providerOverrides);

  installAbsentRemoteSeedGuard(engine.providers, absentRemoteSeedGuard);
  return engine;
};
