import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';

const MIN_NOTE_HEIGHT = 80;
const MAX_NOTE_HEIGHT = 1000;
const MIN_AUTO_NOTE_HEIGHT = 100;
const MAX_AUTO_NOTE_HEIGHT = 260;
const NOTE_LINE_LENGTH = 36;
const NOTE_LINE_HEIGHT = 18;
const SAVE_DELAY = 500;
const UNDO_DELAY = 5000;

function noteHeight(text) {
  const contentLines = Math.ceil(String(text || '').length / NOTE_LINE_LENGTH);
  return Math.min(MAX_AUTO_NOTE_HEIGHT, Math.max(MIN_AUTO_NOTE_HEIGHT, 70 + contentLines * NOTE_LINE_HEIGHT));
}

function clampHeight(value) {
  return Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, Math.round(value)));
}

function noteText(item) {
  return String(item?.record?.notes ?? item?.notes ?? '');
}

function noteTitle(item) {
  return item?.record?.title ?? item?.title ?? 'Do';
}

function errorCode(error) {
  if (!error) return '';
  return typeof error === 'string' ? error : error.code || '';
}

/**
 * The Do ledger has no task-note writer. This tile therefore waits for the
 * canonical record projection to confirm every asynchronous write before it
 * advances its baseline. It never invents a task object or a second store.
 */
