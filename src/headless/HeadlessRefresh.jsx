// The headless refresh root (CLAUDE.md, "Headless refresh"): what the Android
// shell runs in an Activity-less WebView, on the launcher's REFRESH, while the
// app's process is dead. One cycle of every configured sync tier, then the
// launcher snapshot and heartbeat are re-pushed and the outcome is reported.
//
// This root is an ALLOWLIST, not App with features switched off. It composes
// only:
//   - the data layer: the store (useHeadlessStore), loadData and saveData
//     (useDataPersistence, useSaveOnChange), the day windows and the JOBO
//     ledger, which the sync apply writes through;
//   - both sync tiers: the file-tier engine (sync/adapter.js) and the
//     GLANCEvault engine (sync/dbEngine.js), with the same payload and apply
//     the app uses (hooks/useSyncEngineData.js);
//   - the launcher snapshot and heartbeat push (utils/launcherSnapshot.js,
//     utils/launcherHeartbeat.js).
// Nothing else initialises: no calendar fetch, no Obsidian, no reminders, no
// weather, no widgets, no intents, no UI. The native side holds the same
// line: its HeadlessBridge exposes only HEADLESS_BRIDGE_METHODS, so a module
// that did boot here would find no method, not a side effect.
//
// The reverse lock: if the user opens the app while this runs, the live
// instance must not share storage with a half-finished cycle. The choice is
// SIGNAL ABORT, not wait: the shell destroys this WebView before the live one
// loads (LauncherRefreshWorker.abortForLiveInstance), and this root also asks
// `headlessShouldAbort` at each phase boundary. The live instance's own start
// runs a cycle anyway, so nothing is lost by stopping; waiting would hold the
// splash for up to the cap for a result the app is about to produce itself.
// A run has no local edits to protect, which is what makes aborting cheap.

import { useCallback, useEffect, useRef, useState } from 'react';
import useHeadlessStore from './useHeadlessStore.js';
import { HEADLESS_OUTCOMES, headlessRequest } from './headlessMode.js';
import useCloudSync from '../hooks/useCloudSync.js';
import useDataPersistence from '../hooks/useDataPersistence.js';
import useSaveOnChange from '../hooks/useSaveOnChange.js';
import useDayWindows from '../hooks/useDayWindows.js';
import useJoboLedger from '../hooks/useJoboLedger.js';
import useSyncEngineData from '../hooks/useSyncEngineData.js';
import { createDayGlanceEngine } from '../sync/adapter.js';
import { createDbEngine } from '../sync/dbEngine.js';
import { registerDbEngine } from '../sync/dirtyTracker.js';
import { isVaultEnabled } from '../sync/vaultConfig.js';
import { normalizeSyncFolder } from '../utils/syncFolder.js';
import { buildLauncherSnapshot } from '../utils/launcherSnapshot.js';
import { latestSyncedAt } from '../utils/launcherHeartbeat.js';
import { nativeBridge, nativeTouchLauncherHeartbeat, nativeRecordLauncherRefresh } from '../native.js';
import { readLauncherLedger } from '../intents/launcherWrites.js';
import { expandRecurringTasks } from '../utils/expandRecurringTasks.js';
import { computeRecurringExpansionRange } from '../utils/recurringExpansionRange.js';
import { frameInstancesForDate } from '../utils/frameInstances.js';
import { isTaskVisibleForUser, isOwnedBy } from '../utils/userScope.js';
import { readWeekStartDay } from '../utils/storedSlices.js';
import { getStoredWeatherCoords } from '../utils/solar.js';
import { loadAlarmPrefs } from '../utils/dialPrefs.js';
import { dateToString } from '../utils/taskUtils.js';

const noop = () => {};
const identity = (s) => s;
/** App's SCHED window default; it only widens the recurring expansion range. */
const SCHED_DAYS_SHOWN = 14;

/**
 * @param {object} props
 * @param {string} [props.clientId]  the REFRESH being answered; from the query by default
 * @param {() => object} [props.bridge]  the native bridge (window.DayGlanceNative)
 * @param {Function} [props.createFileEngine]  test seam for sync/adapter.js
 * @param {Function} [props.createVaultEngine] test seam for sync/dbEngine.js
 * @param {() => Date} [props.now]
 */
