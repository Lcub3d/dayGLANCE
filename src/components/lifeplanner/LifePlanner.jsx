import React, { useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Compass, Download, MoreHorizontal, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { CATEGORY_IDS, createVision, createWish, MAX_WISHES, parseVisionText, pretty, reorder, uid, updateWish } from '../../lifeplanner/model.js';
import { createPlannerStore } from '../../lifeplanner/store.js';
import VisionEditor from './VisionEditor.jsx';
import useDialogFocus from './useDialogFocus.js';
import './lifeplanner.css';

function InlineText({ value, label, onCommit, ctx }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const begin = () => { setDraft(value); setEditing(true); };
  const save = async () => {
    if (!draft.trim() || saving.current) return;
    saving.current = true; setBusy(true);
    if (await onCommit(draft.trim(), value)) setEditing(false);
    saving.current = false; setBusy(false);
  };
  if (!editing) return <button type="button" className={`lp-inline-text ${ctx.hoverBg}`} onClick={begin} aria-label={`${t('lifeplanner.edit')} · ${label}`}>{value}</button>;
  return <div className="lp-inline-editor" data-inline-edit>
    <textarea autoFocus maxLength={2000} rows={2} className={`lp-input ${ctx.cardBg} ${ctx.borderClass} ${ctx.textPrimary}`} value={draft} aria-label={label} onChange={e => setDraft(e.target.value)} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setEditing(false); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    }} />
    <div><button type="button" disabled={busy || !draft.trim()} className="lp-icon text-blue-500" aria-label={t('lifeplanner.save')} onClick={save}><Check size={15} /></button><button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={t('lifeplanner.cancel')} onClick={() => setEditing(false)}><X size={15} /></button></div>
  </div>;
}

