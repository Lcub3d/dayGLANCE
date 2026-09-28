import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analyzeNetwork, DEFAULT_SCENARIO_ID, networkNodes } from '../../lifeplanner/supportNetwork.js';
import { readLifeNetwork } from '../../jobu/lifeNetworkStore.js';
const EMPTY = Object.freeze({ records: undefined, loaded: false, writable: false, error: null });
const noSubscribe = () => () => {};
const noSnapshot = () => EMPTY;
export default function useLifeNetwork(data, graph, active, readOnly) {
  const status = useSyncExternalStore(data?.subscribe || noSubscribe, data?.get || noSnapshot, data?.get || noSnapshot);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [editRevision, setEditRevision] = useState(0);
  const busy = useRef(false);
  const nodes = useMemo(() => networkNodes(graph), [graph]);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const getNodes = useCallback(() => nodesRef.current, []);
  const state = useMemo(() => readLifeNetwork(status.records, scenarioId), [status.records, scenarioId]);
  const fatal = !status.loaded || status.error === 'format' || status.error === 'storageRead';
  const writable = !!data && !readOnly && status.writable && !fatal && !pending;
  const analysis = useMemo(() => active && !fatal && state.scenario ? analyzeNetwork({ nodes,
    edges: state.edges.map(r => r.value), evaluations: state.evaluations.map(r => r.value), alpha: state.scenario.value.alpha }) : null,
  [active, fatal, state, nodes]);
  const run = useCallback(async action => {
    const current = data?.get();
    if (busy.current || !current?.loaded || !current.writable || ['format', 'storageRead'].includes(current.error) || readOnly) return false;
    busy.current = true; setPending(true); setError('');
    try { await action(); setEditRevision(n => n + 1); return true; }
    catch (e) { setError(e.message || 'storageWrite'); return false; }
    finally { busy.current = false; setPending(false); }
  }, [data, readOnly]);
  return { data, status, nodes, getNodes, state, analysis, scenarioId, setScenarioId, writable, pending, error, run, editRevision };
}
