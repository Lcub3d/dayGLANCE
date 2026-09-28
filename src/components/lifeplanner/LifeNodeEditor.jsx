import React, { useEffect, useState } from 'react';
import { Focus, Plus, Save, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LIFE_TYPES } from '../../lifeplanner/entities.js';
import { patchLifeNode, deleteLifeNode } from '../../jobu/lifeNodeStore.js';
import { alignedPosition } from '../../lifeplanner/board.js';

export default function LifeNodeEditor({ row, liveRow, nodes, data, writable, pending, run, onDirty, onFocus, onChild, onClose, onRefresh }) {
  const { t } = useTranslation(), B = (key, options) => t(`lifeBoard.${key}`, options);
  const [opened] = useState(row), [title, setTitle] = useState(row.value.title), [description, setDescription] = useState(row.value.description);
  const [type, setType] = useState(row.value.type), [parents, setParents] = useState(row.value.parentIds);
  const dirty = title !== opened.value.title || description !== opened.value.description || type !== opened.value.type
    || JSON.stringify(parents) !== JSON.stringify(opened.value.parentIds);
  const stale = liveRow?.id !== opened.id || liveRow?.deleted;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  return <aside className="lb-editor nowheel" aria-label={B('editor')} data-inline-edit={dirty ? '' : undefined}>
    <header><span>{B('editor')}</span><button type="button" title={B('close')} aria-label={B('close')} onClick={onClose}><X size={16} /></button></header>
    <form onSubmit={async event => {
      event.preventDefault();
      const patch = { title: title.trim(), description, type,
        parentIds: parents, onCanvas: type === null ? opened.value.onCanvas : true,
        position: type !== opened.value.type ? alignedPosition(type, opened.value.position || { y: 86 }) : opened.value.position };
      if (await run(() => patchLifeNode(data, opened.entityId, patch, opened.id))) onRefresh(true);
    }}>
      <label>{B('name')}<input autoFocus maxLength={2000} value={title} onChange={e => setTitle(e.target.value)} disabled={!writable || stale} /></label>
      <label>{B('type')}<select value={type ?? ''} onChange={e => setType(e.target.value || null)} disabled={!writable || stale}>
        <option value="">{B('untyped')}</option>{LIFE_TYPES.map(k => <option key={k} value={k}>{t(`lifeMap.${k}`)}</option>)}
      </select></label>
      <label>{B('description')}<textarea rows={5} maxLength={20000} value={description} onChange={e => setDescription(e.target.value)} disabled={!writable || stale} /></label>
      <label>{B('parents')}<select value="" disabled={!writable || stale} onChange={e => { if (e.target.value) setParents(current => [...current, e.target.value]); }}>
        <option value="">{B('addParent')}</option>{nodes.filter(n => n.id !== row.entityId && !parents.includes(n.id)).map(n => <option key={n.id} value={n.id}>{n.title || B('untitled')}</option>)}
      </select></label>
      <ul className="lb-parent-list">{parents.map(id => <li key={id}><span>{nodes.find(n => n.id === id)?.title || B('missingParent')}</span><button type="button" aria-label={B('unlinkParent')} disabled={!writable || stale} onClick={() => setParents(p => p.filter(x => x !== id))}><X size={12} /></button></li>)}</ul>
      {stale && <p role="alert">{B('stale')}</p>}
      <div className="lb-actions"><button type="submit" disabled={!writable || stale || !dirty}><Save size={14} />{B('save')}</button><button type="button" disabled={pending} onClick={onRefresh}>{B('reload')}</button></div>
    </form>
    <div className="lb-editor-tools"><button type="button" onClick={() => onFocus(row.entityId)}><Focus size={15} />{B('focus')}</button>
      <button type="button" disabled={!writable} onClick={() => onChild(row.entityId)}><Plus size={15} />{B('child')}</button>
      <button type="button" disabled={!writable || stale} onClick={async () => { if (window.confirm(B('deleteConfirm')) && await run(() => deleteLifeNode(data, opened))) onClose(true); }}><Trash2 size={14} />{B('delete')}</button></div>
    {(row.value.bindings.goalId || row.value.bindings.projectId || row.value.bindings.wishId) && <p className="lb-hint">{B('bindingHint')}</p>}
    {row.value.details.vision?.title && row.value.details.vision.title !== row.value.title && <p className="lb-hint">{B('metricTitle', { title: row.value.details.vision.title })}</p>}
    <small className="lb-id">{row.entityId}</small>
  </aside>;
}