export default function LifePlanner() {
  const ctx = useDayPlannerCtx();
  const { setShowLifePlanner, setPlannerProjectId, multiUserEnabled } = useFeaturesCtx();
  const { t } = useTranslation();
  const L = (key, options) => t(`lifeplanner.${key}`, options);
  const [store] = useState(() => createPlannerStore({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) }, locks: navigator.locks, target: window,
    defaults: ['longTerm', 'important', 'health', 'honesty', 'margin'].map(key => t(`lifeplanner.defaults.${key}`)),
  }));
  const doc = useSyncExternalStore(store.subscribe, store.get, store.get);
  const storageError = useSyncExternalStore(store.subscribe, store.error, store.error);
  const [guided, setGuided] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [exampleCategory, setExampleCategory] = useState('self');
  const [starred, setStarred] = useState(false);
  const [newWish, setNewWish] = useState('');
  const [newPrinciple, setNewPrinciple] = useState('');
  const [editor, setEditor] = useState(null);
  const [tools, setTools] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const root = useRef(null), importInput = useRef(null), wishInput = useRef(null);
  const close = () => {
    if (tools) { setTools(false); return; }
    const hasDraft = newWish.trim() || newPrinciple.trim() || root.current?.querySelector('[data-inline-edit]');
    if (!hasDraft || window.confirm(L('discard'))) setShowLifePlanner(false);
  };
  useDialogFocus(root, close, !editor);
  const disabled = !!storageError || multiUserEnabled || pending;
  const filtered = !!query.trim() || category !== 'all' || starred;
  const visible = doc.wishes.filter(w => (!starred || w.starred) && (category === 'all' || category === w.category) && `${w.title} ${w.visions.map(v => v.title).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const input = `lp-input ${ctx.cardBg} ${ctx.borderClass} ${ctx.textPrimary}`;
  async function run(action) {
    if (busy.current || multiUserEnabled) return false;
    busy.current = true; setPending(true);
    try { await action(); setError(''); return true; }
    catch (err) { setError(L(`errors.${err.message}`, { defaultValue: L('errors.unknown') })); return false; }
    finally { busy.current = false; setPending(false); }
  }
  const changeWish = (wish, change) => run(() => store.commit(current => updateWish(current, wish.id, change, wish)));
  async function addWish(event) {
    event?.preventDefault();
    const title = newWish.trim();
    if (!title) return;
    const wish = createWish(title, category === 'all' ? 'other' : category);
    if (await run(() => store.commit(current => {
      if (current.wishes.length >= MAX_WISHES) throw new Error('limit');
      return { ...current, wishes: [...current.wishes, wish] };
    }))) { setNewWish(''); setQuery(''); setStarred(false); wishInput.current?.focus(); }
  }
  async function addExample() {
    const wish = createWish(L(`categories.${exampleCategory}.exampleWish`), exampleCategory);
    wish.visions = L(`categories.${exampleCategory}.exampleVision`).split('\n').filter(Boolean).map(text => createVision(text));
    if (await run(() => store.commit(current => {
      if (current.wishes.length >= MAX_WISHES) throw new Error('limit');
      return { ...current, wishes: [...current.wishes, wish] };
    }))) { setQuery(''); setCategory('all'); setStarred(false); }
  }
  async function remove(collection, item) {
    if (!window.confirm(L('removeConfirm'))) return;
    const index = doc[collection].findIndex(x => x.id === item.id);
    if (await run(() => store.commit(current => {
      const found = current[collection].find(x => x.id === item.id);
      if (JSON.stringify(found) !== JSON.stringify(item)) throw new Error('conflict');
      return { ...current, [collection]: current[collection].filter(x => x.id !== item.id) };
    }))) { setUndo({ collection, item, index }); setNotice(L('removed')); }
  }
  async function undoRemove() {
    if (!undo) return;
    if (await run(() => store.commit(current => {
      if (undo.collection === 'visions') {
        const wish = current.wishes.find(w => w.id === undo.wishId);
        if (!wish) throw new Error('missing');
        if (wish.visions.some(v => v.id === undo.item.id)) throw new Error('conflict');
        const visions = [...wish.visions]; visions.splice(Math.min(undo.index, visions.length), 0, undo.item);
        return updateWish(current, wish.id, { visions });
      }
      if (current[undo.collection].some(x => x.id === undo.item.id)) throw new Error('conflict');
      if (current[undo.collection].length >= 100) throw new Error('limit');
      const items = [...current[undo.collection]]; items.splice(Math.min(undo.index, items.length), 0, undo.item);
      return { ...current, [undo.collection]: items };
    }))) { setUndo(null); setNotice(''); }
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setTools(false);
  }
  async function restore(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const revision = doc.revision;
    await run(async () => {
      if (file.size > 1500000) throw new Error('size');
      const text = await file.text();
      if (!window.confirm(L('restoreConfirm'))) return;
      await store.restore(text, revision); setNotice(L('restoreSuccess')); setUndo(null); setTools(false);
    });
  }
  const orderButton = (collection, item, delta, blocked) => <button type="button" className={`lp-icon ${ctx.hoverBg}`} disabled={disabled || blocked} aria-label={L(delta < 0 ? 'up' : 'down')} onClick={() => run(() => store.commit(current => ({ ...current, [collection]: reorder(current[collection], item.id, delta) })))}>{delta < 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button>;
  return <div className="lp-backdrop">
    <div ref={root} data-lifeplanner role="dialog" aria-modal={!editor} aria-labelledby="lp-heading" tabIndex={-1} className={`lp-workspace ${ctx.cardBg} ${ctx.textPrimary} ${ctx.darkMode ? 'dark-scrollbar' : ''}`} inert={editor ? '' : undefined}>
      <div className="lp-main">
        <section className="lp-wishes">
          <header className={`lp-list-header border-b ${ctx.borderClass}`}>
            <div className="lp-title-row"><h1 id="lp-heading">{L('title')}</h1><button type="button" aria-pressed={guided} aria-label={guided ? L('guideOn') : L('guideOff')} className="lp-guide-button bg-brand text-stone-950" onClick={() => setGuided(v => !v)}>life planner <ChevronDown size={12} className={guided ? 'rotate-180' : ''} /></button><span className={`lp-count ${ctx.textSecondary}`}>{L('count', { count: doc.wishes.length })}</span></div>
            <div className="lp-toolbar"><label className={`lp-search ${ctx.textSecondary}`}><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label={L('search')} placeholder={L('search')} /></label><select className={`lp-filter ${ctx.hoverBg}`} aria-label={L('category')} value={category} onChange={e => setCategory(e.target.value)}><option value="all">{L('all')}</option>{CATEGORY_IDS.map(id => <option key={id} value={id}>{L(`categories.${id}.label`)}</option>)}</select><button type="button" className={`lp-icon ${ctx.hoverBg} ${starred ? 'text-brand' : ctx.textSecondary}`} aria-label={L('starred')} aria-pressed={starred} onClick={() => setStarred(v => !v)}><Star size={16} fill={starred ? 'currentColor' : 'none'} /></button></div>
          </header>
          {guided && <div data-life-guide className={`lp-guide border-b ${ctx.borderClass} ${ctx.darkMode ? 'bg-gray-700/30' : 'bg-stone-50'}`}>
            <p className={`lp-helper ${ctx.textSecondary}`}>{L('purposeHint')}</p>
            <div className="lp-guide-prompt"><select className={input} aria-label={L('guide')} value={exampleCategory} onChange={e => setExampleCategory(e.target.value)}>{CATEGORY_IDS.map(id => <option key={id} value={id}>{L(`categories.${id}.label`)}</option>)}</select><b>{L(`categories.${exampleCategory}.explanation`)}</b><button type="button" className={`lp-button text-blue-500 ${ctx.hoverBg}`} disabled={disabled || doc.wishes.length >= MAX_WISHES} onClick={addExample}><Plus size={14} />{L('examples')}</button></div>
            <p className={`lp-helper ${ctx.textSecondary}`}>{L(`categories.${exampleCategory}.references`)}<span className="lp-example-note">{L('exampleNote')}</span></p>
          </div>}
          <div className={`lp-table-heading border-b ${ctx.borderClass} ${ctx.textSecondary}`}><span aria-label={L('number')}>#</span><span>{L('wish')}</span><span>{L('vision')}</span><span /></div>
          <div className="lp-wish-scroll">
            {!doc.wishes.length && <div className="lp-empty"><Compass size={34} strokeWidth={1.3} className={ctx.textSecondary} /><h3>{L('empty')}</h3><p className={ctx.textSecondary}>{L('emptyHint')}</p></div>}
            {doc.wishes.length > 0 && !visible.length && <p className={`lp-empty ${ctx.textSecondary}`}>{L('noResults')}</p>}
            <div role="list" aria-label={L('title')}>
              {visible.map(wish => {
                const index = doc.wishes.findIndex(w => w.id === wish.id);
                const isExpanded = guided || expanded.has(wish.id);
                return <article role="listitem" key={wish.id} data-life-wish={wish.id} className={`lp-wish border-b ${ctx.borderClass}`}>
                  <div className="lp-wish-row">
                    <button type="button" className={`lp-number ${wish.starred ? 'text-brand is-starred' : ctx.textSecondary}`} disabled={disabled} aria-label={`${wish.starred ? L('unstar') : L('star')} · ${wish.title}`} aria-pressed={wish.starred} onClick={() => changeWish(wish, { starred: !wish.starred })}>{wish.starred ? <Star size={17} fill="currentColor" /> : <><span>{String(index + 1).padStart(2, '0')}</span><Star size={17} className="lp-star-hover" /></>}</button>
                    <div className="lp-wish-title"><div className="lp-check-title"><input type="checkbox" checked={wish.completed} disabled={disabled} aria-label={`${L('wishDone')} · ${wish.title}`} onChange={e => changeWish(wish, { completed: e.target.checked })} /><div className={wish.completed ? `lp-completed ${ctx.textSecondary}` : ''}><InlineText ctx={ctx} value={wish.title} label={L('wish')} onCommit={(title, before) => run(() => store.commit(current => {
                      const live = current.wishes.find(w => w.id === wish.id);
                      if (live?.title !== before) throw new Error('conflict');
                      return updateWish(current, wish.id, { title });
                    }))} /></div></div><span className={`lp-category-name ${ctx.textSecondary}`}>{L(`categories.${wish.category}.label`)}</span></div>
                    <div className="lp-visions">{wish.visions.map(vision => <div key={vision.id} className="lp-vision-line"><input type="checkbox" checked={vision.completed} disabled={disabled} aria-label={`${L('visionDone')} · ${vision.title}`} onChange={e => changeWish(wish, { visions: wish.visions.map(v => v.id === vision.id ? { ...v, completed: e.target.checked } : v) })} /><button type="button" className={`lp-vision-title ${ctx.hoverBg} ${vision.completed ? `lp-completed ${ctx.textSecondary}` : ''}`} disabled={disabled} onClick={() => setEditor({ wish, original: vision })}>{vision.title}<span className={ctx.textSecondary}>{vision.amount}{L(vision.unit)}</span></button><button type="button" className={`lp-icon lp-row-action ${ctx.hoverBg}`} aria-label={`${L('delete')} · ${vision.title}`} disabled={disabled} onClick={async () => {
                      if (window.confirm(L('removeConfirm')) && await changeWish(wish, { visions: wish.visions.filter(v => v.id !== vision.id) })) {
                        setUndo({ collection: 'visions', wishId: wish.id, item: vision, index: wish.visions.findIndex(v => v.id === vision.id) }); setNotice(L('removed'));
                      }
                    }}><X size={12} /></button></div>)}<button type="button" className={`lp-add-vision ${ctx.hoverBg} text-blue-500`} disabled={disabled || wish.visions.length >= 30} onClick={() => setEditor({ wish, original: null })}><Plus size={13} />{wish.visions.length ? L('addAnother') : L('addVision')}</button></div>
                    <div className="lp-row-buttons"><button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={isExpanded ? L('collapse') : L('expand')} aria-expanded={isExpanded} onClick={() => {
                      if (guided) { setGuided(false); setExpanded(new Set()); }
                      else setExpanded(prev => { const next = new Set(prev); if (next.has(wish.id)) next.delete(wish.id); else next.add(wish.id); return next; });
                    }}>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button><div className="lp-row-action">{orderButton('wishes', wish, -1, filtered || index === 0)}{orderButton('wishes', wish, 1, filtered || index === doc.wishes.length - 1)}<button type="button" className={`lp-icon ${ctx.hoverBg}`} disabled={disabled} aria-label={`${L('delete')} · ${wish.title}`} onClick={() => remove('wishes', wish)}><Trash2 size={13} /></button></div></div>
                  </div>
                  {isExpanded && <div className={`lp-row-guidance ${ctx.darkMode ? 'bg-gray-700/20' : 'bg-stone-50/70'}`}><select className={input} disabled={disabled} aria-label={`${L('category')} · ${wish.title}`} value={wish.category} onChange={e => changeWish(wish, { category: e.target.value })}>{CATEGORY_IDS.map(id => <option key={id} value={id}>{L(`categories.${id}.label`)}</option>)}</select><div><p>{L(`categories.${wish.category}.explanation`)}</p><p className={ctx.textSecondary}>{L('references')}：{L(`categories.${wish.category}.references`)}</p>{wish.visions.map(v => <p key={v.id} className={ctx.textSecondary}>{L('currentTarget', { current: pretty(v.current), target: pretty(parseVisionText(v.title).target) })} · {v.amount}{L(v.unit)}</p>)}</div></div>}
                </article>;
              })}
            </div>
          </div>
          <form className={`lp-quick-add border-t ${ctx.borderClass}`} onSubmit={addWish}><Plus size={18} className={ctx.textSecondary} /><input ref={wishInput} data-initial-focus value={newWish} onChange={e => setNewWish(e.target.value)} maxLength={2000} aria-label={L('wishPlaceholder')} placeholder={doc.wishes.length >= MAX_WISHES ? L('limit') : L('wishPlaceholder')} disabled={disabled || doc.wishes.length >= MAX_WISHES} /><button type="submit" className="lp-button bg-blue-600 hover:bg-blue-700 text-white" disabled={disabled || !newWish.trim() || doc.wishes.length >= MAX_WISHES}>{L('addWish')}</button></form>
        </section>
        <aside className={`lp-principles border-l ${ctx.borderClass}`}>
          <header className={`lp-principles-header border-b ${ctx.borderClass}`}><h2>{L('principles')}</h2><button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={L('close')} onClick={close}><X size={18} /></button></header>
          <div className="lp-principle-scroll"><ol>{doc.principles.map((principle, index) => <li key={principle.id} data-life-principle={principle.id} className={`lp-principle border-b ${ctx.borderClass}`}><span className={`lp-principle-index ${ctx.textSecondary}`}>{String(index + 1).padStart(2, '0')}</span><InlineText ctx={ctx} value={principle.text} label={L('principles')} onCommit={(text, before) => run(() => store.commit(current => {
            if (current.principles.find(p => p.id === principle.id)?.text !== before) throw new Error('conflict');
            return { ...current, principles: current.principles.map(p => p.id === principle.id ? { ...p, text } : p) };
          }))} /><div className="lp-principle-actions lp-row-action">{orderButton('principles', principle, -1, index === 0)}{orderButton('principles', principle, 1, index === doc.principles.length - 1)}<button type="button" className={`lp-icon ${ctx.hoverBg}`} disabled={disabled} aria-label={`${L('delete')} · ${principle.text}`} onClick={() => remove('principles', principle)}><Trash2 size={13} /></button></div></li>)}</ol>
          <form className="lp-principle-add" onSubmit={async e => { e.preventDefault(); const text = newPrinciple.trim(); if (!text) return; if (await run(() => store.commit(current => { if (current.principles.length >= 100) throw new Error('limit'); return { ...current, principles: [...current.principles, { id: uid(), text }] }; }))) setNewPrinciple(''); }}><input className={`${input}`} aria-label={L('principlePlaceholder')} placeholder={L('principlePlaceholder')} value={newPrinciple} onChange={e => setNewPrinciple(e.target.value)} maxLength={2000} disabled={disabled || doc.principles.length >= 100} /><button type="submit" className={`lp-icon text-blue-500 ${ctx.hoverBg}`} aria-label={L('addPrinciple')} disabled={disabled || !newPrinciple.trim() || doc.principles.length >= 100}><Plus size={17} /></button></form></div>
          <footer className={`lp-local ${ctx.textSecondary}`}><div><span className="lp-save-dot" />{doc.updatedAt ? L('saved') : L('local')}<button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={L('tools')} aria-expanded={tools} onClick={() => setTools(v => !v)}><MoreHorizontal size={18} /></button></div><p>{L('backupHint')}</p>{tools && <div className={`lp-tools ${ctx.cardBg} border ${ctx.borderClass}`}><button type="button" disabled={disabled} onClick={() => run(() => download(store.backup(), 'dayglance-lifeplanner.json'))}><Download size={14} />{L('backup')}</button><button type="button" disabled={disabled} onClick={() => importInput.current?.click()}><Upload size={14} />{L('restore')}</button>{storageError && <button type="button" onClick={() => run(() => download(store.rawBackup(), 'lifeplanner-recovery.json'))}><Download size={14} />{L('rawBackup')}</button>}</div>}</footer>
        </aside>
      </div>
      {(error || storageError || multiUserEnabled) && <div role="alert" className="lp-workspace-alert lp-error">{error || (multiUserEnabled ? L('multiUser') : L(`errors.${storageError}`))}</div>}
      {notice && <div role="status" className={`lp-notice border-t ${ctx.borderClass}`}><span>{notice}</span>{undo && <button type="button" className="text-blue-500" disabled={disabled} onClick={undoRemove}>{L('undo')}</button>}<button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={L('close')} onClick={() => { setNotice(''); setUndo(null); }}><X size={13} /></button></div>}
      <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={restore} />
    </div>
    {editor && <VisionEditor key={editor.original?.id || editor.wish.id} {...editor} store={store} onClose={() => setEditor(null)} onOpenProject={id => { setEditor(null); setShowLifePlanner(false); setPlannerProjectId(id); }} />}
  </div>;
}
