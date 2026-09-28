import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { backupLifeSources, migrateLifeNodes, readLifeNodes } from './lifeNodeStore.js';
import { createNativeLifeQueue } from './nativeLifeQueue.js';
import { projectNativeNodes } from '../lifeplanner/entities.js';
const EMPTY = Object.freeze({ records: undefined, loaded: false, writable: false, error: null });
const noSubscribe = () => () => {};
const noSnapshot = () => EMPTY;
const NO_COMMANDS = Object.freeze({ pending: 0, error: '' });
const noCommands = () => NO_COMMANDS;

/** Boundary between inherited synchronous native handlers and the canonical
 * asynchronous journal. Publish only committed values; failed commands remain
 * retryable and warn before unload. Raw load/sync setters are kept separate.
 */
export default function useLifeNativeCollections({ data, bootLoaded, legacyGoals, legacyProjects, setLegacyGoals, setLegacyProjects }) {
  const state = useSyncExternalStore(data?.subscribe || noSubscribe, data?.get || noSnapshot, data?.get || noSnapshot);
  const snapshot = useMemo(() => readLifeNodes(state.records), [state.records]);
  const [backupReady, setBackupReady] = useState(!data);
  const [error, setError] = useState(''), [retryKey, retry] = useState(0);
  const commands = useMemo(() => data ? createNativeLifeQueue(data) : null, [data]);
  const commandState = useSyncExternalStore(commands?.subscribe || noSubscribe, commands?.get || noCommands, commands?.get || noCommands);
  const live = useRef(snapshot), migrationStarted = useRef(false);
  live.current = snapshot;
  useEffect(() => {
    if (!data || !bootLoaded || !state.loaded || !state.writable || migrationStarted.current) return;
    migrationStarted.current = true;
    try { backupLifeSources(); setBackupReady(true); } catch (e) { setError(e.message === 'format' ? 'format' : 'storageWrite'); return; }
    if (snapshot.ready) return;
    migrateLifeNodes(data).then(() => setError('')).catch(e => setError(e.message || 'format'));
  }, [data, bootLoaded, state.loaded, state.writable, snapshot.ready, retryKey]);
  const write = useCallback((kind, updater) => {
    if (!data) return (kind === 'goal' ? setLegacyGoals : setLegacyProjects)(updater);
    const expected = new Map(live.current.rows.map(row => [row.entityId, row.id]));
    return commands.enqueue(kind, updater, expected);
  }, [data, commands, setLegacyGoals, setLegacyProjects]);
  const setGoals = useCallback(value => write('goal', value), [write]);
  const setProjects = useCallback(value => write('project', value), [write]);
  const retryWrites = useCallback(() => {
    setError('');
    if (!backupReady || !live.current.ready) { migrationStarted.current = false; retry(k => k + 1); data?.load(); return; }
    return commands?.retry();
  }, [commands, data, backupReady]);
  const discardWrites = useCallback(() => { commands?.discard(); }, [commands]);
  useEffect(() => {
    const beforeUnload = event => { if (commands?.get().pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [commands]);
  const goals = useMemo(() => snapshot.ready ? projectNativeNodes(snapshot.nodes, 'goal') : legacyGoals, [snapshot, legacyGoals]);
  const projects = useMemo(() => snapshot.ready ? projectNativeNodes(snapshot.nodes, 'project') : legacyProjects, [snapshot, legacyProjects]);
  return { goals, projects, setGoals, setProjects, lifeNodesReady: snapshot.ready && backupReady,
    lifeNodesError: error || commandState.error, lifeNodesPending: commandState.pending, retryLifeNodes: retryWrites, discardLifeNodeWrites: discardWrites };
}
