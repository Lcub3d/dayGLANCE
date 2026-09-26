import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { writePlanNotes, writeDailyNotes } from '../../jobo/nativePlanAdapter.js';
import IndependentDoNote from './IndependentDoNote.jsx';
import { sortNoteTasks } from './noteOrder.js';

const MIN_NOTE_HEIGHT = 80;
const MAX_NOTE_HEIGHT = 1000;
const TASK_NOTE_MIN_HEIGHT = 100;
const DAILY_NOTE_MIN_HEIGHT = 150;
const MAX_AUTO_NOTE_HEIGHT = 260;
const NOTE_LINE_LENGTH = 36;
const NOTE_LINE_HEIGHT = 18;

function noteHeight(text, daily = false) {
  const contentLines = Math.ceil(String(text || '').length / NOTE_LINE_LENGTH);
  return Math.min(
    MAX_AUTO_NOTE_HEIGHT,
    Math.max(daily ? DAILY_NOTE_MIN_HEIGHT : TASK_NOTE_MIN_HEIGHT, 70 + contentLines * NOTE_LINE_HEIGHT),
  );
}

function clampHeight(value) {
  return Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, Math.round(value)));
}

function NoteTile({
  title,
  subtitle,
  text,
  color,
  editable,
  onSave,
  onHide,
  onShow,
  onInteract,
  t,
  link,
  onFocus,
  request,
  selected,
  visible = true,
  daily = false,
  onUndoReady,
}) {
  const [draft, setDraft] = useState(() => String(text || ''));
  const [height, setHeight] = useState(() => noteHeight(text, daily));
  const [saveError, setSaveError] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [requestFlash, setRequestFlash] = useState(false);
  const ref = useRef(null);
  const textarea = useRef(null);
  const handledRequest = useRef(null);
  const resizeCleanupRef = useRef(null);
  const baselineRef = useRef(String(text || ''));
  const pendingWriteRef = useRef(null);
  const draftRef = useRef(String(text || ''));
  const clearedTextRef = useRef(null);
  const deleteIntentRef = useRef(false);
  const manualHeightRef = useRef(false);
  const undoValueRef = useRef(null);
  const undoTimerRef = useRef(null);
  const undoAvailableRef = useRef(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const clearUndo = useCallback(() => {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    undoValueRef.current = null;
    undoAvailableRef.current = false;
    setUndoAvailable(false);
    onUndoReady?.({ key: link, undo: null });
  }, [link, onUndoReady]);

  // Keep an in-progress draft intact when the tile is hidden or the parent
  // rerenders. A changed source value is treated as a conflict once the user
  // has typed locally, so another device cannot silently overwrite the draft.
  useEffect(() => {
    const next = String(text || '');
    const baseline = baselineRef.current;
    if (next === baseline) return;

    // A late native refresh can briefly replay the text that was just
    // cleared. Keep the accepted deletion authoritative until the user
    // explicitly undoes it, instead of resurrecting the old draft.
    if (clearedTextRef.current != null && next === clearedTextRef.current && baseline === '') return;
    if (clearedTextRef.current != null && baseline === '' && next !== clearedTextRef.current) {
      clearedTextRef.current = null;
      deleteIntentRef.current = false;
      clearUndo();
    }

    if (pendingWriteRef.current != null && next === pendingWriteRef.current) {
      baselineRef.current = next;
      pendingWriteRef.current = null;
      setExternalChange(false);
      setSaveError(false);
      return;
    }

    if (draftRef.current === baseline && pendingWriteRef.current == null) {
      baselineRef.current = next;
      draftRef.current = next;
      deleteIntentRef.current = false;
      setDraft(next);
      setExternalChange(false);
      if (!manualHeightRef.current) setHeight(noteHeight(next, daily));
      return;
    }

    setExternalChange(true);
  }, [text, daily, clearUndo]);

  useEffect(() => {
    if (!manualHeightRef.current) setHeight(noteHeight(draftRef.current, daily));
  }, [draft, daily]);

  useEffect(() => {
    // Notes stay mounted while the column or an individual tile is hidden.
    // Wait until the requested tile is visible before scrolling or focusing.
    if (!visible || request?.key !== link) return undefined;
    const token = request?.token ?? request;
    if (handledRequest.current === token) return undefined;
    handledRequest.current = token;
    setRequestFlash(true);
    const flashTimer = window.setTimeout(() => setRequestFlash(false), 800);
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (editable) textarea.current?.focus({ preventScroll: true });
      else ref.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(flashTimer);
      setRequestFlash(false);
    };
  }, [editable, link, request, visible]);

  useEffect(() => () => {
    resizeCleanupRef.current?.();
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    onUndoReady?.({ key: link, undo: null });
  }, [link, onUndoReady]);

  const saveDraft = (value) => {
    if (!editable || externalChange) return;
    pendingWriteRef.current = value;
    try {
      const result = onSave(value);
      if (result === false) throw new Error('note save failed');
      setSaveError(false);
      // A synchronous native update may not cause a distinct prop render when
      // the value is unchanged. Advance the baseline in that case.
      if (String(text || '') === value) {
        baselineRef.current = value;
        pendingWriteRef.current = null;
      }
    } catch {
      clearedTextRef.current = null;
      pendingWriteRef.current = null;
      setSaveError(true);
    }
  };

  const useLatest = () => {
    const latest = String(text || '');
    clearedTextRef.current = null;
    deleteIntentRef.current = false;
    pendingWriteRef.current = null;
    baselineRef.current = latest;
    draftRef.current = latest;
    setDraft(latest);
    setExternalChange(false);
    setSaveError(false);
    if (!manualHeightRef.current) setHeight(noteHeight(latest, daily));
  };

  const retrySave = () => {
    if (externalChange) return;
    if (deleteIntentRef.current) {
      deleteNote();
      return;
    }
    saveDraft(draftRef.current);
  };

  const showUndo = (value) => {
    undoValueRef.current = value;
    undoAvailableRef.current = true;
    setUndoAvailable(true);
    onUndoReady?.({ key: link, undo: undoDelete });
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(clearUndo, 5000);
  };

  const deleteNote = () => {
    if (!editable || externalChange) return;
    const previous = draftRef.current;
    if (!previous) return;
    deleteIntentRef.current = true;
    pendingWriteRef.current = '';
    try {
      const result = onSave('');
      if (result === false) throw new Error('note save failed');
      deleteIntentRef.current = false;
      clearedTextRef.current = previous;
      draftRef.current = '';
      setDraft('');
      setSaveError(false);
      onHide?.();
      showUndo(previous);
      // If the native writer did not produce a separate prop update, keep the
      // local baseline coherent with the value that was accepted.
      if (String(text || '') === '') {
        baselineRef.current = '';
        pendingWriteRef.current = null;
      }
    } catch {
      clearedTextRef.current = null;
      pendingWriteRef.current = null;
      setSaveError(true);
    }
  };

  const undoDelete = () => {
    if (!editable || externalChange || !undoAvailableRef.current) return;
    const previous = undoValueRef.current;
    if (previous == null) return;
    clearedTextRef.current = null;
    pendingWriteRef.current = previous;
    try {
      const result = onSave(previous);
      if (result === false) throw new Error('note save failed');
      onShow?.();
      draftRef.current = previous;
      setDraft(previous);
      setSaveError(false);
      clearUndo();
      if (String(text || '') === previous) {
        baselineRef.current = previous;
        pendingWriteRef.current = null;
      }
    } catch {
      clearedTextRef.current = null;
      pendingWriteRef.current = null;
      setSaveError(true);
    }
  };

  const change = (event) => {
    const value = event.target.value;
    clearedTextRef.current = null;
    deleteIntentRef.current = false;
    clearUndo();
    draftRef.current = value;
    setDraft(value);
    if (!externalChange) saveDraft(value);
  };

  const resize = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    manualHeightRef.current = true;
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
    manualHeightRef.current = true;
    setHeight(clampHeight(next));
  };

  const status = externalChange
    ? t('jobo.view.notesChanged', { defaultValue: 'This note changed elsewhere; your draft was kept.' })
    : saveError
      ? t('jobo.view.noteSaveFailed', { defaultValue: 'Unable to save this note; your draft was kept.' })
      : '';

  return <section
    ref={ref}
    hidden={!visible}
    tabIndex={-1}
    style={{ height }}
    className={`jobo-s5-note-tile rounded-lg ${color || 'jobo-s5-daily-note'} ${selected ? 'jobo-s5-selected' : ''}`}
    data-jobo-note-requested={requestFlash ? 'true' : undefined}
    data-jobo-note-state={externalChange ? 'conflict' : saveError ? 'error' : undefined}
    data-jobo-note-link={link}
    onFocus={() => onFocus({ task: link })}
    onMouseEnter={() => onFocus({ task: link })}
    onMouseLeave={() => onFocus(null)}
  >
    <div className="jobo-s5-note-title">
      <b title={title}>{renderTitleWithoutTags(title)}{subtitle && <small className="jobo-s5-note-source-date">{subtitle}</small>}</b>
      <span className="jobo-s5-hover-actions" data-jobo-note-actions>
        <button
          type="button"
          className="jobo-s5-note-hide"
          title={t('jobo.view.hideNote', { defaultValue: 'Hide note' })}
          aria-label={`${t('jobo.view.hideNote', { defaultValue: 'Hide note' })}: ${title}`}
          onClick={(event) => { event.stopPropagation(); onHide?.(); }}
        ><X size={12} aria-hidden="true" /></button>
        <button
          type="button"
          className="jobo-s5-note-delete"
          title={t('jobo.view.deleteNote', { defaultValue: 'Delete note content' })}
          aria-label={`${t('jobo.view.deleteNote', { defaultValue: 'Delete note content' })}: ${title}`}
          disabled={!editable || externalChange || !draft}
          onClick={(event) => { event.stopPropagation(); deleteNote(); }}
        ><Trash2 size={12} aria-hidden="true" /></button>
      </span>
    </div>
    {externalChange && <div className="jobo-s5-note-latest" role="status">
      <span className="jobo-s5-note-latest-label">{t('jobo.view.notesLatestText', { defaultValue: 'Latest text' })}</span>
      <div className="jobo-s5-note-latest-text">{text || t('common.empty', { defaultValue: '' })}</div>
      <button type="button" onClick={useLatest}>{t('jobo.view.notesUseLatest', { defaultValue: 'Use latest content' })}</button>
    </div>}
    {editable ? <textarea
      ref={textarea}
      aria-label={`${t('task.notes')}: ${title}`}
      placeholder={t('jobo.view.notePlaceholder', { defaultValue: 'Add a note…' })}
      value={draft}
      onChange={event => { onInteract?.(); change(event); }}
      onFocus={() => onFocus({ task: link })}
    /> : <div className="jobo-s5-note-text">{draft || t('common.empty', { defaultValue: '' })}</div>}
    {status && <p className="jobo-s5-note-status" role="alert">{status}</p>}
    {saveError && !externalChange && <button type="button" className="jobo-s5-note-retry" onClick={retrySave}>
      {t('jobo.view.retryNoteSave', { defaultValue: 'Retry save' })}
    </button>}
    {undoAvailable && editable && !externalChange && <button type="button" className="jobo-s5-note-undo" onClick={undoDelete}>
      {t('jobo.view.undoDeleteNote', { defaultValue: 'Undo delete' })}
    </button>}
    <div
      className="jobo-s5-note-resizer"
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-valuemin={MIN_NOTE_HEIGHT}
      aria-valuemax={MAX_NOTE_HEIGHT}
      aria-valuenow={height}
      aria-label={t('jobo.view.resizeNote', { defaultValue: 'Resize note' })}
      title={t('jobo.view.resizeNote', { defaultValue: 'Resize note' })}
      onPointerDown={resize}
      onKeyDown={resizeByKeyboard}
    ><span /></div>
  </section>;
}

