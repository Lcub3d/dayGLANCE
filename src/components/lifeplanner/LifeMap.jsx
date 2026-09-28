import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, getNodesBounds, getViewportForBounds, useReactFlow, MarkerType } from '@xyflow/react';
import { ArrowUpRight, BookOpen, Check, CheckSquare, ChevronDown, ChevronRight, Compass, Expand, GitBranch, Layers, Minus, Network, Plus, Search, Star, Target, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildLifeMap, emptyMapView, filterLifeMap, layoutLifeMap, MAP_TOMBSTONE_KEYS, readMapTombstones, readMapView, writeMapView } from '../../lifeplanner/lifeMap.js';
import useLifeNetwork from './useLifeNetwork.js';
import LifeNetworkPanel from './LifeNetworkPanel.jsx';
import UnifiedLifeMap from './UnifiedLifeMap.jsx';
import SupportEdge from './SupportEdge.jsx';
import { networkNodeId } from '../../lifeplanner/supportNetwork.js';
import { flowIdentity, domainIdentity } from '../../lifeplanner/flowIdentity.js';
import { edgeId } from '../../jobu/lifeNetworkStore.js';
import '@xyflow/react/dist/style.css';
import './lifeMap.css';

const ICONS = { root: Compass, unlinked: Layers, wish: Star, vision: Compass, goal: Target, project: Layers, task: CheckSquare };
const LEVELS = ['wish', 'vision', 'goal', 'project', 'task'];
const browserStorage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
const titleFor = (node, t) => node.kind === 'root' ? t('lifeMap.root') : node.kind === 'unlinked' ? t('lifeMap.unlinked') : node.missing ? t('lifeMap.missingProject') : node.title || t('lifeMap.untitled');

