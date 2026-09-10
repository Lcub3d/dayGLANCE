import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, normalizeSettings, mergeResponse, matches, active, linked,
  reconcileTask, additions, prepareOutbox, acknowledge, writebackReason } from '../todoist/core.js';
import { requestSync, CONFIG_KEY, TOKEN_KEY, ACCOUNT_KEY, stateKey, readJSON, writeJSON } from '../todoist/client.js';
import { isResetInProgress } from '../utils/resetAppData.js';

// Credentials are session-only. dg-todoist-* is deliberately outside the
// day-planner-* device-settings/backup namespace. Tasks themselves may sync.
export default function useTodoistSync({ tasks, setTasks, unscheduledTasks, setUnscheduledTasks,
  recycleBin, dataLoaded, isTrayMode, multiUserEnabled }) {
  const [settings, setSettings] = useState(() => {
    try { return normalizeSettings(readJSON(localStorage, CONFIG_KEY, DEFAULT_SETTINGS)); }
    catch { return normalizeSettings(); }
  });
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [account, setAccount] = useState(() => sessionStorage.getItem(ACCOUNT_KEY) || '');
  const [catalog, setCatalog] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState(null);
  const [pending, setPending] = useState(0);
  const latest = useRef();
  latest.current = { tasks, setTasks, unscheduledTasks, setUnscheduledTasks, recycleBin,
    dataLoaded, isTrayMode, multiUserEnabled, settings, token, account };
  const running = useRef(false);
  const generation = useRef(0);
  const controller = useRef(null);
  const retryAt = useRef(0);
  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
  }, []);
  const updateSettings = useCallback(patch => {
    cancel();
    const next = normalizeSettings({ ...latest.current.settings, ...patch });
    try { writeJSON(localStorage, CONFIG_KEY, next); setSettings(next); setError(''); }
    catch (err) { setError(err.message); }
  }, [cancel]);
  const disconnect = useCallback(() => {
    cancel();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ACCOUNT_KEY);
    setToken(''); setAccount(''); setCatalog(null); setPending(0); setLastSynced(null);
    updateSettings({ enabled: false });
    setStatus('idle');
  }, [cancel, updateSettings]);

  const perform = useCallback(async (mode = 'sync', candidateToken = '') => {
    const initial = latest.current;
    if (running.current || initial.isTrayMode || isResetInProgress()) return;
    if (initial.multiUserEnabled) { setError('multiUser'); return; }
    if (mode === 'sync' && (!initial.settings.enabled || !initial.dataLoaded)) return;
    if (Date.now() < retryAt.current) { setError('rateLimited'); return; }
    const secret = mode === 'connect' ? candidateToken.trim() : initial.token;
    if (!secret) { setError('tokenRequired'); return; }
    const epoch = generation.current;
    const check = () => {
      if (generation.current !== epoch || isResetInProgress() || latest.current.multiUserEnabled) throw new Error('cancelled');
    };
    running.current = true;
    controller.current = new AbortController();
    setStatus('syncing'); setError('');
    const execute = async () => {
      let id = initial.account;
      let stored = id ? readJSON(localStorage, stateKey(id), {}) : {};
      let cache;
      const response = await requestSync(secret, mode === 'connect' ? '*' : (stored.cache?.cursor || '*'), [],
        { signal: controller.current.signal });
      check();
      cache = mergeResponse(mode === 'connect' ? {} : stored.cache, response);
      id = String(cache.user.id);
      if (mode !== 'connect' && id !== initial.account) throw new Error('accountChanged');
      if (mode === 'connect') {
        stored = readJSON(localStorage, stateKey(id), {});
        // Connecting is always read-only, even after reconnecting to the same account.
        const next = normalizeSettings(initial.account && initial.account !== id
          ? DEFAULT_SETTINGS : { ...initial.settings, enabled: false });
        writeJSON(localStorage, CONFIG_KEY, next);
        sessionStorage.setItem(TOKEN_KEY, secret);
        sessionStorage.setItem(ACCOUNT_KEY, id);
        setToken(secret); setAccount(id); setSettings(next);
      }
      if (stored.queue != null && !Array.isArray(stored.queue)) throw new Error('storageCorrupt');
      let queue = stored.queue || [];
      const persist = (lastSync = stored.lastSync) => {
        check();
        writeJSON(localStorage, stateKey(id), { cache, queue, lastSync });
        setCatalog(cache); setPending(queue.length);
      };
      persist();
      if (mode === 'sync') {
        const current = latest.current;
        const all = [...current.tasks, ...current.unscheduledTasks];
        if (current.settings.completionWriteback) {
          // No unsafe ad-hoc localStorage lock: when Web Locks is unavailable,
          // read-only sync remains usable but automatic writes are disabled.
          if (!navigator.locks?.request) throw new Error('writeLockUnavailable');
          const prepared = prepareOutbox(queue, all, cache, current.settings, () => crypto.randomUUID());
          queue = prepared.queue;
          persist(); // Durable UUIDs BEFORE the request: retry never generates a new close.
          if (prepared.send.length) {
            check();
            const written = await requestSync(secret, cache.cursor, prepared.send, { signal: controller.current.signal });
            check();
            const ack = acknowledge(queue, prepared.send, written);
            queue = ack.queue;
            // Acknowledged ordinary leaf closes are authoritative even if the
            // response's read portion is malformed. Never lose their receipt.
            for (const op of prepared.send) {
              if (ack.succeeded.has(op.uuid)) cache.items[op.args.id] = { ...cache.items[op.args.id], checked: true };
            }
            persist();
            cache = mergeResponse(cache, written);
            persist();
            if (ack.failed.length) throw new Error('commandFailed');
          }
        }
        check();
        const now = new Date().toISOString();
        const currentState = latest.current;
        const tombstones = readJSON(localStorage, 'day-planner-deleted-task-ids', {});
        const blocked = new Set([...Object.keys(tombstones), ...(currentState.recycleBin || []).map(t => String(t.id))]);
        const inserted = additions([...currentState.tasks, ...currentState.unscheduledTasks], cache, currentState.settings, blocked, now);
        const config = currentState.settings;
        currentState.setTasks(prev => generation.current === epoch && !isResetInProgress()
          ? prev.map(task => reconcileTask(task, cache, config, now)) : prev);
        currentState.setUnscheduledTasks(prev => {
          if (generation.current !== epoch || isResetInProgress()) return prev;
          const updated = prev.map(task => reconcileTask(task, cache, config, now));
          const existing = new Set([...updated, ...latest.current.tasks].map(task => String(task.id)));
          return [...updated, ...inserted.filter(task => !existing.has(String(task.id)))];
        });
        persist(now);
        setLastSynced(now);
      } else setLastSynced(stored.lastSync || null);
      setCatalog(cache); setPending(queue.length); setStatus('success');
    };
    try {
      if (navigator.locks?.request) {
        await navigator.locks.request('dayglance-todoist-sync', { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('busyOtherTab');
          await execute();
        });
      } else await execute();
    } catch (err) {
      if (generation.current === epoch) {
        setError(err.message === 'cancelled' ? 'networkError' : err.message);
        setStatus('error');
        if (err.retryAfter) retryAt.current = Date.now() + err.retryAfter * 1000;
      }
    } finally {
      running.current = false;
      controller.current = null;
      if (generation.current !== epoch) setStatus('idle');
    }
  }, []);
  const syncNow = useCallback(() => perform('sync'), [perform]);
  const preview = useCallback(() => perform('preview'), [perform]);
  const connect = useCallback(value => perform('connect', value), [perform]);
  const resolveConflict = useCallback((id, useRemote) => {
    const now = new Date().toISOString();
    const resolve = task => task.id !== id ? task : {
      ...task, ...(useRemote ? task.todoist?.conflicts : {}),
      todoist: { ...task.todoist, conflicts: {} }, lastModified: now,
    };
    latest.current.setTasks(prev => prev.map(resolve));
    latest.current.setUnscheduledTasks(prev => prev.map(resolve));
  }, []);
  useEffect(() => {
    const changed = event => {
      if (event.key !== CONFIG_KEY) return;
      cancel();
      try { setSettings(normalizeSettings(readJSON(localStorage, CONFIG_KEY, DEFAULT_SETTINGS))); }
      catch { setError('storageCorrupt'); }
    };
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('storage', changed); cancel(); };
  }, [cancel]);
  useEffect(() => {
    if (!settings.enabled || !token || !dataLoaded || isTrayMode || multiUserEnabled || !settings.intervalMinutes) return;
    const tick = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) syncNow(); };
    const startup = setTimeout(tick, 1500);
    const timer = setInterval(tick, settings.intervalMinutes * 60000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(startup); clearInterval(timer);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [settings.enabled, settings.intervalMinutes, token, dataLoaded, isTrayMode, multiUserEnabled, syncNow]);

  const selected = catalog ? Object.values(catalog.items).filter(item => active(item) && matches(item, settings, catalog.projects)) : [];
  const local = [...tasks, ...unscheduledTasks].filter(task => linked(task, account));
  const conflicts = local.filter(task => Object.keys(task.todoist.conflicts || {}).length);
  const blockedWrites = catalog ? local.filter(task => ['recurring', 'parent', 'assignedElsewhere'].includes(writebackReason(task, catalog, settings))) : [];
  return { settings, updateSettings, connected: !!token && !!account, account, catalog, selected,
    status, error, lastSynced, pending, conflicts, blockedWrites, multiUserEnabled,
    connect, disconnect, preview, syncNow, resolveConflict };
}