export default function IndependentDoNote({
  item,
  t,
  onFocus,
  onHide,
  onUndoReady,
  onSaveDoNote,
  request,
  selected = false,
  isVisible = true,
  pendingIds = [],
  doWritable = true,
}) {
  const id = String(item?.record?.id ?? item?.id ?? '');
  const record = item?.record || null;
  const deleted = !!record?.deleted;
  const canonicalText = noteText(item);
  const title = noteTitle(item);
  const link = `do:${id}`;
  const [draft, setDraft] = useState(canonicalText);
  const [height, setHeight] = useState(() => noteHeight(canonicalText));
  const [saveError, setSaveError] = useState('');
  const [externalChange, setExternalChange] = useState(deleted);
  const [saving, setSaving] = useState(false);
  const [awaitingCanonical, setAwaitingCanonical] = useState(false);
  const [held, setHeld] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);
  const [requestFlash, setRequestFlash] = useState(false);
  const ref = useRef(null);
  const textarea = useRef(null);
  const baselineRef = useRef(canonicalText);
  const draftRef = useRef(canonicalText);
  const recordRef = useRef(record);
  const pendingRef = useRef(false);
  const doWritableRef = useRef(doWritable);
  const deletedRef = useRef(deleted);
  const pendingWriteRef = useRef(null);
  const savingRef = useRef(false);
  const awaitingRef = useRef(false);
  const heldRef = useRef(false);
  const externalRef = useRef(deleted);
  const readOnlyRef = useRef(false);
  const writeBlockedRef = useRef(false);
  const timerRef = useRef(null);
  const undoTimerRef = useRef(null);
  const undoValueRef = useRef(null);
  const undoAvailableRef = useRef(false);
  const pendingDeletePreviousRef = useRef(null);
  const deleteIntentRef = useRef(false);
  const clearedTextRef = useRef(null);
  const confirmedDeleteRef = useRef(false);
  const resizeCleanupRef = useRef(null);
  const handledRequestRef = useRef(null);
  const undoDeleteRef = useRef(null);
  const itemRef = useRef(item);
  const onHideRef = useRef(onHide);

  recordRef.current = record;
  doWritableRef.current = doWritable;
  deletedRef.current = deleted;
  itemRef.current = item;
  onHideRef.current = onHide;

  const pending = pendingIds.some((value) => String(value) === id);
  pendingRef.current = pending;
  readOnlyRef.current = saveError === 'readOnly';
  const writeBlocked = deleted || !doWritable || externalChange || pending || saving || awaitingCanonical || readOnlyRef.current;
  writeBlockedRef.current = writeBlocked;
  const displayVisible = isVisible || undoVisible;

  const clearUndo = useCallback(() => {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    undoValueRef.current = null;
    undoAvailableRef.current = false;
    setUndoAvailable(false);
    onUndoReady?.({ key: link, undo: null });
  }, [link, onUndoReady]);

  const showUndo = useCallback((value) => {
    undoValueRef.current = value;
    undoAvailableRef.current = true;
    setUndoAvailable(true);
    onUndoReady?.({ key: link, undo: undoDeleteRef.current });
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(clearUndo, UNDO_DELAY);
  }, [clearUndo, link, onUndoReady]);

  useEffect(() => {
    const next = canonicalText;
    const baseline = baselineRef.current;
    if (deletedRef.current) {
      setExternalChange(true);
      externalRef.current = true;
      setSaveError('recordChanged');
      return;
    }
    if (next === baseline) return;

    // A stale projection can replay the text that was just deleted after the
    // empty canonical record was observed. Keep the cleared state until the
    // user explicitly chooses undo so an old note cannot reappear.
    if (clearedTextRef.current != null && next === clearedTextRef.current && baseline === '') return;
    if (clearedTextRef.current != null && baseline === '' && next !== clearedTextRef.current) {
      clearedTextRef.current = null;
      confirmedDeleteRef.current = false;
      clearUndo();
    }

    // A successful result is only considered committed once the canonical
    // projection carries the exact submitted note. A different value means a
    // competing update won; keep the local draft and show the conflict.
    if (pendingWriteRef.current != null) {
      const submitted = pendingWriteRef.current;
      if (next === submitted) {
        baselineRef.current = next;
        pendingWriteRef.current = null;
        awaitingRef.current = false;
        setAwaitingCanonical(false);
        setHeld(false);
        heldRef.current = false;
        setExternalChange(false);
        externalRef.current = false;
        setSaveError('');
        if (submitted === '') {
          const previous = pendingDeletePreviousRef.current;
          pendingDeletePreviousRef.current = null;
          deleteIntentRef.current = false;
          clearedTextRef.current = previous || null;
          draftRef.current = '';
          setDraft('');
          if (previous && !confirmedDeleteRef.current) {
            confirmedDeleteRef.current = true;
            showUndo(previous);
            setUndoVisible(false);
              onHideRef.current?.(itemRef.current);
          }
        } else {
          clearedTextRef.current = null;
          deleteIntentRef.current = false;
        }
      } else {
        pendingWriteRef.current = null;
        pendingDeletePreviousRef.current = null;
        deleteIntentRef.current = false;
        clearedTextRef.current = null;
        confirmedDeleteRef.current = false;
        awaitingRef.current = false;
        setAwaitingCanonical(false);
        setExternalChange(true);
        externalRef.current = true;
        setSaveError('recordChanged');
      }
      return;
    }

    if (draftRef.current === baseline) {
      baselineRef.current = next;
      draftRef.current = next;
      setDraft(next);
      setExternalChange(false);
      externalRef.current = false;
      setSaveError('');
      deleteIntentRef.current = false;
      clearedTextRef.current = null;
      confirmedDeleteRef.current = false;
      setHeight((value) => value === noteHeight(baseline) ? noteHeight(next) : value);
      return;
    }

    setExternalChange(true);
    externalRef.current = true;
    setSaveError('recordChanged');
  }, [canonicalText, clearUndo, showUndo]);

  useEffect(() => {
    if (!deleted) return;
    clearUndo();
    setUndoVisible(false);
    deleteIntentRef.current = false;
    clearedTextRef.current = null;
    setExternalChange(true);
    externalRef.current = true;
    setAwaitingCanonical(false);
    awaitingRef.current = false;
    setSaveError('recordChanged');
  }, [clearUndo, deleted]);

  useEffect(() => {
    if (pending || savingRef.current) return;
    // A held write is retriable once ledger no longer reports it as pending.
    // Do not retry by itself; the user can blur or edit again deliberately.
    if (heldRef.current) {
      heldRef.current = false;
      setHeld(false);
      awaitingRef.current = false;
      setAwaitingCanonical(false);
      // The ledger has released a held write without publishing its value.
      // Keep the draft and make the original deletion an explicit retry so a
      // transient storage failure cannot hide the note.
      if (pendingWriteRef.current != null && deleteIntentRef.current) setSaveError('saveFailed');
    }
  }, [held, pending, clearUndo]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    resizeCleanupRef.current?.();
    onUndoReady?.({ key: link, undo: null });
  }, [link, onUndoReady]);

  useEffect(() => {
    if (!displayVisible || request?.key !== link) return undefined;
    const token = request?.token ?? request;
    if (handledRequestRef.current === token) return undefined;
    handledRequestRef.current = token;
    setRequestFlash(true);
    const timer = window.setTimeout(() => setRequestFlash(false), 800);
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!writeBlockedRef.current) textarea.current?.focus({ preventScroll: true });
      else ref.current?.focus({ preventScroll: true });
    });
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [displayVisible, link, request]);

  const save = useCallback(async (value, { fromDelete = false } = {}) => {
    if (!doWritableRef.current || deletedRef.current || externalRef.current || readOnlyRef.current || pendingRef.current || savingRef.current || awaitingRef.current) return false;
    const next = String(value ?? '');
    const previous = draftRef.current;
    if (!fromDelete && next === baselineRef.current) return true;
    if (fromDelete && !previous) return true;
    // Clearing an unsaved local draft to the already-canonical empty value is
    // a local operation. Do not manufacture an asynchronous no-op write that
    // could leave the tile waiting forever for a prop change.
    if (fromDelete && next === baselineRef.current) {
      pendingDeletePreviousRef.current = null;
      pendingWriteRef.current = null;
      deleteIntentRef.current = false;
      clearedTextRef.current = previous || null;
      confirmedDeleteRef.current = true;
      draftRef.current = '';
      setDraft('');
      setSaveError('');
      showUndo(previous);
      setUndoVisible(false);
             onHideRef.current?.(itemRef.current);
      return true;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setHeld(false);
    heldRef.current = false;
    pendingWriteRef.current = next;
    if (fromDelete) {
      confirmedDeleteRef.current = false;
      deleteIntentRef.current = true;
      pendingDeletePreviousRef.current = previous;
    }
    try {
      const result = await onSaveDoNote(recordRef.current, next);
      // A tombstone or a competing note can arrive while the writer promise
      // is in flight. Preserve that draft and reject the late acknowledgement
      // instead of clearing it or re-locking a conflicted tile.
      if (externalRef.current || deletedRef.current) {
        pendingWriteRef.current = null;
        pendingDeletePreviousRef.current = null;
        deleteIntentRef.current = false;
        clearedTextRef.current = null;
        confirmedDeleteRef.current = false;
        awaitingRef.current = false;
        setAwaitingCanonical(false);
        setSaveError('recordChanged');
        return false;
      }
      // The canonical projection can arrive before the writer promise
      // resolves. In that order the effect above already consumed the
      // pending value, so do not re-lock the tile after it was confirmed.
      const alreadyConfirmed = pendingWriteRef.current == null && baselineRef.current === next;
      if (alreadyConfirmed) {
        if (fromDelete) {
          deleteIntentRef.current = false;
          clearedTextRef.current = previous || null;
          draftRef.current = '';
          setDraft('');
          if (!confirmedDeleteRef.current) {
            confirmedDeleteRef.current = true;
            showUndo(previous);
            setUndoVisible(false);
             onHideRef.current?.(itemRef.current);
          }
        }
        return true;
      }
      if (result?.held === true && result?.ok !== true) {
        setHeld(true);
        heldRef.current = true;
        setSaveError('pending');
        awaitingRef.current = true;
        setAwaitingCanonical(true);
        pendingWriteRef.current = next;
        return false;
      }
      if (result?.ok !== true) throw Object.assign(new Error('Do note save failed'), { code: 'saveFailed' });
      // Keep the pending value until props confirm it. This protects a local
      // draft from a stale projection or a concurrent remote edit.
      awaitingRef.current = true;
      setAwaitingCanonical(true);
      if (fromDelete) {
        draftRef.current = '';
        setDraft('');
      }
      return true;
    } catch (error) {
      // The canonical projection is authoritative even if the writer promise
      // resolves late with an error. Do not resurrect a draft or turn an
      // already-confirmed delete back into an error state.
      if (!externalRef.current && !deletedRef.current && pendingWriteRef.current == null && baselineRef.current === next) {
        return true;
      }
      const code = errorCode(error) || 'saveFailed';
      if (code === 'pending') {
        setHeld(true);
        heldRef.current = true;
        setSaveError('pending');
        awaitingRef.current = true;
        setAwaitingCanonical(true);
        pendingWriteRef.current = next;
      } else {
        pendingWriteRef.current = null;
        if (fromDelete || deleteIntentRef.current) pendingDeletePreviousRef.current = previous;
        else pendingDeletePreviousRef.current = null;
        if (code === 'recordChanged') {
          deleteIntentRef.current = false;
          clearedTextRef.current = null;
          confirmedDeleteRef.current = false;
          setExternalChange(true);
          externalRef.current = true;
        }
        setSaveError(code);
      }
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [onSaveDoNote, showUndo]);

  const flush = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    return save(draftRef.current);
  }, [save]);

  const retrySave = useCallback(() => {
    if (deleteIntentRef.current || pendingDeletePreviousRef.current != null) {
      return save('', { fromDelete: true });
    }
    return flush();
  }, [flush, save]);

  const scheduleSave = () => {
    if (writeBlocked) return;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void save(draftRef.current);
    }, SAVE_DELAY);
  };

  const change = (event) => {
    const value = event.target.value;
    clearUndo();
    deleteIntentRef.current = false;
    pendingDeletePreviousRef.current = null;
    clearedTextRef.current = null;
    confirmedDeleteRef.current = false;
    draftRef.current = value;
    setDraft(value);
    setSaveError('');
    scheduleSave();
  };

  const deleteNote = () => { void save('', { fromDelete: true }); };

  const undoDelete = () => {
    if (!undoAvailableRef.current || writeBlockedRef.current) return;
    const previous = undoValueRef.current;
    if (previous == null) return;
    clearUndo();
    deleteIntentRef.current = false;
    pendingDeletePreviousRef.current = null;
    clearedTextRef.current = null;
    confirmedDeleteRef.current = false;
    setUndoVisible(true);
    draftRef.current = previous;
    setDraft(previous);
    void save(previous);
  };
  undoDeleteRef.current = undoDelete;

  const useLatest = () => {
    if (savingRef.current || pendingRef.current || awaitingRef.current) return;
    const latest = canonicalText;
    pendingWriteRef.current = null;
    pendingDeletePreviousRef.current = null;
    deleteIntentRef.current = false;
    clearedTextRef.current = null;
    confirmedDeleteRef.current = false;
    awaitingRef.current = false;
    heldRef.current = false;
    baselineRef.current = latest;
    draftRef.current = latest;
    setDraft(latest);
    setExternalChange(false);
    externalRef.current = false;
    setSaveError('');
    setHeld(false);
    setAwaitingCanonical(false);
    clearUndo();
  };

  const resize = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const startY = event.clientY;
    const startHeight = height;
    const move = (next) => setHeight(clampHeight(startHeight + next.clientY - startY));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (resizeCleanupRef.current === end) resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = end;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    window.addEventListener('pointercancel', end, { once: true });
  };

  const resizeByKeyboard = (event) => {
    const step = event.shiftKey ? 60 : 18;
    let next = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') next = height - (event.key === 'PageUp' ? 60 : step);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown') next = height + (event.key === 'PageDown' ? 60 : step);
    if (event.key === 'Home') next = MIN_NOTE_HEIGHT;
    if (event.key === 'End') next = MAX_NOTE_HEIGHT;
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    setHeight(clampHeight(next));
  };

  const status = deleted
    ? t('jobo.view.recordChanged', { defaultValue: 'This Do record was changed or deleted elsewhere.' })
    : externalChange
      ? t('jobo.view.notesChanged', { defaultValue: 'This note changed elsewhere; your draft was kept.' })
      : saveError === 'pending' || held || pending || awaitingCanonical
        ? t('jobo.view.pendingSave', { defaultValue: 'Saving this Do note…' })
        : saveError === 'readOnly'
          ? t('jobo.view.readOnly', { defaultValue: 'Read only' })
          : saveError === 'notLoaded'
            ? t('jobo.view.loadError', { defaultValue: 'Unable to load JOBO data.' })
            : saveError
              ? t('jobo.view.noteSaveFailed', { defaultValue: 'Unable to save this note; your draft was kept.' })
              : '';
  const editable = doWritable && !deleted;
  const canDelete = editable && !externalChange && saveError !== 'readOnly' && !pending && !saving && !awaitingCanonical && !!draft;

  return <section
    ref={ref}
    hidden={!displayVisible}
    tabIndex={-1}
    style={{ height }}
    className={`jobo-s5-note-tile rounded-lg bg-purple-500 text-white ${selected || externalChange || deleted ? 'jobo-s5-selected' : ''}`}
    data-jobo-note-link={link}
    data-jobo-do-note={id}
    data-jobo-note-kind="do"
    data-jobo-note-requested={requestFlash ? 'true' : undefined}
    data-jobo-note-state={deleted || externalChange ? 'conflict' : saveError ? 'error' : undefined}
    onFocus={() => onFocus?.({ task: link })}
    onMouseEnter={() => onFocus?.({ task: link })}
    onMouseLeave={() => onFocus?.(null)}
  >
    <div className="jobo-s5-note-title">
      <b title={title}>{renderTitleWithoutTags(title)}</b>
      <span className="jobo-s5-hover-actions" data-jobo-note-actions>
        <button type="button" className="jobo-s5-note-hide" title={t('jobo.view.hideNote', { defaultValue: 'Hide note' })}
          aria-label={`${t('jobo.view.hideNote', { defaultValue: 'Hide note' })}: ${title}`} onClick={(event) => { event.stopPropagation(); setUndoVisible(false); onHide?.(item); }}>
          <X size={12} aria-hidden="true" />
        </button>
        <button type="button" className="jobo-s5-note-delete" title={t('jobo.view.deleteNote', { defaultValue: 'Delete note content' })}
          aria-label={`${t('jobo.view.deleteNote', { defaultValue: 'Delete note content' })}: ${title}`} disabled={!canDelete}
          onClick={(event) => { event.stopPropagation(); deleteNote(); }}>
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </span>
    </div>
    {externalChange && !deleted && <div className="jobo-s5-note-latest" role="status">
      <span className="jobo-s5-note-latest-label">{t('jobo.view.notesLatestText', { defaultValue: 'Latest text' })}</span>
      <div className="jobo-s5-note-latest-text">{canonicalText || t('common.empty', { defaultValue: '' })}</div>
      <button type="button" disabled={saving || pending || awaitingCanonical} onClick={useLatest}>{t('jobo.view.notesUseLatest', { defaultValue: 'Use latest content' })}</button>
    </div>}
    {editable ? <textarea
      ref={textarea}
      aria-label={`${t('task.notes')}: ${title}`}
      placeholder={t('jobo.view.notePlaceholder', { defaultValue: 'Add a note…' })}
      value={draft}
      readOnly={writeBlocked}
      onChange={change}
      onBlur={flush}
      onFocus={() => onFocus?.({ task: link })}
    /> : <div className="jobo-s5-note-text">{draft || t('common.empty', { defaultValue: '' })}</div>}
    {status && <p className="jobo-s5-note-status" role="status">{status}</p>}
    {saveError && !externalChange && !deleted && !held && !pending && <button type="button" className="jobo-s5-note-retry" onClick={() => void retrySave()}>
      {t('jobo.view.retryNoteSave', { defaultValue: 'Retry save' })}
    </button>}
    {undoAvailable && editable && !externalChange && !deleted && <button type="button" className="jobo-s5-note-undo" onClick={undoDelete}>
      {t('jobo.view.undoDeleteNote', { defaultValue: 'Undo delete' })}
    </button>}
    <div className="jobo-s5-note-resizer" role="separator" tabIndex={0} aria-orientation="horizontal"
      aria-valuemin={MIN_NOTE_HEIGHT} aria-valuemax={MAX_NOTE_HEIGHT} aria-valuenow={height}
      aria-label={t('jobo.view.resizeNote', { defaultValue: 'Resize note' })} title={t('jobo.view.resizeNote', { defaultValue: 'Resize note' })}
      onPointerDown={resize} onKeyDown={resizeByKeyboard}><span /></div>
  </section>;
}

export { noteText, noteTitle };
