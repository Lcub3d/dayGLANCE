import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Download, GripVertical, MoreHorizontal, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { CATEGORY_IDS, MAX_WISHES, uid, updateWish } from '../../lifeplanner/model.js';
import { commitNotebookText, moveNotebookItem, notebookCategories } from '../../lifeplanner/notebook.js';
import { createPlannerStore } from '../../lifeplanner/store.js';
import VisionEditor from './VisionEditor.jsx';
import useDialogFocus from './useDialogFocus.js';
import useNotebookDrag from './useNotebookDrag.js';
import './lifeplanner.css';

// A real textarea (IME, selection, screen readers and long text stay native),
// but its appearance is ink on a ruled line rather than a boxed form field.
function RuledField({ value, onChange, onCommit, onCancel, label, placeholder, disabled, saving, dirty }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    element.style.height = '1px';
    element.style.height = `${Math.max(40, element.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className="lp-ruled-input" data-inline-edit={dirty ? '' : undefined}
    aria-label={label} placeholder={placeholder} value={value} disabled={disabled} readOnly={saving}
    aria-busy={saving || undefined} maxLength={2000} onChange={event => onChange(event.target.value)}
    onBlur={() => onCommit()} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onCommit(); }
    }} />;
}

export default function LifePlanner() {
  const ctx = useDayPlannerCtx();
  const { setShowLifePlanner, setPlannerProjectId, multiUserEnabled } = useFeaturesCtx();
  const { t } = useTranslation();
  const L = (key, options) => t(`lifeplanner.${key}`, options);
  const [store] = useState(() => createPlannerStore({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
    locks: navigator.locks, target: window,
    defaults: ['longTerm', 'important', 'health', 'honesty', 'margin'].map(key => t(`lifeplanner.defaults.${key}`)),
  }));
  const doc = useSyncExternalStore(store.subscribe, store.get, store.get);
  const storageError = useSyncExternalStore(store.subscribe, store.error, store.error);
  const [guided, setGuided] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [starred, setStarred] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const [tools, setTools] = useState(false);
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState(null);
  const [pending, setPending] = useState(0);
  const [drafts, setDrafts] = useState({});
  const draftsRef = useRef({}), saves = useRef(new Map());
  const root = useRef(null), importInput = useRef(null);
  const readOnly = !!storageError || multiUserEnabled;
  const disabled = readOnly || pending > 0;
  const filtered = !!query.trim() || category !== 'all' || starred;
  const visible = doc.wishes.filter(w => (!starred || w.starred) && (category === 'all' || category === w.category) && `${w.title} ${w.visions.map(v => v.title).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const setDraftMap = transform => { draftsRef.current = transform(draftsRef.current); setDrafts(draftsRef.current); };
  const forget = key => setDraftMap(current => { const next = { ...current }; delete next[key]; return next; });
  const hasDrafts = () => Object.values(draftsRef.current).some(d => d.text !== d.before);
  async function write(action) {
    if (readOnly) return false;
    setPending(count => count + 1);
    try { await action(); setError(''); return true; }
    catch (err) { setError(L(`errors.${err.message}`, { defaultValue: L('errors.unknown') })); return false; }
    finally { setPending(count => count - 1); }
  }
  function changeWish(wish, change) {
    return write(() => store.commit(current => updateWish(current, wish.id, change, wish)));
  }
  function draftFor(key, kind, item, text, categoryId) {
    return { key, kind, id: item?.id || uid(), isNew: !item, before: item ? (kind === 'wish' ? item.title : item.text) : '', text, category: categoryId || item?.category || 'other' };
  }
  function edit(key, kind, item, text, categoryId) {
    setDraftMap(current => ({ ...current, [key]: { ...(current[key] || draftFor(key, kind, item, text, categoryId)), text } }));
  }
  async function saveField(key) {
    if (saves.current.has(key)) return saves.current.get(key);
    const draft = draftsRef.current[key];
    if (!draft) return null;
    if (draft.text === draft.before || (draft.isNew && !draft.text.trim())) { forget(key); return draft.isNew ? null : draft.id; }
    const task = (async () => {
      const ok = await write(() => store.commit(current => commitNotebookText(current, draft)));
      if (ok) {
        setDraftMap(current => {
          const next = { ...current };
          if (next[key]?.text === draft.text) delete next[key];
          else if (next[key]) next[key] = { ...next[key], before: draft.text.trim(), isNew: false };
          return next;
        });
      }
      return ok ? draft.id : null;
    })();
    saves.current.set(key, task);
    try { return await task; } finally { saves.current.delete(key); }
  }
  function field(key, kind, item, label, placeholder = '', categoryId) {
    const value = kind === 'wish' ? item?.title : item?.text;
    return <RuledField value={drafts[key]?.text ?? value ?? ''} label={label} placeholder={placeholder}
      dirty={!!drafts[key] && drafts[key].text !== drafts[key].before} disabled={readOnly || (!item && doc[kind === 'wish' ? 'wishes' : 'principles'].length >= MAX_WISHES)}
      saving={saves.current.has(key)} onChange={text => edit(key, kind, item, text, categoryId)} onCommit={() => saveField(key)} onCancel={() => forget(key)} />;
  }
  async function flushDrafts() {
    for (const key of Object.keys(draftsRef.current)) {
      const draft = draftsRef.current[key];
      if (draft?.text !== draft?.before && (draft?.text.trim() || !draft?.isNew) && !await saveField(key)) return false;
    }
    return true;
  }
  const close = async () => {
    if (menu) { setMenu(null); return; }
    if (tools) { setTools(false); return; }
    if (await flushDrafts()) setShowLifePlanner(false);
    else if (window.confirm(L('discard'))) setShowLifePlanner(false);
  };
  const drag = useNotebookDrag(root, {
    t,
    onMenu: (group, id) => setMenu(current => current?.id === id ? null : { group, id }),
    onMove: (group, id, targetId, after, expectedIds) => write(() => store.commit(current => {
      const collection = group === 'principles' ? 'principles' : 'wishes';
      return { ...current, [collection]: moveNotebookItem(current[collection], id, targetId, after, expectedIds) };
    })),
  });
  useDialogFocus(root, close, !editor);
  async function toggleGuide() {
    drag.cancel();
    if (!await flushDrafts()) return;
    setMenu(null); setTools(false); setGuided(value => !value);
  }
  async function openVision(wish, original = null) {
    if (!await flushDrafts()) return;
    const live = store.get().wishes.find(item => item.id === wish.id);
    if (live) setEditor({ wish: live, original });
  }
  async function blankVision(key) {
    const id = await saveField(key);
    const wish = store.get().wishes.find(item => item.id === id);
    if (wish) setEditor({ wish, original: null });
  }
  async function remove(collection, item, wish = null) {
    if (!window.confirm(L('removeConfirm'))) return;
    const list = wish ? wish.visions : doc[collection];
    const index = list.findIndex(entry => entry.id === item.id);
    const ok = await write(() => store.commit(current => {
      if (wish) {
        const live = current.wishes.find(entry => entry.id === wish.id);
        if (!live || JSON.stringify(live.visions.find(entry => entry.id === item.id)) !== JSON.stringify(item)) throw new Error('conflict');
        return updateWish(current, wish.id, { visions: live.visions.filter(entry => entry.id !== item.id) });
      }
      if (JSON.stringify(current[collection].find(entry => entry.id === item.id)) !== JSON.stringify(item)) throw new Error('conflict');
      return { ...current, [collection]: current[collection].filter(entry => entry.id !== item.id) };
    }));
    if (ok) { setUndo({ collection, item, index, wishId: wish?.id }); setNotice(L('removed')); setMenu(null); forget(`${collection === 'wishes' ? 'wish' : 'principle'}:${item.id}`); }
  }
  async function undoRemove() {
    if (!undo) return;
    if (await write(() => store.commit(current => {
      const wish = undo.wishId && current.wishes.find(item => item.id === undo.wishId);
      if (undo.wishId && !wish) throw new Error('missing');
      const items = [...(wish ? wish.visions : current[undo.collection])];
      if (items.some(item => item.id === undo.item.id)) throw new Error('conflict');
      if (items.length >= (wish ? 30 : MAX_WISHES)) throw new Error('limit');
      items.splice(Math.min(undo.index, items.length), 0, undo.item);
      return wish ? updateWish(current, wish.id, { visions: items }) : { ...current, [undo.collection]: items };
    }))) { setUndo(null); setNotice(''); }
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setTools(false);
  }
  async function exportDocument() {
    if (await flushDrafts()) await write(() => download(store.backup(), 'dayglance-lifeplanner.json'));
  }
  async function restore(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const revision = doc.revision;
    await write(async () => {
      if (file.size > 1500000) throw new Error('size');
      const text = await file.text();
      if (!window.confirm(L('restoreConfirm'))) return;
      await store.restore(text, revision); setDraftMap(() => ({})); setNotice(L('restoreSuccess')); setUndo(null); setTools(false);
    });
  }
  function blockMenu(group, item) {
    if (menu?.id !== item.id || menu.group !== group) return null;
    return <div className="lp-block-menu" role="group" aria-label={L('blockActions')}>
      {group !== 'principles' && <label>{L('category')}<select value={item.category} disabled={disabled} onChange={event => changeWish(item, { category: event.target.value })}>
        {CATEGORY_IDS.map(id => <option key={id} value={id}>{L(`categories.${id}.label`)}</option>)}
      </select></label>}
      <button type="button" disabled={disabled} onClick={() => remove(group === 'principles' ? 'principles' : 'wishes', item)}><Trash2 size={14} />{L('delete')}</button>
    </div>;
  }
  function visions(wish) {
    return <div className="lp-visions">{wish.visions.map(vision => <div key={vision.id} className="lp-vision-line">
      <input type="checkbox" checked={vision.completed} disabled={disabled} aria-label={`${L('visionDone')} · ${vision.title}`} onChange={event => changeWish(wish, { visions: wish.visions.map(v => v.id === vision.id ? { ...v, completed: event.target.checked } : v) })} />
      <button type="button" className={`lp-vision-title ${vision.completed ? 'lp-completed' : ''}`} disabled={disabled} onClick={() => openVision(wish, vision)}>{vision.title}</button>
      <button type="button" className="lp-icon lp-row-action" aria-label={`${L('delete')} · ${vision.title}`} disabled={disabled} onClick={() => remove('visions', vision, wish)}><X size={12} /></button>
    </div>)}<button type="button" className={`lp-add-vision ${wish.visions.length ? 'lp-row-action' : ''}`} disabled={disabled || wish.visions.length >= 30} onClick={() => openVision(wish)}>
      {wish.visions.length ? <Plus size={13} /> : null}{wish.visions.length ? L('addAnother') : L('visionInvitation')}
    </button></div>;
  }
  function wishRow(wish, group = 'wishes') {
    const index = doc.wishes.findIndex(item => item.id === wish.id);
    return <article role="listitem" key={wish.id} data-life-wish={wish.id} data-lp-sort={wish.id} data-lp-group={group} className="lp-wish lp-notebook-row">
      <div className="lp-row-gutter"><button {...drag.handleProps(group, wish.id, wish.title, disabled || (!guided && filtered))}><GripVertical size={14} /></button>{blockMenu(group, wish)}</div>
      <button type="button" className={`lp-number ${wish.starred ? 'is-starred' : ''}`} disabled={disabled} aria-label={`${L(wish.starred ? 'unstar' : 'star')} · ${wish.title}`} aria-pressed={wish.starred} onClick={() => changeWish(wish, { starred: !wish.starred })}>
        {wish.starred ? <Star size={14} fill="currentColor" /> : <><span>{String(index + 1).padStart(2, '0')}</span><Star size={14} className="lp-star-hover" /></>}
      </button>
      <div className={`lp-wish-writing ${wish.completed ? 'lp-completed' : ''}`}><input type="checkbox" checked={wish.completed} disabled={disabled} aria-label={`${L('wishDone')} · ${wish.title}`} onChange={event => changeWish(wish, { completed: event.target.checked })} />
        {field(`wish:${wish.id}`, 'wish', wish, `${L('wish')} · ${index + 1}`)}
      </div>
      {visions(wish)}
    </article>;
  }
  function blankRow(key, index, categoryId = 'other', assistant = false) {
    const atLimit = doc.wishes.length >= MAX_WISHES;
    return <div key={key} data-life-blank={key} className={`lp-notebook-row lp-blank-row ${assistant ? 'lp-assistant-blank' : ''}`}>
      <span /><span className="lp-number lp-empty-number">{assistant ? '' : String(doc.wishes.length + index + 1).padStart(2, '0')}</span>
      <div className="lp-wish-writing"><span className="lp-empty-check" aria-hidden="true" />
        {field(key, 'wish', null, assistant ? `${L('wish')} · ${L(`categories.${categoryId}.label`)}` : `${L('blankWish')} ${index + 1}`, atLimit ? L('limit') : assistant ? L(`categories.${categoryId}.exampleWish`) : index === 0 ? L('wishPlaceholder') : '', categoryId)}
      </div>
      <button type="button" className="lp-blank-vision" onPointerDown={event => event.preventDefault()} disabled={readOnly || atLimit || !drafts[key]?.text.trim()} onClick={() => blankVision(key)}>{assistant ? L(`categories.${categoryId}.exampleVision`).split('\n')[0] : index === 0 ? L('visionInvitation') : ''}</button>
    </div>;
  }
  return <div className="lp-backdrop">
    <div ref={root} data-lifeplanner data-notebook-mode={guided ? 'assistant' : 'notebook'} role="dialog" aria-modal={!editor} aria-labelledby="lp-heading" tabIndex={-1}
      className={`lp-workspace ${ctx.textPrimary} ${ctx.darkMode ? 'lp-paper-dark dark-scrollbar' : ''}`} inert={editor ? '' : undefined}>
      <header className="lp-notebook-header"><div className="lp-title-row"><h1 id="lp-heading" data-initial-focus tabIndex={-1}>{L('title')}</h1>
        <button type="button" aria-pressed={guided} aria-controls="lp-paper" aria-label={guided ? L('guideOn') : L('guideOff')} className="lp-guide-button bg-brand text-stone-950" onClick={toggleGuide} disabled={readOnly}>{L('assistant')}<ChevronDown size={12} className={guided ? 'rotate-180' : ''} /></button></div>
        <div className="lp-header-actions">{!guided && <button type="button" className="lp-icon" aria-label={L('search')} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Search size={16} /></button>}
          <button type="button" className="lp-icon" aria-label={L('tools')} aria-expanded={tools} onClick={() => setTools(value => !value)}><MoreHorizontal size={18} /></button>
          <button type="button" className="lp-icon" aria-label={L('close')} onClick={close}><X size={18} /></button></div>
        {tools && <div className="lp-tools"><button type="button" disabled={disabled} onClick={exportDocument}><Download size={14} />{L('backup')}</button><button type="button" disabled={disabled} onClick={() => importInput.current?.click()}><Upload size={14} />{L('restore')}</button>{storageError && <button type="button" onClick={() => { try { download(store.rawBackup(), 'lifeplanner-recovery.json'); } catch { setError(L('errors.storageRead')); } }}><Download size={14} />{L('rawBackup')}</button>}<p>{L('backupHint')}</p></div>}
      </header>
      {searchOpen && !guided && <div className="lp-filter-strip"><input aria-label={L('search')} placeholder={L('search')} value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label={L('category')} value={category} onChange={event => setCategory(event.target.value)}><option value="all">{L('all')}</option>{CATEGORY_IDS.map(id => <option key={id} value={id}>{L(`categories.${id}.label`)}</option>)}</select>
        <button type="button" className="lp-icon" aria-label={L('starred')} aria-pressed={starred} onClick={() => setStarred(value => !value)}><Star size={15} fill={starred ? 'currentColor' : 'none'} /></button>
      </div>}
      <div id="lp-paper" className="lp-paper-scroll" data-lp-scroll>
        {guided ? <section data-life-guide className="lp-assistant-sheet" aria-label={L('guide')}>
          <div className="lp-assistant-labels" aria-hidden="true"><span>{L('categoryColumn')}</span><span>{L('explanation')}</span><span>{L('references')}</span><span>{L('wish')}</span><span>{L('vision')}</span></div>
          {notebookCategories(doc.wishes).map(({ id, wishes }) => <section key={id} data-life-category={id} className="lp-assistant-category" aria-label={L(`categories.${id}.label`)}>
            <h2>{L(`categories.${id}.label`)}</h2><p className="lp-assistant-explanation">{L(`categories.${id}.explanation`)}</p><p className="lp-assistant-references">{L(`categories.${id}.references`)}</p>
            <div className="lp-category-writing" role="list" aria-label={L(`categories.${id}.label`)}>{wishes.map(wish => wishRow(wish, `wishes:${id}`))}{blankRow(`new:${id}`, 0, id, true)}</div>
          </section>)}
          <p className="lp-template-note">{L('templateHint')}</p>
        </section> : <div className="lp-notebook-spread">
          <section className="lp-wishes" aria-label={L('wish')}><div className="lp-table-heading"><span /><span>#</span><span>{L('wish')}</span><span>{L('vision')}</span></div>
            <div role="list" aria-label={L('title')}>{visible.map(wish => wishRow(wish))}</div>
            {filtered && !visible.length && <p className="lp-no-results">{L('noResults')}</p>}
            {Array.from({ length: Math.min(8, MAX_WISHES - doc.wishes.length) }, (_, index) => blankRow(`blank:${index}`, index, category === 'all' ? 'other' : category))}
          </section>
          <aside className="lp-mottos" aria-label={L('principles')}><h2>{L('principles')}</h2><ol>{doc.principles.map((principle, index) => <li key={principle.id} data-life-principle={principle.id} data-lp-sort={principle.id} data-lp-group="principles" className="lp-motto-row">
            <div className="lp-row-gutter"><button {...drag.handleProps('principles', principle.id, principle.text, disabled)}><GripVertical size={14} /></button>{blockMenu('principles', principle)}</div>
            {field(`principle:${principle.id}`, 'principle', principle, `${L('principles')} · ${index + 1}`)}
          </li>)}</ol>
          {Array.from({ length: Math.min(5, MAX_WISHES - doc.principles.length) }, (_, index) => <div className="lp-motto-row" key={`motto:${index}`}><span />{field(`motto:${index}`, 'principle', null, `${L('blankMotto')} ${index + 1}`, index === 0 ? L('principlePlaceholder') : '')}</div>)}
          </aside>
        </div>}
      </div>
      <footer className="lp-paper-footer"><span>{pending ? L('saving') : hasDrafts() ? L('unsaved') : L('saved')}</span>{guided && <span className="lp-scroll-hint">{L('tableScroll')}</span>}</footer>
      {(error || storageError || multiUserEnabled) && <div role="alert" className="lp-workspace-alert lp-error">{error || (multiUserEnabled ? L('multiUser') : L(`errors.${storageError}`))}{hasDrafts() && <button type="button" onClick={flushDrafts} disabled={pending > 0}>{L('retry')}</button>}</div>}
      {notice && <div role="status" className="lp-notice"><span>{notice}</span>{undo && <button type="button" disabled={disabled} onClick={undoRemove}>{L('undo')}</button>}<button type="button" className="lp-icon" aria-label={L('close')} onClick={() => { setNotice(''); setUndo(null); }}><X size={13} /></button></div>}
      <span className="sr-only" id={drag.descriptionId}>{L('moveInstructions')}</span><span className="sr-only" role="status">{drag.message}</span>
      <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={restore} />
    </div>
    {editor && <VisionEditor key={editor.original?.id || editor.wish.id} {...editor} store={store} onClose={() => setEditor(null)} onOpenProject={id => { setEditor(null); setShowLifePlanner(false); setPlannerProjectId(id); }} />}
  </div>;
}
