import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, MarkerType, useReactFlow, ViewportPortal } from '@xyflow/react';
import { BookOpen, CalendarDays, Check, Compass, Download, Expand, Focus, GitBranch, Inbox, Minus, Plus, Search, Star, Target, Layers, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createLifeNode, LIFE_TYPES, lifeKey, lifeHierarchyCycles, visibleLifeNodes } from '../../lifeplanner/entities.js';
import { readLifeNodes, lifeNodesGraph, saveLifeNode, patchLifeNode, placeLifeNodes, connectLifeNodes, migrateLifeNodes, LIFE_SOURCE_BACKUP } from '../../jobu/lifeNodeStore.js';
import { CARD_HEIGHT, CARD_WIDTH, LANE_WIDTH, alignedPosition, boardLayout, focusedLifeGraph, laneAt, lanePosition } from '../../lifeplanner/board.js';
import { flowIdentity, domainIdentity } from '../../lifeplanner/flowIdentity.js';
import useLifeNetwork from './useLifeNetwork.js';
import LifeNetworkPanel from './LifeNetworkPanel.jsx';
import LifeNodeEditor from './LifeNodeEditor.jsx';
import LifeMapGantt from './LifeMapGantt.jsx';
import SupportEdge from './SupportEdge.jsx';
import '@xyflow/react/dist/style.css';
import './lifeMap.css';
import './lifeBoard.css';
const ICONS = { wish: Star, vision: Compass, goal: Target, project: Layers, untyped: Inbox };
const MIME = 'application/x-jobu-life-node';

const BoardNode = memo(function BoardNode({ data, selected }) {
  const { t } = useTranslation(), Icon = ICONS[data.kind] || Check;
  return <div className={`lm-node lb-node lm-${data.kind} ${selected ? 'is-selected' : ''}`} data-life-node={data.id} data-kind={data.kind}>
    <Handle id="in" type="target" position={Position.Left} isConnectable={data.writable} />
    <div className="lm-node-type"><Icon size={13} /><span>{data.kind === 'untyped' ? t('lifeBoard.untyped') : t(`lifeMap.${data.kind}`)}</span>{data.completed && <Check size={13} />}</div>
    <div className="lm-node-title">{data.title || t('lifeBoard.untitled')}</div>
    {data.kind !== 'task' && <button type="button" className="lb-focus-node nodrag nopan" title={t('lifeBoard.focus')} aria-label={`${t('lifeBoard.focus')} · ${data.title}`} onClick={e => { e.stopPropagation(); data.onFocus(data.id); }}><Focus size={14} /></button>}
    {data.childCount > 0 && <span className="lb-child-count">{data.childCount}</span>}
    {data.kind !== 'task' && <Handle id="out" type="source" position={Position.Right} isConnectable={data.writable} />}
  </div>;
});
const NODE_TYPES = { life: BoardNode }, EDGE_TYPES = { lifeLink: SupportEdge };

