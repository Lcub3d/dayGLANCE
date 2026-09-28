import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, GitBranch, Plus, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SCENARIO, pairwisePriorities, UNALLOCATED } from '../../lifeplanner/supportNetwork.js';
import { calibrateNetworkTarget, deleteNetworkRecord, edgeId, judgmentId, saveNetworkEdge, saveNetworkEvaluation, saveNetworkScenario, valueId } from '../../jobu/lifeNetworkStore.js';
import './lifeNetwork.css';
const format = (v, max = 1) => v == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(v);
const percent = v => v == null ? '—' : `${format(100 * v)}%`;
const numberInput = value => value.trim() === '' ? null : Number(value);
function useDirty(dirty, onDirty) {
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
}
function Field({ label, children, hint }) {
  const control = React.isValidElement(children) ? React.cloneElement(children, { 'aria-label': children.props['aria-label'] || label }) : children;
  return <label className="ln-field"><span>{label}</span>{control}{hint && <small>{hint}</small>}</label>;
}
function NetworkError({ code, N }) {
  return code ? <p role="alert" className="ln-error">{N(`errors.${code}`, { defaultValue: N('errors.storageWrite') })}</p> : null;
}
function EvaluationEditor({ node, controller: c, N, onDirty, onRequest }) {
  const key = valueId(c.scenarioId, node.id), liveRow = c.state.heads.get(key);
  const [opened] = useState(liveRow);
  const original = opened && !opened.deleted ? opened.value : { baseValue: null, note: '' };
  const [base, setBase] = useState(original.baseValue == null ? '' : String(original.baseValue));
  const [note, setNote] = useState(original.note);
  const dirty = base !== (original.baseValue == null ? '' : String(original.baseValue)) || note !== original.note;
  useDirty(dirty, onDirty);
  const stale = (liveRow?.id ?? null) !== (opened?.id ?? null);
  const result = c.analysis?.rows.find(r => r.id === node.id);
  const relations = c.state.edges.filter(r => r.value.source === node.id || r.value.target === node.id);
  const incoming = relations.filter(r => r.value.relation === 'supports' && r.value.target === node.id);
  const title = id => c.nodes.find(n => n.id === id)?.title || N('missingNode');
  return <>
    <div className="ln-node-heading"><small>{N(`kinds.${node.kind}`)}</small><h3>{node.title}</h3></div>
    <form onSubmit={async event => { event.preventDefault(); await c.run(() => saveNetworkEvaluation(c.data,
      { version: 1, scenarioId: c.scenarioId, nodeId: node.id, baseValue: numberInput(base), note }, opened?.id ?? null, c.getNodes)); }}>
      <Field label={N('selfValue')} hint={N('selfHint')}><input aria-label={N('selfValue')} type="number" min="0" max="100" step="any" placeholder={N('unassessed')} value={base} onChange={e => setBase(e.target.value)} disabled={!c.writable} /></Field>
      <Field label={N('reason')}><textarea value={note} maxLength={4000} onChange={e => setNote(e.target.value)} disabled={!c.writable} /></Field>
      {stale && <NetworkError code="conflict" N={N} />}
      <div className="ln-actions"><button type="submit" disabled={!c.writable || stale}>{N('save')}</button><button type="button" disabled={c.pending} onClick={() => onRequest({ mode: 'node', nodeId: node.id, refresh: Date.now() })}>{N('reload')}</button>
      {opened && !opened.deleted && <button type="button" className="ln-danger" disabled={!c.writable || stale} onClick={async () => { if (window.confirm(N('deleteValueConfirm'))) await c.run(() => deleteNetworkRecord(c.data, opened)); }}>{N('deleteValue')}</button>}</div>
    </form>
    {result && <section className="ln-explanation"><h4>{N('explanation')}</h4>
      <dl><dt>{N('selfValue')}</dt><dd>{format(result.baseValue)}</dd><dt>{N('supportValue')}</dt><dd>{format(result.supportValue)}</dd><dt>{c.analysis.complete ? N('totalScore') : N('knownSubtotal')}</dt><dd>{format(result.knownScore)}</dd><dt>{N('relativeWeight')}</dt><dd>{percent(result.weight)}</dd></dl>
      {!c.analysis.complete && <p>{N('partialHint')}</p>}
      {result.causes.length > 0 && <ul>{result.causes.map(cause => <li key={cause.target}><span>{title(cause.target)} × {percent(cause.weight)} × {format(c.state.scenario.value.alpha, 2)}</span><b>+{format(cause.contribution)}</b></li>)}</ul>}
      <p>{N(`conditionState.${result.prerequisiteState}`)}</p>
      {result.rankRange && <p>{N('rankRange', { low: result.rankRange[0], high: result.rankRange[1] })}</p>}
    </section>}
    <div className="ln-section-heading"><h4>{N('relations')}</h4><button type="button" disabled={!c.writable} onClick={() => onRequest({ mode: 'edge', source: node.id })}><Plus size={14} />{N('addRelation')}</button></div>
    <RelationList rows={relations} c={c} N={N} onRequest={onRequest} />
    {incoming.length > 0 && <button type="button" className="ln-wide-button" disabled={!c.writable || incoming.length > 7} onClick={() => onRequest({ mode: 'compare', target: node.id })}>{N('compareSupports')}</button>}
    {incoming.length > 7 && <small>{N('compareLimit')}</small>}
  </>;
}
function RelationList({ rows, c, N, onRequest }) {
  const title = id => c.nodes.find(n => n.id === id)?.title || N('missingNode');
  return <div className="ln-relation-list">{rows.length ? rows.map(row => <button type="button" key={row.entityId} className={`ln-relation-item is-${row.value.relation}`} onClick={() => onRequest({ mode: 'edge', entityId: row.entityId })}>
    <span>{title(row.value.source)} <ArrowRight size={12} /> {title(row.value.target)}</span>
    <small>{N(row.value.relation)} · {row.value.relation === 'supports' ? row.value.weight === null ? N('unweighted') : percent(row.value.weight) : N(`condition.${row.value.condition}`)}</small>
  </button>) : <p className="ln-hint">{N('noRelations')}</p>}</div>;
}
function RelationEditor({ request, controller: c, N, onDirty, onRequest }) {
  const [openedHeads] = useState(c.state.heads);
  const [opened] = useState(request.entityId ? c.state.heads.get(request.entityId) : null);
  const initial = opened?.value || { source: request.source || '', target: request.target || '', relation: 'supports', weight: null, condition: 'unknown', note: '' };
  const [source, setSource] = useState(initial.source), [target, setTarget] = useState(initial.target);
  const [relation, setRelation] = useState(initial.relation), [weight, setWeight] = useState(initial.weight === null ? '' : String(initial.weight * 100));
  const [condition, setCondition] = useState(initial.condition), [note, setNote] = useState(initial.note);
  useDirty(source !== initial.source || target !== initial.target || relation !== initial.relation || weight !== (initial.weight === null ? '' : String(initial.weight * 100)) || condition !== initial.condition || note !== initial.note, onDirty);
  const value = { version: 1, scenarioId: c.scenarioId, source, target, relation, weight: relation === 'supports' && numberInput(weight) !== null ? numberInput(weight) / 100 : null, condition, note };
  const key = edgeId(value), oldHead = opened?.id ?? openedHeads.get(key)?.id ?? null;
  const duplicate = !opened && openedHeads.get(key) && !openedHeads.get(key).deleted;
  const stale = (c.state.heads.get(key)?.id ?? null) !== oldHead;
  const missing = !c.nodes.some(n => n.id === source) || !c.nodes.some(n => n.id === target);
  const used = c.state.edges.filter(r => r.entityId !== key && r.value.target === target && r.value.relation === 'supports').reduce((sum, r) => sum + (r.value.weight ?? 0), 0);
  const choices = [...c.nodes].sort((a, b) => a.title.localeCompare(b.title));
  const select = (label, selected, set, exclude) => <Field label={label}><select value={selected} disabled={!c.writable || !!opened} aria-label={label} onChange={e => set(e.target.value)} required>
    <option value="">{N('chooseNode')}</option>{selected && !choices.some(n => n.id === selected) && <option value={selected}>{N('missingNode')}</option>}{choices.filter(n => n.id !== exclude).map(n => <option key={n.id} value={n.id}>{N(`kinds.${n.kind}`)} · {n.title}</option>)}
  </select></Field>;
  return <form onSubmit={async event => { event.preventDefault(); if (await c.run(() => saveNetworkEdge(c.data, value, oldHead, c.getNodes))) onRequest({ mode: 'relations' }, true); }}>
    <h3>{opened ? N('editRelation') : N('addRelation')}</h3><p className="ln-hint">{N('directionHint')}</p>
    {select(N('source'), source, setSource, target)}{select(N('target'), target, setTarget, source)}
    <Field label={N('relationType')}><select value={relation} disabled={!c.writable || !!opened} onChange={e => setRelation(e.target.value)}><option value="supports">{N('supports')}</option><option value="requires">{N('requires')}</option></select></Field>
    {relation === 'supports' ? <Field label={N('supportShare')} hint={N('shareHint', { used: percent(used) })}><input aria-label={N('supportShare')} type="number" min="0" max="100" step="any" value={weight} placeholder={N('unweighted')} disabled={!c.writable} onChange={e => setWeight(e.target.value)} /></Field>
      : <Field label={N('conditionLabel')} hint={N('conditionHint')}><select aria-label={N('conditionLabel')} value={condition} disabled={!c.writable} onChange={e => setCondition(e.target.value)}>{['unknown', 'met', 'unmet'].map(k => <option key={k} value={k}>{N(`condition.${k}`)}</option>)}</select></Field>}
    <Field label={N('reason')}><textarea maxLength={4000} value={note} disabled={!c.writable} onChange={e => setNote(e.target.value)} /></Field>
    {duplicate && <p className="ln-error">{N('duplicate')}</p>}{stale && <NetworkError code="conflict" N={N} />}{missing && opened && <p className="ln-error">{N('orphanHint')}</p>}
    <div className="ln-actions"><button type="submit" disabled={!c.writable || !!duplicate || stale || missing || source === target}>{N('save')}</button><button type="button" disabled={c.pending} onClick={() => onRequest({ mode: 'relations' })}>{N('cancel')}</button>
      {opened && <button type="button" className="ln-danger" disabled={!c.writable || stale} onClick={async () => { if (window.confirm(N('deleteConfirm')) && await c.run(() => deleteNetworkRecord(c.data, opened))) onRequest({ mode: 'relations' }, true); }}>{N('deleteRelation')}</button>}</div>
  </form>;
}
function ScenarioEditor({ request, controller: c, N, onDirty, onRequest }) {
  const [key] = useState(() => request.new ? `lifeNetwork:${crypto.randomUUID()}` : c.scenarioId);
  const [opened] = useState(request.new ? null : c.state.scenario);
  const original = opened?.value || DEFAULT_SCENARIO;
  const [name, setName] = useState(original.name), [horizon, setHorizon] = useState(original.horizon), [alpha, setAlpha] = useState(original.alpha);
  useDirty(name !== original.name || horizon !== original.horizon || alpha !== original.alpha, onDirty);
  return <form onSubmit={async event => { event.preventDefault(); if (await c.run(() => saveNetworkScenario(c.data, key, { version: 1, name, horizon, alpha }, opened?.id ?? null))) { c.setScenarioId(key); onRequest({ mode: 'overview' }, true); } }}>
    <h3>{request.new ? N('newScenario') : N('scenarioSettings')}</h3>
    <Field label={N('scenarioName')}><input aria-label={N('scenarioName')} required={!!request.new} maxLength={120} placeholder={N('defaultScenario')} value={name} disabled={!c.writable} onChange={e => setName(e.target.value)} /></Field>
    <Field label={N('horizon')} hint={N('horizonHint')}><textarea aria-label={N('horizon')} maxLength={1000} value={horizon} disabled={!c.writable} onChange={e => setHorizon(e.target.value)} /></Field>
    <Field label={`${N('alpha')} · ${format(alpha, 2)}`} hint={N('alphaHint')}><input aria-label={N('alpha')} type="range" min="0" max=".9" step=".05" value={alpha} disabled={!c.writable} onChange={e => setAlpha(Number(e.target.value))} /></Field>
    <div className="ln-actions"><button type="submit" disabled={!c.writable}>{N('save')}</button><button type="button" disabled={c.pending} onClick={() => onRequest({ mode: 'overview' })}>{N('cancel')}</button></div>
  </form>;
}
function PairwiseEditor({ target, controller: c, N, onDirty, onRequest }) {
  const [openedEdges] = useState(() => c.state.edges.filter(r => r.value.target === target && r.value.relation === 'supports').sort((a, b) => a.value.source.localeCompare(b.value.source, 'en')));
  const [previous] = useState(() => c.state.heads.get(judgmentId(c.scenarioId, target)));
  const members = useMemo(() => openedEdges.map(r => r.value.source).sort().concat(UNALLOCATED), [openedEdges]);
  const [answers, setAnswers] = useState({});
  useDirty(Object.keys(answers).length > 0, onDirty);
  const title = id => id === UNALLOCATED ? N('otherFactors') : c.nodes.find(n => n.id === id)?.title || N('missingNode');
  const pairs = useMemo(() => members.flatMap((a, i) => members.slice(i + 1).map(b => ({ a, b, key: JSON.stringify([a, b]) }))), [members]);
  const judgments = pairs.filter(p => answers[p.key] !== undefined && answers[p.key] !== '').map(p => ({ a: p.a, b: p.b, ratio: Number(answers[p.key]) }));
  const result = members.length >= 2 && members.length <= 8 ? pairwisePriorities(members, judgments) : null;
  if (!result) return <p>{N('compareLimit')}</p>;
  return <form onSubmit={async event => { event.preventDefault(); if (await c.run(() => calibrateNetworkTarget(c.data, { scenarioId: c.scenarioId, target, openedEdges, judgments, expectedJudgment: previous?.id ?? null }, c.getNodes))) onRequest({ mode: 'node', nodeId: target }, true); }}>
    <h3>{N('compareSupports')}</h3><p>{title(target)}</p><p className="ln-hint">{N('pairwiseHint')}</p>
    {pairs.map(p => <Field key={p.key} label={`${title(p.a)} ↔ ${title(p.b)}`}><select value={answers[p.key] ?? ''} disabled={!c.writable} required onChange={e => setAnswers(a => ({ ...a, [p.key]: e.target.value }))}>
      <option value="">{N('unassessed')}</option><option value="1">{N('equal')}</option>{[2, 3, 5, 7, 9].map(r => <option key={r} value={r}>{N('prefer', { name: title(p.a), ratio: r })}</option>)}{[2, 3, 5, 7, 9].map(r => <option key={`r${r}`} value={1 / r}>{N('prefer', { name: title(p.b), ratio: r })}</option>)}
    </select></Field>)}
    {result.complete ? <><p className={result.consistent ? 'ln-hint' : 'ln-error'}>{N('consistency', { value: percent(result.consistencyRatio) })}</p><dl>{members.map(k => <React.Fragment key={k}><dt>{title(k)}</dt><dd>{percent(result.weights[k])}</dd></React.Fragment>)}</dl>{!result.consistent && <p className="ln-error">{N('inconsistent')}</p>}</> : <p className="ln-hint">{N('remainingPairs', { count: result.missing })}</p>}
    <div className="ln-actions"><button type="submit" disabled={!c.writable || !result.complete || !result.consistent}>{N('applyWeights')}</button><button type="button" disabled={c.pending} onClick={() => onRequest({ mode: 'node', nodeId: target })}>{N('cancel')}</button></div>
  </form>;
}
function Overview({ c, N, onRequest, onFocusNode }) {
  const a = c.analysis;
  if (!a) return <p className="ln-hint">{N('loading')}</p>;
  return <>
    <p className="ln-hint">{N('overviewHint')}</p>
    {!a.rows.length && <p className="ln-empty">{N('empty')}</p>}
    {(a.unassessed.length > 0 || a.unweighted.length > 0) && <p className="ln-warning">{N('calibrationMissing', { values: a.unassessed.length, edges: a.unweighted.length })}</p>}
    {(a.duplicates.length > 0 || a.duplicateValues.length > 0) && <p role="alert" className="ln-error">{N('duplicateData')}</p>}
    {a.overBudget.length > 0 && <p role="alert" className="ln-error">{N('errors.networkBudget')}</p>}
    {a.conflictIds.length > 0 && <p role="alert" className="ln-error">{N('dependencyConflict')}</p>}
    {a.dangling.length > 0 && <p role="alert" className="ln-warning">{N('orphans', { count: a.dangling.length })}</p>}
    <div className="ln-ranking" aria-label={N('ranking')}>{a.rows.map(row => <button type="button" data-network-ranking={row.id} key={row.id} onClick={() => { if (onRequest({ mode: 'node', nodeId: row.id })) onFocusNode(row); }}>
      <span className="ln-rank">{row.rank ?? '—'}</span><span className="ln-rank-title">{row.title}<small>{N('selfShort')} {format(row.baseValue)} · {N('supportShort')} {format(row.supportValue)}{row.prerequisiteState === 'unmet' && ` · ${N('blocked')}`}</small></span><b>{percent(row.weight)}</b>
    </button>)}</div>
    {a.rows.length > 0 && <p className="ln-hint">{a.complete ? N('sensitivityHint', { values: a.testedAlphas.map(v => format(v, 2)).join(' / ') }) : N('partialHint')}</p>}
    {a.rows.some(r => r.rankRange && r.rankRange[0] !== r.rankRange[1]) && <p className="ln-warning">{N('rankUnstable')}</p>}
    {a.budgets.length > 0 && <details><summary>{N('allocationBudgets')}</summary>{a.budgets.map(b => <p key={b.target}>{c.nodes.find(n => n.id === b.target)?.title || N('missingNode')} · {percent(b.allocated)} / 100%{b.unknown > 0 && ` · ${N('unweighted')} ${b.unknown}`}</p>)}</details>}
    {a.dangling.length > 0 && <details open><summary>{N('unresolved')}</summary>
      <RelationList rows={c.state.edges.filter(r => a.dangling.includes(r.value.source) || a.dangling.includes(r.value.target))} c={c} N={N} onRequest={onRequest} />
      {c.state.evaluations.filter(r => a.dangling.includes(r.value.nodeId)).map(row => <div className="ln-orphan-value" key={row.entityId}><code>{row.value.nodeId}</code><p>{N('selfShort')} {format(row.value.baseValue)}</p><button type="button" disabled={!c.writable} onClick={async () => { if (window.confirm(N('deleteValueConfirm'))) await c.run(() => deleteNetworkRecord(c.data, row)); }}>{N('deleteValue')}</button></div>)}
    </details>}
    <details className="ln-method"><summary>{N('method')}</summary><p>{N('methodHint')}</p><code>S = B + α A S</code><p>{N('notPriority')}</p><p>{N('doubleCountHint')}</p><p>{N('backupHint')}</p></details>
  </>;
}
export default function LifeNetworkPanel({ controller: c, request, onRequest, onDirty, onFocusNode, onClose, hiddenCount }) {
  const { t } = useTranslation(); const N = (key, options) => t(`lifeNetwork.${key}`, options);
  const node = c.nodes.find(n => n.id === request.nodeId);
  return <aside className="lm-network-panel" aria-label={N('title')} data-life-network onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
    <header><span><GitBranch size={16} />{N('title')}</span><button type="button" aria-label={N('close')} onClick={onClose}><X size={17} /></button></header>
    <div className="ln-scene-row"><select aria-label={N('scenario')} value={c.state.scenario ? c.scenarioId : ''} disabled={c.pending} onChange={e => { if (onRequest({ mode: 'overview' })) c.setScenarioId(e.target.value); }}>
      {!c.state.scenario && <option value="">{N('chooseScenario')}</option>}{c.state.scenarios.map(s => <option key={s.entityId} value={s.entityId}>{s.value.name || N('defaultScenario')}</option>)}</select>
      <button type="button" disabled={!c.writable} aria-label={N('newScenario')} title={N('newScenario')} onClick={() => onRequest({ mode: 'settings', new: true, refresh: Date.now() })}><Plus size={15} /></button>
      <button type="button" disabled={!c.state.scenario} aria-label={N('scenarioSettings')} title={N('scenarioSettings')} onClick={() => onRequest({ mode: 'settings' })}><SlidersHorizontal size={15} /></button></div>
    <nav aria-label={N('navigation')}><button type="button" aria-pressed={request.mode === 'overview'} onClick={() => onRequest({ mode: 'overview' })}>{N('ranking')}</button><button type="button" aria-pressed={request.mode === 'relations'} onClick={() => onRequest({ mode: 'relations' })}>{N('relations')} ({c.state.edges.length})</button><button type="button" disabled={!c.writable || !c.state.scenario} onClick={() => onRequest({ mode: 'edge', source: node?.id })}>{N('addRelation')}</button></nav>
    <div className="ln-content">
      {c.state.scenario?.value.horizon && <p className="ln-horizon">{c.state.scenario.value.horizon}</p>}
      {!c.status.loaded ? <p role="status">{N('loading')}</p> : !c.status.writable && <p role="status">{N('readOnly')}</p>}
      <NetworkError code={c.error || c.status.error} N={N} />
      {c.pending && <p role="status">{N('saving')}</p>}
      {hiddenCount > 0 && <p className="ln-hint">{N('hiddenRelations', { count: hiddenCount })}</p>}
      {request.mode === 'overview' && <Overview c={c} N={N} onRequest={onRequest} onFocusNode={onFocusNode} />}
      {request.mode === 'relations' && <RelationList rows={c.state.edges} c={c} N={N} onRequest={onRequest} />}
      {request.mode === 'node' && node && <EvaluationEditor key={`${c.scenarioId}:${node.id}:${request.refresh || ''}:${c.editRevision}`} node={node} controller={c} N={N} onDirty={onDirty} onRequest={onRequest} />}
      {request.mode === 'edge' && <RelationEditor key={`${c.scenarioId}:${request.entityId || 'new'}:${request.source || ''}:${request.target || ''}:${request.refresh || ''}`} request={request} controller={c} N={N} onDirty={onDirty} onRequest={onRequest} />}
      {request.mode === 'settings' && <ScenarioEditor key={`${c.scenarioId}:${request.new ? 'new' : 'edit'}:${request.refresh || ''}`} request={request} controller={c} N={N} onDirty={onDirty} onRequest={onRequest} />}
      {request.mode === 'compare' && <PairwiseEditor key={`${c.scenarioId}:${request.target}`} target={request.target} controller={c} N={N} onDirty={onDirty} onRequest={onRequest} />}
    </div>
    <footer>{N('legend')}</footer>
  </aside>;
}