export default function HeadlessRefresh({
  clientId: clientIdProp,
  bridge = nativeBridge,
  createFileEngine = createDayGlanceEngine,
  createVaultEngine = createDbEngine,
  now = () => new Date(),
} = {}) {
  const clientId = clientIdProp ?? headlessRequest(window.location?.search ?? '')?.clientId ?? '';
  const store = useHeadlessStore();
  const {
    dataLoaded, tasks, unscheduledTasks, recurringTasks, multiUserEnabled, meUserSyncId,
    gtdFrames, todayRoutines: allTodayRoutines, routineCompletions, routinesEnabled,
    projects, goals, goalsProjectsEnabled, weatherTempUnit, use24HourClock, syncRetentionDays,
  } = store;

  // ── Data layer ───────────────────────────────────────────────────────────
  const {
    cloudSyncConfig, syncKeyReady,
    suppressCloudUploadRef, suppressTimestampRef, suppressClearPendingRef, cloudSyncInitialDoneRef,
  } = useCloudSync();
  const { dayWindowsRef, getDayWindow, applyRemoteDayWindows } = useDayWindows();
  const { joboRecords, joboLoaded, joboError, applyRemoteJobo } = useJoboLedger();
  const joboRecordsRef = useRef(joboRecords);
  joboRecordsRef.current = joboRecords;
  const tasksLiveRef = useRef(tasks);
  tasksLiveRef.current = tasks;
  const unscheduledLiveRef = useRef(unscheduledTasks);
  unscheduledLiveRef.current = unscheduledTasks;
  const applyingRemoteDataRef = useRef(false);
  const isRemoteApply = () => applyingRemoteDataRef.current || suppressCloudUploadRef.current;

  const { loadData, saveData, stampTaskTimestamps } = useDataPersistence({
    ...store,
    todayRoutines: allTodayRoutines,
    cloudSyncConfig, cloudSyncInitialDoneRef, suppressTimestampRef,
    setUndoToast: noop, t: identity, isRemoteApply,
  });
  useSaveOnChange({
    ...store,
    todayRoutines: allTodayRoutines,
    saveData, checkConflicts: noop,
    suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
  });

  // ── Sync tiers ───────────────────────────────────────────────────────────
  const { buildSyncPayload, applyEngineData } = useSyncEngineData({
    ...store,
    allTodayRoutines,
    dayWindowsRef, joboRecordsRef, tasksLiveRef, unscheduledLiveRef,
    applyingRemoteDataRef, suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
    applyRemoteDayWindows, applyRemoteJobo, stampTaskTimestamps,
  });
  // The engines call through this ref so they always run the latest closures.
  const callbacksRef = useRef({});
  callbacksRef.current = { buildSyncPayload, applyEngineData, multiUserEnabled, syncRetentionDays };

  // What stopped a cycle, when the engine reports it rather than throwing:
  // a first-sync conflict, a missing passphrase, a transport error.
  const blockerRef = useRef(null);
  const fileEngineRef = useRef(null);
  const syncFolder = normalizeSyncFolder(cloudSyncConfig?.syncFolder);
  if (!fileEngineRef.current && cloudSyncConfig?.enabled) {
    fileEngineRef.current = createFileEngine({
      buildPayload: () => callbacksRef.current.buildSyncPayload(),
      buildBackupPayload: () => callbacksRef.current.buildSyncPayload(),
      applyPayload: (data, opts) => callbacksRef.current.applyEngineData(data, opts),
      onStatusChange: noop,
      onError: (msg, code) => { blockerRef.current = `file tier: ${code || ''} ${msg || ''}`.trim(); },
      onLastSyncedChange: noop,
      onConflict: () => { blockerRef.current = 'file tier: first sync needs the user to resolve a conflict'; },
      onPassphraseRequired: () => { blockerRef.current = 'passphrase required'; },
      // The app reloads to show the remote data; here it is already in state.
      onFirstSyncReload: noop,
      getSyncRetentionDays: () => callbacksRef.current.syncRetentionDays ?? 90,
    }, { appFolderName: syncFolder });
  }

  const vaultEngineRef = useRef(null);
  useEffect(() => {
    if (!dataLoaded || !isVaultEnabled()) return;
    const engine = createVaultEngine({
      getData: () => callbacksRef.current.buildSyncPayload()?.data,
      commitData: (data) => callbacksRef.current.applyEngineData(data, { allowEmpty: true }),
      isMultiUserEnabled: () => callbacksRef.current.multiUserEnabled === true,
      onStatusChange: noop,
      onError: (msg, code) => { blockerRef.current = `vault: ${code || ''} ${msg || ''}`.trim(); },
      onRowsSkipped: noop,
    });
    if (!engine) return;
    vaultEngineRef.current = engine;
    registerDbEngine(engine);
    return () => {
      registerDbEngine(null);
      engine.dispose?.();
      vaultEngineRef.current = null;
    };
  }, [dataLoaded, createVaultEngine]);

  // ── The run ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('loading'); // loading | syncing | synced | done
  const startedAtRef = useRef(null);
  // One cycle per root, whatever React does with effects (StrictMode re-runs them).
  const startedRef = useRef(false);

  const touchHeartbeat = useCallback(() => {
    const fileTier = cloudSyncConfig?.enabled ? fileEngineRef.current?.getLastSynced?.() : null;
    const dbTier = vaultEngineRef.current?.getLastSynced?.() ?? null;
    nativeTouchLauncherHeartbeat({ checkedAt: Date.now(), syncedAt: latestSyncedAt(fileTier, dbTier) });
  }, [cloudSyncConfig?.enabled]);

  const finish = useCallback((outcome, extra = {}) => {
    const durationMs = Date.now() - (startedAtRef.current ?? Date.now());
    touchHeartbeat();
    const entry = { clientId, outcome, durationMs, ...extra };
    nativeRecordLauncherRefresh(entry);
    try { bridge()?.headlessDone?.(JSON.stringify(entry)); } catch { /* the shell owns the cap */ }
    setPhase('done');
  }, [bridge, clientId, touchHeartbeat]);

  const shouldAbort = useCallback(() => {
    try { return bridge()?.headlessShouldAbort?.() === true; } catch { return false; }
  }, [bridge]);

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every tier, awaited; the same pass the alive path runs for REFRESH.
  useEffect(() => {
    if (phase !== 'loading' || !dataLoaded || syncKeyReady === null) return;
    if (!joboLoaded && !joboError) return; // the ledger is a quick read; a failed one is held, not waited on
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase('syncing');
    startedAtRef.current = Date.now();
    (async () => {
      if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
      if (syncKeyReady === false) return finish(HEADLESS_OUTCOMES.FAILED, { reason: 'passphrase required' });
      // One tier after the other, never side by side: each apply replaces
      // the task lists whole, so two applies in flight would each build from
      // state the other was about to change and the later one would drop
      // what the earlier pulled. The file tier runs first and the vault then
      // sees its result in the payload.
      const jobs = [];
      if (cloudSyncConfig?.enabled && fileEngineRef.current?.sync) jobs.push(() => fileEngineRef.current.sync());
      if (vaultEngineRef.current?.dbSyncCycle) jobs.push(() => vaultEngineRef.current.dbSyncCycle());
      if (jobs.length === 0) return finish(HEADLESS_OUTCOMES.FAILED, { reason: 'no sync tier is configured' });
      try {
        for (const job of jobs) await job();
      } catch (err) {
        return finish(HEADLESS_OUTCOMES.FAILED, { reason: err?.message || String(err) });
      }
      if (blockerRef.current) return finish(HEADLESS_OUTCOMES.FAILED, { reason: blockerRef.current });
      if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
      // The apply's state updates are committed before the next effect pass.
      setPhase('synced');
    })();
    // Keyed on readiness only: the cycle runs once (startedRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dataLoaded, syncKeyReady, joboLoaded, joboError]);

  // After the cycle: the snapshot from settled state, then the outcome.
  // Declared after useSaveOnChange, so the save pass has already run for this
  // commit when it reads state.
  useEffect(() => {
    if (phase !== 'synced') return;
    try {
      const nowDate = now();
      const todayStr = dateToString(nowDate);
      const isVisibleForUser = (task) => isTaskVisibleForUser(task, multiUserEnabled, meUserSyncId);
      const ownedBy = (item) => isOwnedBy(item, multiUserEnabled, meUserSyncId);
      const { rangeStart, rangeEnd } = computeRecurringExpansionRange({
        selectedDate: nowDate, today: nowDate, schedDaysShown: SCHED_DAYS_SHOWN, weekStartDay: readWeekStartDay(),
      });
      const snapshot = buildLauncherSnapshot({
        now: nowDate, todayStr,
        tasks, unscheduledTasks,
        expandedRecurringTasks: recurringTasks.length ? expandRecurringTasks(recurringTasks, { rangeStart, rangeEnd, today: todayStr }) : [],
        projects, goals, goalsProjectsEnabled, isVisibleForUser,
        todayRoutines: allTodayRoutines.filter(ownedBy), routineCompletions, routinesEnabled,
        frameInstancesForDate: (date) => frameInstancesForDate(gtdFrames.filter(ownedBy), dateToString(date)),
        getDayWindow,
        weatherCoords: getStoredWeatherCoords(),
        // No weather fetch in a headless run: the shell keeps the last
        // snapshot's weather when a new one carries none.
        weatherHourlyByDate: null,
        weatherTempUnit,
        dialAlarm: loadAlarmPrefs(),
        use24Hour: use24HourClock,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        updatedAt: Date.now(),
        handledWrites: readLauncherLedger(),
      });
      if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
      bridge()?.updateLauncherSnapshot?.(JSON.stringify(snapshot));
      finish(HEADLESS_OUTCOMES.RAN);
    } catch (err) {
      finish(HEADLESS_OUTCOMES.FAILED, { reason: `snapshot: ${err?.message || err}` });
    }
    // The snapshot is built once, from the state of the commit that settled the cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return null;
}