function Canvas({ jobuData, onLeaveGuard, onNotebook, darkMode, readOnly = false, goals, projects, tasks, unscheduledTasks, recurringTasks, onOpen }) {
  const { t } = useTranslation(), B = useCallback((key, options) => t(`lifeBoard.${key}`, options), [t]);
  const status = useSyncExternalStore(jobuData.subscribe, jobuData.get, jobuData.get);
  const data = useMemo(() => { const all = readLifeNodes(status.records);
    return { ...all, nodes: visibleLifeNodes(all.nodes, goals, projects) };
  }, [status.records, goals, projects]);
  const graph = useMemo(() => lifeNodesGraph(data.nodes, { tasks, unscheduledTasks, recurringTasks }), [data.nodes, tasks, unscheduledTasks, recurringTasks]);
  const [view, setView] = useState('canvas'), [ganttInbox, setGanttInbox] = useState(false);
  const [query, setQuery] = useState(''), [showTasks, setShowTasks] = useState(false), [selection, select] = useState(null), [editorVersion, refreshEditor] = useState(0);
  const [stack, setStack] = useState([]), [preview, setPreview] = useState({}), [measured, setMeasured] = useState({});
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [newTitle, setNewTitle] = useState('');
  const [networkOpen, setNetworkOpen] = useState(false), [networkRequest, setNetworkRequest] = useState({ mode: 'overview' });
  const [selectedEdge, selectEdge] = useState(null), [viewport, setBoardViewport] = useState({x:0,y:0,zoom:1}), [fitRevision, fit] = useState(0);
  const zoom = viewport.zoom;
  const captureDraft = useRef(newTitle); captureDraft.current = newTitle;
  const busy = useRef(false), dirty = useRef(false), networkDirty = useRef(false), dragHeads = useRef(new Map()), createId = useRef(null), host = useRef(null), inboxRef = useRef(null);
  const onDirty = useCallback(value => { dirty.current = value; }, []), onNetworkDirty = useCallback(value => { networkDirty.current = value; }, []);
  const { screenToFlowPosition, setViewport, getViewport, fitView, setCenter, zoomIn, zoomOut, viewportInitialized } = useReactFlow();
  const snapshot = useRef(data); snapshot.current = data;
  const root = stack.at(-1)?.id || null;
  const filtered = useMemo(() => focusedLifeGraph(graph, { root, query, showTasks }), [graph, root, query, showTasks]);
  const positions = useMemo(() => boardLayout(graph.nodes), [graph.nodes]);
  const writable = status.loaded && status.writable && data.ready && !['format', 'storageRead'].includes(status.error) && !readOnly && !pending;
  const network = useLifeNetwork(jobuData, graph, networkOpen, readOnly || pending);
  const canLeave = useCallback((saved = false, keepCapture = false) => {
    if (busy.current || network.pending) return false;
    if (!saved && (dirty.current || networkDirty.current || (!keepCapture && captureDraft.current)) && !window.confirm(B('discard'))) return false;
    dirty.current = false; networkDirty.current = false; if (!keepCapture) setNewTitle(''); return true;
  }, [B, network.pending]);
  useEffect(() => {
    onLeaveGuard?.(canLeave);
    const unload = e => { if (dirty.current || networkDirty.current || captureDraft.current || busy.current || network.pending) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { onLeaveGuard?.(null); window.removeEventListener('beforeunload', unload); };
  }, [onLeaveGuard, canLeave, network.pending]);
  const run = useCallback(async operation => {
    if (busy.current || readOnly) return false;
    busy.current = true; setPending(true); setError('');
    try { await operation(); return true; } catch (e) { setError(e.message || 'storageWrite'); return false; }
    finally { busy.current = false; setPending(false); }
  }, [readOnly]);
  const choose = useCallback(id => {
    if (id === selection) return true;
    if (!canLeave()) return false;
    select(id); refreshEditor(v => v + 1); selectEdge(null); return true;
  }, [canLeave, selection]);
  const focus = useCallback(id => {
    if (!canLeave()) return;
    setStack(current => current.at(-1)?.id === id ? current : [...current, { id, viewport: getViewport() }]);
    select(id); refreshEditor(v => v + 1); setQuery(''); fit(n => n + 1);
  }, [canLeave, getViewport]);
  const back = index => {
    if (!canLeave()) return;
    const target = stack[index]; setStack(s => s.slice(0, index)); select(null); setQuery('');
    if (target?.viewport) setViewport(target.viewport); else fit(n => n + 1);
  };
  const requestNetwork = useCallback((request, saved = false) => {
    if (!saved && network.pending) return false;
    if (!saved && networkDirty.current && !window.confirm(B('discard'))) return false;
    networkDirty.current = false; setNetworkRequest(request); return true;
  }, [B, network.pending]);
  const nodes = useMemo(() => filtered.nodes.map(n => ({ id: flowIdentity(n.id), type: 'life',
    position: preview[n.id] || positions.get(n.id), width: CARD_WIDTH, height: CARD_HEIGHT, measured: measured[n.id],
    selected: selection === n.id, deletable: false, draggable: writable && n.kind !== 'task',
    data: { ...n, childCount: graph.edges.filter(e => e.source === n.id).length, writable: writable && n.kind !== 'task', onFocus: focus },
    ariaLabel: `${n.title || B('untitled')} · ${n.kind === 'untyped' ? B('untyped') : t(`lifeMap.${n.kind}`)}` })),
  [filtered, preview, positions, measured, selection, writable, graph.edges, focus, B, t]);
  const edges = useMemo(() => {
    const hierarchy = filtered.edges.map((e, i) => ({ ...e, id: flowIdentity(e.id), source: flowIdentity(e.source), target: flowIdentity(e.target),
      sourceHandle: 'out', targetHandle: 'in', type: 'lifeLink', data: { hierarchy: e, routeSlot: i % 4, nodeHeight: CARD_HEIGHT },
      selected: selectedEdge?.id === e.id, style: { opacity: networkOpen ? .3 : 1 }, markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }));
    if (!networkOpen) return hierarchy;
    const visible = new Set(filtered.nodes.map(n => n.id));
    return [...hierarchy, ...network.state.edges.filter(r => visible.has(r.value.source) && visible.has(r.value.target)).map((row, i) => ({
      id: flowIdentity(row.entityId), source: flowIdentity(row.value.source), target: flowIdentity(row.value.target), sourceHandle: 'out', targetHandle: 'in', type: 'lifeLink',
      data: { networkEntityId: row.entityId, routeSlot: i % 4, nodeHeight: CARD_HEIGHT }, label: t(`lifeNetwork.${row.value.relation}`),
      style: { stroke: row.value.relation === 'supports' ? '#5c9682' : '#b58b55', strokeWidth: 2, strokeDasharray: row.value.relation === 'requires' ? '6 4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }))];
  }, [filtered, networkOpen, network.state.edges, selectedEdge, t]);
  // Only explicit navigation fits the viewport; normal writes never jump it.
  useEffect(() => { if (!viewportInitialized || view !== 'canvas') return; const timer = setTimeout(() => {
    if (nodes.length) fitView({ nodes: nodes.map(n => ({ id: n.id })), padding: .25, minZoom: .3, maxZoom: .95, duration: 0 });
    else setViewport({ x: 180, y: 40, zoom: .75 });
  }, 80); return () => clearTimeout(timer); /* nodes handled via explicit fit trigger */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportInitialized, fitRevision, data.ready]);
  const drop = async (id, position, inbox = false) => {
    const row = snapshot.current.heads.get(id);
    if (!writable || !row || row.deleted || !canLeave()) { setPreview({}); return; }
    const nextType = inbox ? null : laneAt(position);
    const type = nextType === undefined ? row.value.type : nextType;
    const patch = { type, position: inbox ? null : alignedPosition(type, position), onCanvas: !inbox };
    await run(() => patchLifeNode(jobuData, id, patch, dragHeads.current.get(id) || row.id));
    setPreview({}); refreshEditor(n => n + 1); dragHeads.current.clear();
  };
  const connect = async connection => {
    const source = domainIdentity(connection.source), target = domainIdentity(connection.target);
    if (!writable || !canLeave()) return;
    if (networkOpen) { requestNetwork({ mode: 'edge', source, target }); return; }
    await run(() => connectLifeNodes(jobuData, source, target, snapshot.current.heads.get(target)?.id, snapshot.current.heads.get(source)?.id));
    refreshEditor(n => n + 1);
  };
  const create = async (parentId = null) => {
    if (!writable || !canLeave(false, parentId === null)) return;
    const parent = snapshot.current.nodes.find(n => n.id === parentId);
    const type = parent ? LIFE_TYPES[Math.min(3, LIFE_TYPES.indexOf(parent.type) + 1)] : null;
    if (!createId.current) createId.current = lifeKey('node', crypto.randomUUID());
    const id = createId.current;
    const row = createLifeNode({ id, type, title: parentId ? B('newChild') : newTitle.trim(), parentIds: parentId ? [parentId] : [] });
    if (await run(() => saveLifeNode(jobuData, row, null))) {
      createId.current = null; setNewTitle(''); select(id); refreshEditor(n => n + 1); if (parentId) fit(n => n + 1);
    }
  };
  const inbox = data.nodes.filter(n => n.type === null && !n.onCanvas && (!query || n.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const spread = async () => {
    if (!writable || !canLeave()) return;
    const all = boardLayout(graph.nodes);
    if (await run(() => placeLifeNodes(jobuData, inbox.map(n => ({ id: n.id, expectedHead: data.heads.get(n.id).id, position: all.get(n.id) }))))) {
      // canLeave already resolved any draft. The placement created new heads;
      // keep the selected clean editor aligned with our committed placement.
      refreshEditor(n => n + 1); fit(n => n + 1);
    }
  };
  const activeRow = data.heads.get(selection), selectedTask = graph.nodes.find(n => n.id === selection && n.kind === 'task');
  const laneHeight = Math.max(900, ...[...positions.values()].map(p => p.y + 250));
  const cycleCount = lifeHierarchyCycles(data.nodes).length;
  const orphanCount = data.nodes.filter(n => n.parentIds.some(id => !data.nodes.some(parent => parent.id === id))).length;
  const networkEdgeCount = edges.filter(e => e.data?.networkEntityId).length;
  return <section className="life-map life-board" data-life-map data-life-board data-map-view={view} data-gantt-inbox={ganttInbox} data-inline-edit="" aria-label={B('title')}
    onKeyDownCapture={e => {
      if (!e.target.classList.contains('react-flow__node')) return;
      const id = domainIdentity(e.target.dataset.id), row = data.heads.get(id);
      if (!row || row.deleted) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) focus(id); else choose(id); }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); if (!writable) return;
        const p = positions.get(id), delta = { ArrowUp:[0,-24], ArrowDown:[0,24], ArrowLeft:[-LANE_WIDTH,0], ArrowRight:[LANE_WIDTH,0] }[e.key];
        drop(id, { x:p.x + delta[0], y:p.y + delta[1] });
      }
    }}
    onKeyDown={e => {
      if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
      e.stopPropagation(); e.preventDefault();
      if (!canLeave()) return;
      if (networkOpen) setNetworkOpen(false); else if (selection) select(null); else if (stack.length) back(stack.length - 1);
    }}>
    <div className="lm-toolbar lb-toolbar"><div className="flex items-center gap-1" role="group" aria-label={t('lifeGantt.view')}>
      {['canvas', 'gantt'].map(mode => <button key={mode} type="button" aria-pressed={view === mode}
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === mode ? 'bg-accent-600 text-white' : ''}`}
        onClick={() => { if (view !== mode && canLeave()) { setView(mode); refreshEditor(v => v + 1); selectEdge(null); setNetworkOpen(false); } }}>
        {mode === 'canvas' ? <GitBranch size={14} /> : <CalendarDays size={14} />}{t(mode === 'canvas' ? 'lifeGantt.canvas' : 'lifeGantt.title')}
      </button>)}
    </div>{view === 'gantt' && <button type="button" className="lb-gantt-inbox-toggle" aria-expanded={ganttInbox} onClick={() => setGanttInbox(v => !v)}><Inbox size={14} />{B('inbox')} ({inbox.length})</button>}<label className="lm-search"><Search size={14} /><input aria-label={B('search')} placeholder={B('search')} value={query} onChange={e => { setQuery(e.target.value); fit(n => n + 1); }} /></label>
      <label className="lm-unlinked"><input type="checkbox" checked={showTasks} onChange={e => { setShowTasks(e.target.checked); fit(n => n + 1); }} />{B('showTasks')}</label>
      <button type="button" aria-pressed={networkOpen} onClick={() => { if (canLeave()) { select(null); setNetworkOpen(x => !x); } }}><GitBranch size={14} />{t('lifeNetwork.title')}</button>
      <button type="button" onClick={() => { if (canLeave()) onNotebook(); }}><BookOpen size={14} />{B('notebook')}</button></div>
    <nav className="lb-breadcrumb" aria-label={B('focusPath')}><button onClick={() => back(0)}>{B('all')}</button>
      {stack.map((s, i) => <React.Fragment key={`${s.id}:${i}`}><span>›</span><button aria-current={i === stack.length - 1 ? 'page' : undefined} onClick={() => { if (i < stack.length - 1) back(i + 1); }}>{data.nodes.find(n => n.id === s.id)?.title || B('missingNode')}</button></React.Fragment>)}
      <span className="lm-count">{B('count', { count: filtered.nodes.length })}{root ? ` · ${B('externalLinks', { count: filtered.externalEdges.length })}` : ''}</span></nav>
    {(cycleCount > 0 || orphanCount > 0) && <p className="lb-diagnostics" role="status">{cycleCount > 0 ? B('cycleWarning', {count:cycleCount}) : ''} {orphanCount > 0 ? B('orphanWarning', {count:orphanCount}) : ''}</p>}
    <div className="lb-body">
      <aside ref={inboxRef} className="lb-inbox" aria-label={B('inbox')} onDragOver={e => { if (e.dataTransfer.types.includes(MIME)) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData(MIME); if (id) drop(id, { x: -270, y: 90 }, true); }}>
        <h3><Inbox size={16} />{B('inbox')}<span>{inbox.length}</span></h3>
        <p>{B('inboxHint')}</p>
        <form onSubmit={e => { e.preventDefault(); if (newTitle.trim()) create(); }}><input aria-label={B('quickAdd')} placeholder={B('quickAdd')} value={newTitle} maxLength={2000} disabled={!writable} onChange={e => { setNewTitle(e.target.value); createId.current = null; }} /><button type="submit" disabled={!writable || !newTitle.trim()} aria-label={B('add')}><Plus size={16} /></button></form>
        <button className="lb-spread" type="button" onClick={spread} disabled={!writable || !inbox.length}>{B('spread')}</button>
        <div className="lb-inbox-list">{inbox.map(n => <div key={n.id} className="lb-inbox-card" draggable={writable} data-inbox-node={n.id}
          onDragStart={e => { dragHeads.current.set(n.id, data.heads.get(n.id).id); e.dataTransfer.setData(MIME, n.id); e.dataTransfer.effectAllowed = 'move'; }}>
          <button type="button" onClick={() => choose(n.id)}>{n.title || B('untitled')}</button>
          <button type="button" disabled={!writable} aria-label={`${B('place')} · ${n.title}`} onClick={async () => { if (!canLeave()) return; if (await run(() => placeLifeNodes(jobuData, [{ id: n.id, expectedHead: data.heads.get(n.id).id, position: positions.get(n.id) }]))) { select(n.id); refreshEditor(x => x + 1); fit(x => x + 1); } }}><Plus size={13} /></button>
        </div>)}</div>
      </aside>
      <LifeMapGantt graph={filtered} nodes={data.nodes} tasks={tasks} unscheduledTasks={unscheduledTasks} recurringTasks={recurringTasks}
        goals={goals} projects={projects} selectedId={selection} onSelect={choose} onFocus={focus} root={root} ready={status.loaded && data.ready} active={view === 'gantt'} />
      <div className="lm-canvas lb-canvas" style={view === 'gantt' ? { display: 'none' } : undefined} ref={host} data-life-map-canvas onDragOver={e => { if (e.dataTransfer.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
        onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData(MIME); if (id) { const p = screenToFlowPosition({ x: e.clientX, y: e.clientY }); drop(id, { x: p.x - CARD_WIDTH / 2, y: p.y - 35 }); } }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
          onNodeClick={(_e, node) => { const id = domainIdentity(node.id); if (networkOpen) requestNetwork({ mode: 'node', nodeId: id }); else choose(id); }}
          onNodeDoubleClick={(_e, node) => { if (node.data.kind !== 'task') focus(domainIdentity(node.id)); }}
          onPaneClick={() => { if (canLeave()) { select(null); selectEdge(null); } }}
          onNodesChange={changes => {
            const sizes = changes.filter(c => c.type === 'dimensions' && c.dimensions);
            if (sizes.length) setMeasured(prev => ({ ...prev, ...Object.fromEntries(sizes.map(c => [domainIdentity(c.id), c.dimensions])) }));
            const moves = changes.filter(c => c.type === 'position' && c.position);
            if (moves.length) setPreview(prev => ({ ...prev, ...Object.fromEntries(moves.map(c => [domainIdentity(c.id), c.position])) }));
          }}
          onNodeDragStart={(_e, node) => { const id = domainIdentity(node.id); dragHeads.current.set(id, data.heads.get(id)?.id); }}
          onNodeDragStop={(event, node) => { const id = domainIdentity(node.id); const sidebar = inboxRef.current?.getBoundingClientRect();
            const isInbox = sidebar && event.clientX < sidebar.right && event.clientX >= sidebar.left && event.clientY >= sidebar.top && event.clientY <= sidebar.bottom; drop(id, node.position, isInbox); }}
          onConnect={connect} isValidConnection={c => c.source !== c.target && c.sourceHandle === 'out' && c.targetHandle === 'in'}
          onEdgeClick={(_e, edge) => { if (edge.data?.networkEntityId) requestNetwork({ mode: 'edge', entityId: edge.data.networkEntityId }); else if (canLeave()) { select(null); selectEdge(edge.data?.hierarchy || null); } }}
          onMove={(_e, value) => setBoardViewport(value)} nodesConnectable={writable} deleteKeyCode={null} selectionOnDrag={false}
          selectNodesOnDrag={false} nodeDragThreshold={6} connectionRadius={28} minZoom={.2} maxZoom={2} colorMode={darkMode ? 'dark' : 'light'}>
          <Background gap={24} size={1} />
          <ViewportPortal><div className="lb-lanes" aria-hidden="true">{[null, ...LIFE_TYPES, ...(showTasks ? ['task'] : [])].map((type, i) =>
            <div className={`lb-lane lb-lane-${type || 'untyped'}`} key={type || 'untyped'} style={{ left: (i - 1) * LANE_WIDTH, width: LANE_WIDTH, top: -1000, height: laneHeight + 1000 }}>
              <div className="lb-lane-heading" style={{ top: 1000 + (16 - viewport.y) / zoom }}>{type === null ? B('staging') : t(`lifeMap.${type}`)}</div>
            </div>)}</div></ViewportPortal>
        </ReactFlow>
        {!data.ready && <div className="lm-empty"><h2>{B('preparing')}</h2><p>{B('migrationHint')}</p><button disabled={!status.writable || pending} onClick={() => run(() => migrateLifeNodes(jobuData))}>{B('retry')}</button></div>}
        {root && !data.nodes.some(n => n.id === root) && <div className="lm-empty"><p>{B('missingNode')}</p><button onClick={() => back(0)}>{B('all')}</button></div>}
        <div className="lm-navigation"><button aria-label={B('zoomOut')} onClick={() => zoomOut()}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label={B('zoomIn')} onClick={() => zoomIn()}><Plus size={16} /></button><button aria-label={B('fit')} onClick={() => fit(v => v + 1)}><Expand size={16} /></button></div>
      </div>
      {!networkOpen && activeRow && activeRow.kind === 'lifeNode' && <LifeNodeEditor key={`${selection}:${editorVersion}`} row={activeRow} liveRow={activeRow} nodes={data.nodes} data={jobuData}
        writable={writable} pending={pending} run={run} onDirty={onDirty} onFocus={focus} onChild={create}
        onClose={saved => { if (canLeave(saved === true)) select(null); }} onRefresh={saved => { if (canLeave(saved === true)) refreshEditor(v => v + 1); }} />}
      {!networkOpen && selectedTask && <aside className="lb-editor"><h3>{selectedTask.title}</h3><p>{B('taskHint')}</p><button onClick={() => onOpen?.(selectedTask)}>{B('openTask')}</button></aside>}
      {!networkOpen && selectedEdge && <aside className="lb-editor"><h3>{B('hierarchyLink')}</h3><p>{B('hierarchyHint')}</p><button disabled={!writable} onClick={async () => {
        const child = data.heads.get(selectedEdge.target);
        if (child && await run(() => patchLifeNode(jobuData, child.entityId, { parentIds: child.value.parentIds.filter(p => p !== selectedEdge.source) }, child.id))) selectEdge(null);
      }}>{B('unlink')}</button></aside>}
      {networkOpen && <LifeNetworkPanel controller={network} request={networkRequest} onRequest={requestNetwork} onDirty={onNetworkDirty}
        onClose={() => { if (canLeave()) setNetworkOpen(false); }} hiddenCount={network.state.edges.length - networkEdgeCount}
        onFocusNode={id => { const node = graph.nodes.find(n => n.id === id); if (!node) return;
          if (root && !filtered.nodes.some(n => n.id === id)) { setStack([]); setQuery(''); }
          const p = positions.get(id); if (p) setCenter(p.x + CARD_WIDTH / 2, p.y + CARD_HEIGHT / 2, { zoom: .9 }); }} />}
    </div>
    {(error || status.error) && <p className="lm-error" role="alert">{B(`errors.${error || status.error}`, { defaultValue: B('errors.storageWrite') })}<button onClick={() => { setError(''); jobuData.load(); }}>{B('retry')}</button></p>}
    <div className="lb-footer"><p className="lm-footnote">{pending ? B('saving') : view === 'gantt' ? t('lifeGantt.hint') : B('hint')}</p><button type="button" onClick={() => {
      try { const raw = localStorage.getItem(LIFE_SOURCE_BACKUP); if (!raw) throw Error('storageRead');
        const url = URL.createObjectURL(new Blob([raw], {type:'application/json'})), a = document.createElement('a');
        a.href = url; a.download = 'jobu-life-sources-before-upgrade.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) { setError(e.message || 'storageRead'); }
    }}><Download size={12} />{B('sourceBackup')}</button></div>
  </section>;
}
export default function UnifiedLifeMap(props) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
