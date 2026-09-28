import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { backupLifeSources, migrateLifeNodes, readLifeNodes, replaceNativeLifeNodes } from './lifeNodeStore.js';
import { projectNativeNodes } from '../lifeplanner/entities.js';
const EMPTY = Object.freeze({ records: undefined, loaded: false, writable: false, error: null });
const noSubscribe = () => () => {};
const noSnapshot = () => EMPTY;

/** Boundary between inherited synchronous native handlers and the canonical
 * asynchronous journal. Publish only committed values; failed commands remain
 * retryable and warn before unload. Raw load/sync setters are kept separate.
 */
export default function useLifeNativeCollections({ data, bootLoaded, legacyGoals, legacyProjects, setLegacyGoals, setLegacyProjects }) {
  const state = useSyncExternalStore(data?.subscribe || noSubscribe, data?.get || noSnapshot, data?.get || noSnapshot);
  const snapshot = useMemo(() => readLifeNodes(state.records), [state.records]);
  const [backupReady, setBackupReady] = useState(!data);
  const [error, setError] = useState(''), [pending, setPending] = useState(0), [retryKey, retry] = useState(0);
  const failures = useRef([]), live = useRef(snapshot), migrationStarted = useRef(false);
  live.current = snapshot;
  useEffect(() => {
    if (!data || !bootLoaded || !state.loaded || !state.writable || migrationStarted.current) return;
    migrationStarted.current = true;
    try { backupLifeSources(); setBackupReady(true); } catch { setError('storageWrite'); return; }
    if (snapshot.ready) return;
    migrateLifeNodes(data).then(() => setError('')).catch(e => setError(e.message || 'format'));
  }, [data, bootLoaded, state.loaded, state.writable, snapshot.ready, retryKey]);
  const execute = useCallback(command => {
    if (!data) return;
    setPending(n => n + 1);
    return replaceNativeLifeNodes(data, command.kind, command.updater, command.expected).then(() => {
      if (!failures.current.length) setError('');
    }).catch(e => { failures.current.push(command); setError(e.message || 'storageWrite'); })
      .finally(() => setPending(n => n - 1));
  }, [data]);
  const write = useCallback((kind, updater) => {
    if (!data) return (kind === 'goal' ? setLegacyGoals : setLegacyProjects)(updater);
    const expected = new Map(live.current.rows.map(row => [row.entityId, row.id]));
    return execute({ kind, updater, expected });
  }, [data, execute, setLegacyGoals, setLegacyProjects]);
  const setGoals = useCallback(value => write('goal', value), [write]);
  const setProjects = useCallback(value => write('project', value), [write]);
  const retryWrites = useCallback(() => {
    setError('');
    if (!backupReady || !live.current.ready) { migrationStarted.current = false; retry(k => k + 1); data?.load(); return; }
    const commands = failures.current; failures.current = [];
    commands.forEach(command => execute(command));
  }, [execute, data, backupReady]);
  const discardWrites = useCallback(() => { failures.current = []; setError(''); }, []);
  useEffect(() => {
    const beforeUnload = event => { if (pending || failures.current.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [pending]);
  const goals = useMemo(() => snapshot.ready ? projectNativeNodes(snapshot.nodes, 'goal') : legacyGoals, [snapshot, legacyGoals]);
  const projects = useMemo(() => snapshot.ready ? projectNativeNodes(snapshot.nodes, 'project') : legacyProjects, [snapshot, legacyProjects]);
  return { goals, projects, setGoals, setProjects, lifeNodesReady: snapshot.ready && backupReady,
    lifeNodesError: error, lifeNodesPending: pending, retryLifeNodes: retryWrites, discardLifeNodeWrites: discardWrites };
}