export default function NotesColumn({
  tasks,
  date,
  ctx,
  t,
  onFocus,
  request,
  focus,
  visible = true,
  isTaskNoteVisible = (task) => !!task?.notes,
  onHideTaskNote,
  onShowTaskNote,
  planItems = [],
  onDragOver,
  onDrop,
  independentDos = [],
  isDoNoteVisible = (item) => !!(item?.notes ?? item?.record?.notes),
  onHideDoNote,
  onSaveDoNote,
  pendingIds = [],
  doWritable = true,
}) {
  const [dailyVisible, setDailyVisible] = useState(true);
  const [undoEntry, setUndoEntry] = useState(null);
  const updateUndoEntry = useCallback((entry) => {
    if (!entry?.key) return;
    setUndoEntry((current) => {
      if (entry.undo) return entry;
      return current?.key === entry.key ? null : current;
    });
  }, []);
  const seen = new Set();
  const noteTasks = sortNoteTasks((tasks || []).filter((task) => {
    if (!task?.id || seen.has(String(task.id))) return false;
    seen.add(String(task.id));
    return true;
  }), planItems, date);
  const dailyLink = `daily:${date}`;
  const orderedDoNotes = [...(independentDos || [])].filter((item) => item?.id || item?.record?.id).sort((a, b) => {
    const aStart = Number.isFinite(a?.startMinute) ? a.startMinute : (Number.isFinite(a?.record?.startMinute) ? a.record.startMinute : Number.MAX_SAFE_INTEGER);
    const bStart = Number.isFinite(b?.startMinute) ? b.startMinute : (Number.isFinite(b?.record?.startMinute) ? b.record.startMinute : Number.MAX_SAFE_INTEGER);
    return aStart - bStart || String(a?.id ?? a?.record?.id).localeCompare(String(b?.id ?? b?.record?.id));
  });

  useEffect(() => {
    if (request?.key === dailyLink) setDailyVisible(true);
  }, [dailyLink, request]);

  return <aside hidden={!visible} className={`jobo-s5-notes-column border-l ${ctx.borderClass}`} data-jobo-notes onDragOver={onDragOver} onDrop={onDrop}>
    {noteTasks.map((task) => <NoteTile
      key={String(task.id)}
      title={task.title}
      subtitle={task.recurringTemplateId ? task.date : null}
      text={task.notes || ''}
      color={`${task.color || 'bg-blue-500'} text-white`}
      editable={!task.imported && !task.isJoboSyntheticOccurrence}
      t={t}
      link={String(task.id)}
      selected={focus?.task === String(task.id)}
      visible={visible && isTaskNoteVisible(task)}
      onHide={() => onHideTaskNote?.(task)}
      onShow={() => onShowTaskNote?.(task)}
      onInteract={() => onShowTaskNote?.(task)}
      onUndoReady={updateUndoEntry}
      onSave={(text) => writePlanNotes(ctx, task, text)}
      onFocus={onFocus}
      request={request}
    />)}
    {orderedDoNotes.map((item) => <IndependentDoNote
      key={`do:${String(item.record?.id ?? item.id)}`}
      item={item}
      t={t}
      onFocus={onFocus}
      selected={focus?.task === `do:${String(item.record?.id ?? item.id)}`}
      onHide={() => onHideDoNote?.(item)}
      onUndoReady={updateUndoEntry}
      onSaveDoNote={onSaveDoNote}
      request={request}
      isVisible={visible && isDoNoteVisible(item)}
      pendingIds={pendingIds}
      doWritable={doWritable}
    />)}
    <NoteTile
      key={dailyLink}
      title={t('common.dailyNote')}
      text={ctx.dailyNotes?.[date]?.text || ''}
      editable
      daily
      t={t}
      link={dailyLink}
      visible={visible && dailyVisible}
      onHide={() => setDailyVisible(false)}
      onShow={() => setDailyVisible(true)}
      onUndoReady={updateUndoEntry}
      onSave={(text) => writeDailyNotes(ctx, date, text)}
      onFocus={onFocus}
      request={request}
    />
    {visible && !dailyVisible && <button
      type="button"
      className="jobo-s5-show-daily"
      onClick={() => setDailyVisible(true)}
      aria-label={t('jobo.view.showDailyNote', { defaultValue: 'Show daily note' })}
    >{t('jobo.view.showDailyNote', { defaultValue: 'Show daily note' })}</button>}
    {visible && undoEntry && <div className="jobo-s5-note-latest" data-jobo-note-undo role="status">
      <span className="jobo-s5-note-latest-label">{t('jobo.view.noteCleared', { defaultValue: 'Note cleared' })}</span>
      <button type="button" className="jobo-s5-note-undo" onClick={() => undoEntry.undo?.()}>
        {t('jobo.view.undoDeleteNote', { defaultValue: 'Undo delete' })}
      </button>
    </div>}
  </aside>;
}
