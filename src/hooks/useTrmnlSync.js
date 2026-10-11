import { useState, useRef, useEffect } from 'react';
import { gatherTrmnlData, pushToTrmnl } from '../trmnl.js';
import {
  readTrmnlPushState, writeTrmnlPushState,
  trmnlContentFingerprint, trmnlPushDecision, trmnlBackoffAfterRateLimit,
} from '../utils/trmnlPushPolicy.js';
import { isTrayMode } from '../utils/trayMode.js';
import { notBucketed } from '../utils/bucketList.js';
import { dateToString } from '../utils/taskUtils.js';

/**
 * The TRMNL e-ink dashboard: its config and status, and the push of today's
 * data to its webhook (trmnl.js), gated by utils/trmnlPushPolicy.js.
 *
 * Takes the data a push is built from, deps-object style. Returns the state
 * the Settings panels show and `performTrmnlSync`, which the manual "Sync
 * now" calls; the auto-sync below calls the same function with `auto`.
 */
const useTrmnlSync = ({
  tasks, unscheduledTasks, recurringTasks, isVisibleForUser,
  selectedDate, use24HourClock,
  activeHabits, habits, habitLogs,
  weather, weatherTempUnit, dailyNotes,
  todayRoutines, routinesEnabled,
  dataLoaded, t,
}) => {
  const [trmnlConfig, setTrmnlConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-trmnl-config');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [trmnlSyncStatus, setTrmnlSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
  const [trmnlLastSynced, setTrmnlLastSynced] = useState(() =>
    localStorage.getItem('day-planner-trmnl-last-synced') || null
  );
  // The push state (utils/trmnlPushPolicy.js) is persisted so a relaunch
  // resumes the floor, the backoff and the last content pushed instead of
  // starting again at full speed (field incident, 2026-09-08).
  const trmnlSyncTimerRef = useRef(null);
  const trmnlLastPushRef = useRef(
    (() => {
      const s = localStorage.getItem('day-planner-trmnl-last-synced');
      return Math.max(s ? new Date(s).getTime() : 0, readTrmnlPushState().lastPushAt || 0);
    })()
  ); // timestamp of last push attempt
  const trmnlBackoffUntilRef = useRef(readTrmnlPushState().backoffUntil || 0); // timestamp: skip auto-sync until this time (429 backoff)
  const trmnlBackoffCountRef = useRef(readTrmnlPushState().backoffCount || 0); // consecutive 429s — drives exponential backoff
  const trmnlLastFingerprintRef = useRef(readTrmnlPushState().lastFingerprint ?? null); // content of the last push, clock fields excluded
  const trmnlSyncInProgressRef = useRef(false); // prevents concurrent pushes
  const performTrmnlSyncRef = useRef(null);

  // Persist TRMNL config
  useEffect(() => {
    if (trmnlConfig) {
      localStorage.setItem('day-planner-trmnl-config', JSON.stringify(trmnlConfig));
    } else {
      localStorage.removeItem('day-planner-trmnl-config');
    }
  }, [trmnlConfig]);

  const persistTrmnlPushState = () => writeTrmnlPushState({
    lastPushAt: trmnlLastPushRef.current,
    backoffUntil: trmnlBackoffUntilRef.current,
    backoffCount: trmnlBackoffCountRef.current,
    lastFingerprint: trmnlLastFingerprintRef.current,
  });
  // { auto: true } from the auto-sync: the policy may decline (unchanged
  // content, floor, backoff) and nothing is sent. A manual sync always sends.
  const performTrmnlSync = async ({ auto = false } = {}) => {
    if (!trmnlConfig?.enabled || !trmnlConfig?.webhookUrl) return;
    if (trmnlSyncInProgressRef.current) return; // prevent concurrent pushes
    trmnlSyncInProgressRef.current = true;
    try {
      const today = selectedDate ? dateToString(selectedDate) : new Date().toISOString().slice(0, 10);
      // Multi-user: the TRMNL dashboard belongs to the current user, so scope
      // tasks to what's visible to "me" before gathering the payload. Imported
      // calendar events carry no assignment and remain included.
      const mergeVars = gatherTrmnlData({
        tasks: tasks.filter(isVisibleForUser),
        unscheduledTasks: unscheduledTasks.filter(task => notBucketed(task) && isVisibleForUser(task)),
        recurringTasks: recurringTasks.filter(isVisibleForUser),
        selectedDate: today,
        use24HourClock: use24HourClock,
        habits: activeHabits,
        habitLogs,
        weatherSummary: weather ? `${weather.temp}°${weatherTempUnit === 'celsius' ? 'C' : 'F'} ${weather.description || ''}`.trim() : '',
        dailyNotes,
        todayRoutines,
        routinesEnabled,
        t,
      });
      const fingerprint = trmnlContentFingerprint(mergeVars);
      const decision = trmnlPushDecision({
        now: Date.now(), fingerprint, lastFingerprint: trmnlLastFingerprintRef.current,
        lastPushAt: trmnlLastPushRef.current, backoffUntil: trmnlBackoffUntilRef.current, manual: !auto,
      });
      if (!decision.push) return;
      setTrmnlSyncStatus('syncing');
      const result = await pushToTrmnl(trmnlConfig, mergeVars);
      trmnlLastPushRef.current = Date.now();
      if (result.success) {
        trmnlBackoffCountRef.current = 0; // reset exponential backoff on success
        trmnlBackoffUntilRef.current = 0;
        trmnlLastFingerprintRef.current = fingerprint;
        setTrmnlSyncStatus('success');
        const ts = new Date().toISOString();
        setTrmnlLastSynced(ts);
        localStorage.setItem('day-planner-trmnl-last-synced', ts);
      } else {
        setTrmnlSyncStatus('error');
        console.warn('TRMNL sync failed:', result.error);
        if (result.rateLimited) {
          const backoff = trmnlBackoffAfterRateLimit({
            now: Date.now(), count: trmnlBackoffCountRef.current, retryAfterSeconds: result.retryAfterSeconds ?? null,
          });
          trmnlBackoffCountRef.current = backoff.count;
          trmnlBackoffUntilRef.current = backoff.until;
          console.info(`TRMNL: backing off until ${new Date(backoff.until).toLocaleTimeString()} (${backoff.count} in a row)`);
        }
      }
      persistTrmnlPushState();
    } catch (err) {
      setTrmnlSyncStatus('error');
      console.error('TRMNL sync error:', err);
    } finally {
      trmnlSyncInProgressRef.current = false;
    }
  };

  // TRMNL auto-sync (utils/trmnlPushPolicy.js). A data change is debounced
  // 10 s and then offered to the policy, which pushes only when the CONTENT
  // changed (clock fields excluded) and the floor has passed; a minute tick
  // offers again, carrying the time-only refresh and any push the floor or a
  // 429 backoff deferred. These arrays get a new identity on nearly every
  // sync cycle, so the old identity-keyed throttle pushed around the clock
  // whether or not the screen had changed (field incident, 2026-09-08).
  useEffect(() => {
    performTrmnlSyncRef.current = performTrmnlSync;
  });
  const trmnlAutoEnabled = !isTrayMode && !!trmnlConfig?.enabled && !!trmnlConfig?.webhookUrl && dataLoaded;
  useEffect(() => {
    if (!trmnlAutoEnabled) return;
    if (trmnlSyncTimerRef.current) clearTimeout(trmnlSyncTimerRef.current);
    trmnlSyncTimerRef.current = setTimeout(() => {
      performTrmnlSyncRef.current?.({ auto: true });
    }, 10 * 1000); // 10-second debounce after last change
    return () => { if (trmnlSyncTimerRef.current) clearTimeout(trmnlSyncTimerRef.current); };
    // Keyed on the data that feeds a TRMNL push; the policy decides at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, unscheduledTasks, habits, habitLogs, todayRoutines, routinesEnabled, trmnlAutoEnabled]);
  useEffect(() => {
    if (!trmnlAutoEnabled) return;
    const tick = setInterval(() => { performTrmnlSyncRef.current?.({ auto: true }); }, 60 * 1000);
    return () => clearInterval(tick);
  }, [trmnlAutoEnabled, performTrmnlSyncRef]);

  return {
    trmnlConfig, setTrmnlConfig,
    trmnlSyncStatus, setTrmnlSyncStatus,
    trmnlLastSynced, setTrmnlLastSynced,
    trmnlSyncTimerRef,
    trmnlLastPushRef,
    trmnlBackoffUntilRef,
    trmnlBackoffCountRef,
    trmnlLastFingerprintRef,
    trmnlSyncInProgressRef,
    performTrmnlSyncRef,
    performTrmnlSync,
  };
};

export default useTrmnlSync;