const LifeNode = memo(function LifeNode({ data, selected }) {
  const { t } = useTranslation();
  const Icon = ICONS[data.kind] || Compass;
  return <div className={`lm-node lm-${data.kind} ${selected ? 'is-selected' : ''} ${data.match ? 'is-match' : ''} ${data.completed ? 'is-complete' : ''} ${data.missing ? 'is-missing' : ''} ${data.networkMode ? 'ln-connectable' : ''}`} data-life-map-node={data.id} data-kind={data.kind}>
    {data.kind !== 'root' && <Handle type="target" position={Position.Left} isConnectable={false} />}
    <div className="lm-node-type"><Icon size={13} aria-hidden="true" /><span>{t(data.kind === 'root' ? 'lifeMap.title' : `lifeMap.${data.kind}`)}</span>{data.completed && <Check size={13} aria-label={t('lifeMap.completed')} />}{data.starred && <Star size={11} fill="currentColor" aria-label={t('lifeplanner.star')} />}</div>
    <div className="lm-node-title" title={titleFor(data, t)}>{titleFor(data, t)}</div>
    {data.childCount > 0 && data.kind !== 'root' && !data.searching && <button type="button" className="lm-fold nodrag nopan" aria-label={`${t(data.collapsed ? 'lifeMap.expand' : 'lifeMap.collapse')} · ${titleFor(data, t)}`} aria-expanded={!data.collapsed} onClick={event => { event.stopPropagation(); data.onToggle(data.id); }}>
      {data.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span>{data.childCount}</span>
    </button>}
    {(data.planned || data.conflict || data.missing) && <span className="lm-marker" title={t(data.missing ? 'lifeMap.missingHint' : data.conflict ? 'lifeMap.conflictHint' : 'lifeMap.plannedHint')}>·</span>}
    {data.childCount > 0 && <Handle type="source" position={Position.Right} isConnectable={false} />}
    {!data.missing && LEVELS.includes(data.kind) && <>
      <Handle id="network-in" className="ln-handle" type="target" position={Position.Left} isConnectable={!!data.networkWritable} title={t('lifeNetwork.target')} />
      <Handle id="network-out" className="ln-handle" type="source" position={Position.Right} isConnectable={!!data.networkWritable} title={t('lifeNetwork.source')} />
    </>}
  </div>;
});
const NODE_TYPES = { life: LifeNode };
const EDGE_TYPES = { support: SupportEdge };

function MapCanvas({ document, jobuData, onLeaveGuard, goals, projects, tasks, unscheduledTasks, recurringTasks, darkMode, onOpen, onNotebook, readOnly = false }) {
  const { t } = useTranslation();
  const M = useCallback((key, options) => t(`lifeMap.${key}`, options), [t]);
  const [stored] = useState(() => readMapView(browserStorage));
  const [view, setView] = useState(stored.value);
  const [measurements, setMeasurements] = useState({});
  const viewRef = useRef(view);
  const [error, setError] = useState(stored.error);
  const readBlocked = useRef(!!stored.error);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [networkRequest, setNetworkRequest] = useState({ mode: 'overview' });
  const networkDirty = useRef(false);
  const onNetworkDirty = useCallback(value => { networkDirty.current = value; }, []);
  const [query, setQuery] = useState(''), [wishId, setWishId] = useState(''), [level, setLevel] = useState(5);
  const [showUnlinked, setShowUnlinked] = useState(false), [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1), [fitRevision, requestFit] = useState(0);
  const [tombstones, setTombstones] = useState(() => readMapTombstones(browserStorage));
  useEffect(() => {
    const refresh = () => setTombstones(previous => {
      const next = readMapTombstones(browserStorage);
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
    const onStorage = event => { if (event.key == null || MAP_TOMBSTONE_KEYS.includes(event.key)) refresh(); };
    refresh(); window.addEventListener('storage', onStorage); window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', refresh); };
  }, [goals, projects]);
  const graph = useMemo(() => buildLifeMap({ document, ...tombstones,
    goals: tombstones.error ? [] : goals, projects: tombstones.error ? [] : projects,
    tasks: tombstones.error ? [] : tasks, unscheduledTasks: tombstones.error ? [] : unscheduledTasks,
    recurringTasks: tombstones.error ? [] : recurringTasks }),
  [document, goals, projects, tasks, unscheduledTasks, recurringTasks, tombstones]);
  const network = useLifeNetwork(jobuData, graph, networkOpen, readOnly || !!tombstones.error);
  const requestNetwork = useCallback((request, saved = false) => {
    if (!saved && network.pending) return false;
    if (!saved && networkDirty.current && !window.confirm(t('lifeNetwork.discardDraft'))) return false;
    networkDirty.current = false; setNetworkRequest(request); return true;
  }, [network.pending, t]);
  useEffect(() => {
    const guard = () => !networkOpen || requestNetwork({ ...networkRequest });
    onLeaveGuard?.(guard);
    const unloading = event => { if (networkOpen && (networkDirty.current || network.pending)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unloading);
    return () => { onLeaveGuard?.(null); window.removeEventListener('beforeunload', unloading); };
  }, [networkOpen, network.pending, networkRequest, onLeaveGuard, requestNetwork]);
  const closeNetwork = () => { if (requestNetwork({ mode: 'overview' })) setNetworkOpen(false); };
  const returnNotebook = () => { if (!networkOpen || requestNetwork({ mode: 'overview' })) onNotebook(); };
  const ids = useMemo(() => graph.nodes.map(n => n.id), [graph]);
  const filtered = useMemo(() => filterLifeMap(graph, { wishId, query, level, showUnlinked, collapsed: view.collapsed }), [graph, wishId, query, level, showUnlinked, view.collapsed]);
  const projection = useMemo(() => layoutLifeMap(filtered, view.positions), [filtered, view.positions]);
  const { setViewport, setCenter, zoomIn, zoomOut, viewportInitialized } = useReactFlow();
  const canvas = useRef(null), fitAll = useRef(false);
  const selected = filtered.nodes.find(n => n.id === selectedId);
  const graphRef = useRef(graph); graphRef.current = graph;

  const persist = useCallback(value => {
    if (readBlocked.current) { setError('viewReadError'); return; }
    setError(writeMapView(browserStorage, value, ids) ? null : 'viewWriteError');
  }, [ids]);
  const update = useCallback((transform, save = true) => {
    const next = transform(viewRef.current); viewRef.current = next; setView(next);
    if (save) persist(next);
  }, [persist]);
  const toggle = useCallback(id => {
    update(current => ({ ...current, collapsed: current.collapsed.includes(id) ? current.collapsed.filter(value => value !== id) : [...current.collapsed, id] }));
  }, [update]);
  const nodes = useMemo(() => projection.map(node => ({ ...node, id: flowIdentity(node.id), measured: measurements[node.id], selected: node.id === selectedId,
    ariaLabel: `${M(node.data.kind)} · ${titleFor(node.data, t)}`, data: { ...node.data, onToggle: toggle, searching: !!query.trim(), networkMode: networkOpen, networkWritable: networkOpen && network.writable } })), [projection, measurements, selectedId, toggle, M, t, query, networkOpen, network.writable]);
  const networkEdges = useMemo(() => {
    if (!networkOpen) return [];
    const visible = new Map(filtered.nodes.filter(n => !n.missing).map(n => [networkNodeId(n), n]));
    return [...network.state.edges].sort((a, b) => a.entityId.localeCompare(b.entityId, 'en')).filter(row => visible.has(row.value.source) && visible.has(row.value.target)).map((row, index) => {
      const e = row.value, color = e.relation === 'supports' ? '#5c9682' : '#b58b55';
      const source = visible.get(e.source), target = visible.get(e.target);
      const label = t(`lifeNetwork.${e.relation}`) + (e.relation === 'supports' && e.weight !== null ? ` ${Math.round(e.weight * 1000) / 10}%` : '');
      return { id: flowIdentity(row.entityId), source: flowIdentity(source.id), target: flowIdentity(target.id), sourceHandle: 'network-out', targetHandle: 'network-in',
        type: 'support', deletable: false, selectable: true, focusable: true, interactionWidth: 18,
        selected: networkRequest.entityId === row.entityId, data: { networkEntityId: row.entityId, routeSlot: index % 4 },
        className: 'ln-network-edge', style: { stroke: color, strokeDasharray: e.relation === 'requires' ? '6 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 17, height: 17 }, label,
        ariaLabel: `${source.title} → ${target.title} · ${label}` };
    });
  }, [networkOpen, network.state.edges, filtered.nodes, networkRequest.entityId, t]);
  const edges = useMemo(() => [...filtered.edges.map(edge => ({ ...edge, id: flowIdentity(edge.id), source: flowIdentity(edge.source), target: flowIdentity(edge.target), type: 'default', deletable: false, selectable: false,
    className: edge.relation === 'child' ? 'lm-edge' : 'lm-edge lm-edge-advisory' })), ...networkEdges], [filtered.edges, networkEdges]);
  const connectNetwork = connection => {
    if (!networkOpen || !network.writable || connection.sourceHandle !== 'network-out' || connection.targetHandle !== 'network-in') return;
    const source = graph.nodes.find(n => n.id === domainIdentity(connection.source)), target = graph.nodes.find(n => n.id === domainIdentity(connection.target));
    if (!source || !target || source.id === target.id) return;
    const relation = { scenarioId: network.scenarioId, source: networkNodeId(source), target: networkNodeId(target), relation: 'supports' };
    const existing = network.state.edges.find(row => row.entityId === edgeId(relation));
    requestNetwork({ mode: 'edge', ...(existing ? { entityId: existing.entityId } : { source: relation.source, target: relation.target }), refresh: Date.now() });
  };
  const focusNetworkNode = node => {
    setSelectedId(node.mapId); setQuery(''); setWishId(''); setLevel(5); setShowUnlinked(true);
    update(current => ({ ...current, collapsed: [] }));
    const target = layoutLifeMap(graph, viewRef.current.positions).find(n => n.id === node.mapId);
    if (target) setCenter(target.position.x + 112, target.position.y + 48, { zoom: .9, duration: 0 });
  };
  // Fit only on an explicit filter/layout action or the initial render, never
  // on every clock tick, native data update, click or dragged pixel.
  const fitted = useRef(null);
  useEffect(() => {
    if (!viewportInitialized || fitted.current === fitRevision) return;
    const frame = requestAnimationFrame(() => {
      fitted.current = fitRevision;
      // A six-column graph must not shrink into unreadable text on a phone.
      // Start at one wish (or a search match); Fit remains an explicit overview.
      const anchor = projection.find(node => node.data.match)
        || projection.find(node => node.data.kind === 'wish' && (!wishId || node.data.wishId === wishId))
        || projection[0];
      if (!fitAll.current && canvas.current?.clientWidth < 600 && anchor) {
        setCenter(anchor.position.x + 112, anchor.position.y + 48, { zoom: .95, duration: 0 });
      } else if (canvas.current) {
        // Fit the current projection, not React Flow's previous internal node
        // lookup while a filter is still propagating through its store.
        const { clientWidth: width, clientHeight: height } = canvas.current;
        setViewport(getViewportForBounds(getNodesBounds(projection), width, height, .12, 1, .16), { duration: 0 });
      }
      fitAll.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [viewportInitialized, fitRevision, setViewport, setCenter, projection, wishId]);
  const fit = (all = false) => { fitAll.current = all; requestFit(value => value + 1); };
  const reset = () => { readBlocked.current = false; update(() => emptyMapView()); fit(); };
  const select = (_event, node) => {
    const n = graph.nodes.find(item => item.id === domainIdentity(node.id));
    if (networkOpen && n && LEVELS.includes(n.kind) && !n.missing && !requestNetwork({ mode: 'node', nodeId: networkNodeId(n) })) return;
    setSelectedId(domainIdentity(node.id));
  };
  const open = (_event, node) => {
    const live = graphRef.current.nodes.find(n => n.id === domainIdentity(node.id));
    if (networkOpen) { select(_event, node); return; }
    if (live && !live.missing && !readOnly && live.kind !== 'root' && live.kind !== 'unlinked') onOpen(live);
  };
  const onNodesChange = useCallback(changes => {
    // Controlled nodes must keep React Flow's measured dimensions. Discarding
    // these clears handle bounds on the next projection and loses live edges.
    const domainChanges = changes.map(change => ({ ...change, id: domainIdentity(change.id) }));
    const dimensions = domainChanges.filter(change => change.type === 'dimensions' && change.dimensions);
    if (dimensions.length) setMeasurements(current => {
      const next = { ...current }; let changed = false;
      for (const { id, dimensions: size } of dimensions) {
        if (current[id]?.width === size.width && current[id]?.height === size.height) continue;
        next[id] = size; changed = true;
      }
      return changed ? next : current;
    });
    const selectedChange = domainChanges.find(change => change.type === 'select' && change.selected);
    if (selectedChange && !networkOpen) setSelectedId(selectedChange.id);
    const moved = domainChanges.filter(change => change.type === 'position' && change.position);
    if (!moved.length) return;
    update(current => ({ ...current, positions: { ...current.positions, ...Object.fromEntries(moved.map(change => [change.id, change.position])) } }), !moved.some(change => change.dragging));
  }, [update, networkOpen]);
  const noContent = filtered.nodes.length <= 1;
  return <section className="life-map" data-life-map aria-label={M('title')}>
    <div className="lm-toolbar">
      <label className="lm-search"><Search size={14} aria-hidden="true" /><input value={query} placeholder={M('search')} aria-label={M('search')} onChange={e => { setQuery(e.target.value); fit(); }} />{query && <button type="button" aria-label={M('clearSearch')} onClick={() => { setQuery(''); fit(); }}><X size={14} /></button>}</label>
      <select aria-label={M('focusWish')} value={wishId} onChange={e => { setWishId(e.target.value); setSelectedId(null); fit(); }}><option value="">{M('allWishes')}</option>{document.wishes.map(wish => <option key={wish.id} value={wish.id}>{wish.title}</option>)}</select>
      <label className="lm-unlinked"><input type="checkbox" checked={showUnlinked} onChange={e => { setShowUnlinked(e.target.checked); fit(); }} />{M('showUnlinked')}</label>
      <button type="button" className="lm-network-toggle" aria-pressed={networkOpen} onClick={() => { if (networkOpen) closeNetwork(); else setNetworkOpen(true); }}><GitBranch size={14} />{t('lifeNetwork.title')}</button>
      <button type="button" className="lm-notebook" onClick={returnNotebook}><BookOpen size={14} />{M('notebook')}</button>
    </div>
    <div className="lm-levels" role="group" aria-label={M('depth')}>
      {LEVELS.map((kind, i) => <React.Fragment key={kind}>{i > 0 && <ChevronRight size={12} aria-hidden="true" />}<button type="button" aria-pressed={level === i + 1} title={M('showThrough', { kind: M(kind) })} onClick={() => { setLevel(i + 1); setSelectedId(null); fit(); }}>{M(kind)}</button></React.Fragment>)}
      <span className="lm-count" role="status">{query ? M('matches', { count: filtered.matchCount }) : M('nodes', { count: Math.max(0, filtered.nodes.filter(n => n.kind !== 'unlinked').length - 1) })}</span>
    </div>
    <div className="lm-body"><div ref={canvas} className="lm-canvas" data-life-map-canvas>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} onNodesChange={onNodesChange}
        onNodeClick={select} onNodeDoubleClick={open} onPaneClick={() => { if (!networkOpen) setSelectedId(null); }}
        onNodeDragStop={() => persist(viewRef.current)} onMoveEnd={(_event, viewport) => setZoom(viewport.zoom)}
        onConnect={connectNetwork} onEdgeClick={(_event, edge) => { if (edge.data?.networkEntityId) requestNetwork({ mode: 'edge', entityId: edge.data.networkEntityId }); }}
        isValidConnection={connection => connection.source !== connection.target && connection.sourceHandle === 'network-out' && connection.targetHandle === 'network-in'}
        nodesConnectable={networkOpen && network.writable} edgesFocusable={networkOpen} deleteKeyCode={null} selectNodesOnDrag={false}
        nodeDragThreshold={6} minZoom={.12} maxZoom={2.2}
        onlyRenderVisibleElements={nodes.length > 150} colorMode={darkMode ? 'dark' : 'light'}
        ariaLabelConfig={{ 'node.a11yDescription.default': M('keyboard'), 'node.a11yDescription.keyboardDisabled': M('keyboard'), 'controls.zoomIn.ariaLabel': M('zoomIn'), 'controls.zoomOut.ariaLabel': M('zoomOut') }}>
        <Background gap={24} size={1} />
      </ReactFlow>
      {noContent && <div className="lm-empty"><Compass size={25} /><h2>{M(query ? 'noResults' : 'empty')}</h2><p>{M(query ? 'searchHint' : 'emptyHint')}</p><button type="button" onClick={returnNotebook}><Plus size={14} />{M('writeWish')}</button></div>}
      {!networkOpen && selected && !['root', 'unlinked'].includes(selected.kind) && <aside className="lm-inspector" aria-label={M('details')}>
        <button type="button" className="lm-detail-close" aria-label={M('closeDetails')} onClick={() => setSelectedId(null)}><X size={15} /></button>
        <span className="lm-detail-type">{M(selected.kind)}</span><h2>{titleFor(selected, t)}</h2>
        {selected.date && <p>{selected.date}</p>}
        {selected.completed && <p className="lm-completed"><Check size={13} />{M('completed')}</p>}
        {selected.planned && <p>{M('plannedHint')}</p>}
        {selected.conflict && <p>{M('conflictHint')}</p>}
        {selected.missing && <p>{M('missingHint')}</p>}
        {selected.recurring && <p>{M('recurringHint')}</p>}
        {!selected.missing && <button type="button" className="lm-open" disabled={readOnly} onClick={e => open(e, { id: selected.id })}>{M(selected.kind === 'wish' ? 'openWish' : selected.kind === 'vision' || selected.planned ? 'openVision' : selected.kind === 'goal' ? 'openGoal' : selected.kind === 'project' ? 'openProject' : 'openTask')}<ArrowUpRight size={14} /></button>}
      </aside>}
      <div className="lm-navigation" role="group" aria-label={M('navigation')}>
        <button type="button" title={M('expandAll')} aria-label={M('expandAll')} onClick={() => { update(current => ({ ...current, collapsed: [] })); fit(); }}><Network size={16} /></button>
        <button type="button" title={M('resetLayout')} aria-label={M('resetLayout')} onClick={reset}><Layers size={16} /></button>
        <button type="button" title={M('zoomOut')} aria-label={M('zoomOut')} onClick={() => zoomOut({ duration: 0 })}><Minus size={16} /></button>
        <span aria-hidden="true">{Math.round(zoom * 100)}%</span>
        <button type="button" title={M('zoomIn')} aria-label={M('zoomIn')} onClick={() => zoomIn({ duration: 0 })}><Plus size={16} /></button>
        <button type="button" title={M('fit')} aria-label={M('fit')} onClick={() => fit(true)}><Expand size={16} /></button>
      </div>
    </div>
    {networkOpen && <LifeNetworkPanel controller={network} request={networkRequest} onRequest={requestNetwork}
      onDirty={onNetworkDirty} onFocusNode={focusNetworkNode} onClose={closeNetwork} hiddenCount={network.state.edges.length - networkEdges.length} />}
    </div>
    {tombstones.error && <div role="alert" className="lm-error">{M(tombstones.error)}</div>}
    {error && <div role="alert" className="lm-error">{M(error)}<button type="button" onClick={error === 'viewReadError' ? reset : () => persist(viewRef.current)}>{M(error === 'viewReadError' ? 'resetLayout' : 'retry')}</button></div>}
    <p className="lm-footnote">{M('hint')}</p>
  </section>;
}

export default function LifeMap(props) {
  if (props.jobuData) return <UnifiedLifeMap {...props} />;
  return <ReactFlowProvider><MapCanvas {...props} /></ReactFlowProvider>;
}
