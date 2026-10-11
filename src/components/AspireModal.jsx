import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Compass, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { visibleAspireEntries } from '../aspire/notebook.js';
import { moveNotebookItem } from '../aspire/notebookOrder.js';

function NotebookField({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const field = ref.current;
    const fit = () => {
      field.style.height = 'auto';
      field.style.height = `${Math.max(44, field.scrollHeight)}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== field.clientWidth) { width = field.clientWidth; fit(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return <textarea ref={ref} value={value} rows={1} maxLength={4000} {...props} />;
}

// Wishes and mottos deliberately have no required fields or planning hierarchy.
// Draft text stays in the dialog until a checked write succeeds. Escape in a
// dirty field cancels that edit; dismissing the notebook first saves all drafts.
export default function AspireModal({ onClose }) {
  const { cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const {
    aspireEntries, aspireLoaded, aspireWritable, aspireError,
    commitAspire, reloadAspire,
  } = useFeaturesCtx();
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState({});
  const draftsRef = useRef({});
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const saves = useRef(new Map());
  const [error, setError] = useState('');
  const [undo, setUndo] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const root = useRef(null);
  const closeRef = useRef(null);
  const readonly = !aspireLoaded || !aspireWritable;
  const disabled = readonly || pending > 0;
  const changeDrafts = (fn) => {
    draftsRef.current = fn(draftsRef.current);
    setDrafts(draftsRef.current);
  };
  const forget = (id) => changeDrafts(current => {
    const next = { ...current };
    delete next[id];
    return next;
  });
  const messageFor = (reason) => t(`aspire.${reason === 'conflict' || reason === 'missing' ? 'conflict' : 'saveFailed'}`);
  async function write(operation) {
    pendingRef.current += 1;
    setPending(pendingRef.current);
    try {
      const result = await commitAspire(operation);
      if (!result.ok) { setError(messageFor(result.error)); return result; }
      setError('');
      return result;
    } catch {
      setError(t('aspire.saveFailed'));
      return { ok: false };
    } finally {
      pendingRef.current -= 1;
      setPending(pendingRef.current);
    }
  }
  async function save(id) {
    if (saves.current.has(id)) return saves.current.get(id);
    const draft = draftsRef.current[id];
    if (!draft) return true;
    if (draft.text === draft.before) { forget(id); return true; }
    const promise = (async () => {
      const result = await write({ type: 'edit', id, text: draft.text, expectedContentUpdatedAt: draft.expectedContentUpdatedAt });
      if (result.ok) forget(id);
      return result.ok;
    })();
    saves.current.set(id, promise);
    try { return await promise; } finally { saves.current.delete(id); }
  }
  async function flush() {
    for (const promise of saves.current.values()) if (!await promise) return false;
    for (const id of Object.keys(draftsRef.current)) if (!await save(id)) return false;
    return true;
  }
  async function close() {
    if (pendingRef.current && !saves.current.size) return;
    if (await flush()) onClose();
  }
  closeRef.current = close;

  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector('[data-aspire-close]')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        const id = document.activeElement?.dataset.aspireField;
        if (id && draftsRef.current[id] && !saves.current.has(id)) {
          forget(id);
          setError('');
        } else closeRef.current();
      } else if (event.key === 'Tab') {
        const fields = [...(root.current?.querySelectorAll('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])];
        const first = fields[0], last = fields.at(-1);
        if (!first) return;
        if (event.shiftKey && (document.activeElement === first || !root.current.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !root.current.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
    // A ref owns the current save-aware close callback without re-focusing on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!focusId || pending) return;
    const field = [...(root.current?.querySelectorAll('[data-aspire-field]') || [])].find(el => el.dataset.aspireField === focusId);
    if (field) { field.focus(); setFocusId(null); }
  }, [focusId, pending, aspireEntries]);

  async function add(kind) {
    if (pendingRef.current || !await flush()) return;
    const result = await write({ type: 'add', kind, text: '' });
    if (result.ok) setFocusId(result.entry.id);
  }
  async function reorder(kind, entries, index, offset) {
    if (pendingRef.current || !await flush()) return;
    const expectedIds = entries.map(entry => entry.id);
    const ordered = moveNotebookItem(entries, entries[index].id, entries[index + offset].id, offset > 0, expectedIds);
    await write({ type: 'reorder', kind, ids: ordered.map(entry => entry.id), expectedIds });
  }
  async function remove(entry) {
    if (pendingRef.current || !await save(entry.id)) return;
    // A saved draft has a fresh stamp. Ask the store for deletion without
    // silently deleting a concurrently changed row: only unchanged rows reach
    // this button, because a dirty field's controls offer Save/Cancel first.
    const result = await write({ type: 'delete', id: entry.id, expectedContentUpdatedAt: entry.contentUpdatedAt });
    if (result.ok) setUndo(result.entry);
  }
  async function restore() {
    if (!undo || pendingRef.current) return;
    const result = await write({ type: 'restore', id: undo.id, expectedContentUpdatedAt: undo.contentUpdatedAt });
    if (result.ok) { setUndo(null); setFocusId(result.entry.id); }
  }
  const hasDrafts = Object.values(drafts).some(draft => draft.text !== draft.before);
  const status = pending ? t('aspire.saving') : hasDrafts ? t('aspire.unsaved') : t('aspire.saved');
  const buttonClass = `shrink-0 min-w-[44px] min-h-[44px] p-2 rounded-lg ${hoverBg} ${textSecondary} disabled:opacity-30`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={e => { if (e.target === e.currentTarget) close(); }} data-aspire-modal>
      <div ref={root} role="dialog" aria-modal="true" aria-labelledby="aspire-title" aria-describedby="aspire-intro"
        className={`${cardBg} ${textPrimary} rounded-2xl shadow-2xl border ${borderClass} w-full max-w-2xl max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden`}>
        <header className={`flex items-center gap-3 p-4 border-b ${borderClass}`}>
          <Compass size={24} className="text-amber-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="aspire-title" className="text-lg font-semibold">{t('aspire.title')}</h2>
            <p id="aspire-intro" className={`text-xs ${textSecondary}`}>{t('aspire.intro')}</p>
          </div>
          <button type="button" data-aspire-close onClick={close} className={buttonClass} aria-label={t('common.close')}><X size={20} /></button>
        </header>
        <div className="overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6 min-h-0" data-aspire-sections>
          {!aspireLoaded && <p role="status" className={`text-sm ${textSecondary}`}>{t(aspireError ? 'aspire.loadFailed' : 'aspire.loading')}</p>}
          {aspireLoaded && !aspireWritable && <p role="status" className={`text-sm ${textSecondary}`}>{t('aspire.readOnly')}</p>}
          {(error || aspireError) && <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            <p>{error || t(aspireLoaded ? 'aspire.saveFailed' : 'aspire.loadFailed')}</p>
            <button type="button" disabled={pending > 0} onClick={async () => { await reloadAspire(); setError(''); }} className="mt-1 underline min-h-[44px]">{t('aspire.retry')}</button>
          </div>}
          {(aspireLoaded || Object.keys(drafts).length > 0) && ['wish', 'motto'].map(kind => {
            const liveEntries = visibleAspireEntries(aspireEntries, kind);
            // Keep a remote-deleted row's unsaved text visible and cancellable.
            // Otherwise close would keep retrying an invisible stale draft.
            const entries = [...liveEntries, ...Object.entries(drafts)
              .filter(([id, draft]) => draft.entry.kind === kind && !liveEntries.some(entry => entry.id === id))
              .map(([, draft]) => ({ ...draft.entry, removedRemotely: true }))];
            return <section key={kind} aria-labelledby={`aspire-${kind}`} data-aspire-section={kind}>
              <h3 id={`aspire-${kind}`} className="font-semibold mb-1">{t(`aspire.${kind === 'wish' ? 'wishes' : 'mottos'}`)}</h3>
              {!entries.length && <p className={`text-sm py-3 ${textSecondary}`}>{t('aspire.blankHint')}</p>}
              <ol className="space-y-2">
                {entries.map((entry, index) => {
                  const draft = drafts[entry.id];
                  const dirty = draft && draft.text !== draft.before;
                  return <li key={entry.id} data-aspire-entry={entry.id} className={`border-b ${borderClass} pb-1 min-w-0`}>
                    {entry.removedRemotely && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t('aspire.conflict')}</p>}
                    <NotebookField data-aspire-field={entry.id} value={draft?.text ?? entry.text} readOnly={readonly || pending > 0 || entry.removedRemotely}
                      aria-label={t(`aspire.${kind}Label`, { number: index + 1 })} placeholder={t('aspire.writeHere')}
                      className="block w-full min-h-[44px] resize-none bg-transparent py-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded text-base leading-7"
                      onChange={event => {
                        const text = event.target.value;
                        changeDrafts(current => ({ ...current, [entry.id]: { ...(current[entry.id] || { before: entry.text, expectedContentUpdatedAt: entry.contentUpdatedAt, entry }), text } }));
                      }}
                      onBlur={() => { if (!entry.removedRemotely) save(entry.id); }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                          event.preventDefault(); if (!entry.removedRemotely) save(entry.id);
                        }
                      }} />
                    <div className="flex justify-end items-center gap-1">
                      {dirty || entry.removedRemotely ? <>
                        <button type="button" disabled={disabled || entry.removedRemotely} onMouseDown={e => e.preventDefault()} onClick={() => save(entry.id)} className={`${buttonClass} text-sm`}>{t('common.save')}</button>
                        <button type="button" disabled={pending > 0} onMouseDown={e => e.preventDefault()} onClick={() => { forget(entry.id); setError(''); }} className={`${buttonClass} text-sm`}>{t('common.cancel')}</button>
                      </> : <>
                        <button type="button" disabled={disabled || index === 0} onClick={() => reorder(kind, entries, index, -1)} className={buttonClass} aria-label={t('aspire.moveUp', { number: index + 1 })}><ArrowUp size={16} /></button>
                        <button type="button" disabled={disabled || index === entries.length - 1} onClick={() => reorder(kind, entries, index, 1)} className={buttonClass} aria-label={t('aspire.moveDown', { number: index + 1 })}><ArrowDown size={16} /></button>
                        <button type="button" disabled={disabled} onClick={() => remove(entry)} className={buttonClass} aria-label={t('aspire.remove', { number: index + 1 })}><Trash2 size={16} /></button>
                      </>}
                    </div>
                  </li>;
                })}
              </ol>
              <button type="button" disabled={disabled} onClick={() => add(kind)} className={`mt-2 flex items-center gap-2 rounded-lg px-2 min-h-[44px] text-sm ${hoverBg} disabled:opacity-40`}><Plus size={16} />{t(`aspire.${kind === 'wish' ? 'addWish' : 'addMotto'}`)}</button>
            </section>;
          })}
        </div>
        <footer className={`border-t ${borderClass} px-4 py-2 text-xs ${textSecondary} flex flex-wrap items-center justify-between gap-2`}>
          <span role="status" aria-live="polite">{aspireLoaded && aspireWritable ? status : ''}</span>
          {undo && <div className="flex items-center gap-2"><span>{t('aspire.removed')}</span><button type="button" disabled={disabled} onClick={restore} className="underline min-h-[44px]">{t('aspire.undo')}</button></div>}
        </footer>
      </div>
    </div>
  );
}
