import React, { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { DO_PROGRESS, DO_TIMING } from '../../jobo/core.js';
import { doIntervalAt, prepareDoDelete, commitDoEdit } from '../../jobo/viewActions.js';
import { createViewDo as createManualDo, prepareViewDoEdit as prepareDoEdit } from '../../jobo/viewProgress.js';

const PROGRESS = [DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY, DO_PROGRESS.COMPLETED];
const minute = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export default function DoEditor({ record, initial, records, writable, recordJobo, onClose, pendingIds = [], t, cardBg, textPrimary, borderClass }) {
  const [id] = useState(() => record?.id || `manual:${crypto.randomUUID()}`);
  const [draft, setDraft] = useState(() => ({
    title: record?.title || initial?.title || '',
    progress: record?.progress || DO_PROGRESS.COMPLETED,
    ...(record ? {
      timing: record.timing, date: record.date, startTime: record.startTime || '09:00',
      endDate: record.endDate || record.date, endTime: record.endTime || '09:30',
    } : doIntervalAt(initial.date, initial.startMinute, initial.duration || 30)),
    ...initial?.patch,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const waiting = accepted || pendingIds.includes(id);
  const savingRef = useRef(false);
  const dialogRef = useRef(null);
  const latestRecords = useRef(records);
  latestRecords.current = records;
  const set = (key) => (event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }));

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('input:not(:disabled),select,button')?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  useEffect(() => {
    if (accepted && !pendingIds.includes(id)) onClose();
  }, [accepted, pendingIds, id, onClose]);

  const save = async (remove = false) => {
    if (!writable || waiting || savingRef.current) return;
    if (!remove && !draft.title.trim()) { setError(t('jobo.view.titleRequired')); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const now = Date.now();
      const patch = draft.timing === DO_TIMING.TIMED
        ? { timing: draft.timing, date: draft.date, startTime: draft.startTime, endDate: draft.endDate, endTime: draft.endTime }
        : { timing: DO_TIMING.UNTIMED, date: draft.date, startTime: null, endDate: null, endTime: null };
      let next;
      if (remove) next = prepareDoDelete({ records: latestRecords.current, record, now });
      else if (record) next = prepareDoEdit({ records: latestRecords.current, record, patch, progress: draft.progress, now });
      else {
        const duration = (Date.parse(`${draft.endDate}T00:00:00Z`) - Date.parse(`${draft.date}T00:00:00Z`)) / 60000
          + minute(draft.endTime) - minute(draft.startTime);
        next = createManualDo({ id, title: draft.title.trim(), task: initial?.task, planSnapshot: initial?.planSnapshot,
          date: draft.date, startMinute: minute(draft.startTime), duration, progress: draft.progress, now });
      }
      if (!next) { setError(t('jobo.view.recordChanged')); return; }
      const result = next !== record ? await commitDoEdit(recordJobo, next) : { ok: true };
      if (result.held && !result.ok) setAccepted(true);
      else onClose();
    } catch (err) {
      setError(t(err.code === 'readOnly' ? 'jobo.view.readOnly' : err.code === 'notLoaded' ? 'jobo.view.loadError' : err instanceof TypeError || err instanceof RangeError ? 'jobo.view.completeInterval' : 'jobo.view.updateFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!saving) onClose(); }
    if (event.key !== 'Tab') return;
    const fields = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
    const target = event.shiftKey ? fields.at(-1) : fields[0];
    if (document.activeElement === (event.shiftKey ? fields[0] : fields.at(-1))) {
      event.preventDefault(); target?.focus();
    }
  };
  const progressOptions = PROGRESS;

  return <div className="jobo-s5-modal-mask" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialogRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="jobo-do-editor-title"
      className={`jobo-s5-dialog ${cardBg} ${textPrimary} border ${borderClass}`}>
      <div className="jobo-s5-dialog-head">
        <h2 id="jobo-do-editor-title" className="jobo-s5-dialog-title">{record ? t('common.edit') : t('jobo.view.addDo')}</h2>
        <button type="button" className="jobo-s5-close-button" disabled={saving} onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={saving || waiting || !writable}>
        <label className="jobo-s5-field"><span>{t('task.title')}</span>
          <input required value={draft.title} onChange={set('title')} disabled={!!record || saving} />
        </label>
        {record && <p className="jobo-s5-dialog-note">{t('jobo.view.capturedTitle')}</p>}
        {record && <label className="jobo-s5-field"><span>{t('task.time')}</span>
          <select value={draft.timing} onChange={set('timing')} disabled={saving}>
            <option value={DO_TIMING.TIMED}>{t('jobo.view.timed')}</option>
            <option value={DO_TIMING.UNTIMED}>{t('jobo.view.untimed')}</option>
          </select>
        </label>}
        <div className="jobo-s5-edit-grid">
          <label className="jobo-s5-field"><span>{t('common.date')}</span><input required type="date" value={draft.date} onChange={set('date')} disabled={saving} /></label>
          {draft.timing === DO_TIMING.TIMED && <>
            <label className="jobo-s5-field"><span>{t('common.start')}</span><input required type="time" value={draft.startTime} onChange={set('startTime')} disabled={saving} /></label>
            <label className="jobo-s5-field"><span>{t('jobo.view.endDate')}</span><input required type="date" value={draft.endDate} onChange={set('endDate')} disabled={saving} /></label>
            <label className="jobo-s5-field"><span>{t('common.end')}</span><input required type="time" value={draft.endTime} onChange={set('endTime')} disabled={saving} /></label>
          </>}
        </div>
        <label className="jobo-s5-field"><span>{t('jobo.view.progressLabel')}</span>
          <select value={draft.progress} onChange={set('progress')} disabled={saving}>
            {progressOptions.map((value) => <option key={value} value={value}>{value === DO_PROGRESS.COMPLETED ? t('common.completed') : t(`jobo.view.progress.${value}`)}</option>)}
          </select>
        </label>
        <p className="jobo-s5-dialog-note">{t('jobo.view.doCompletionLinkHint', { defaultValue: 'Completed checks the linked Plan; other progress values reopen it.' })}</p>
        </fieldset>
        {waiting && <p className="jobo-s5-dialog-note" role="status">{t('jobo.view.pendingSave')}</p>}
        {error && <p className="jobo-s5-dialog-error" role="alert">{error}</p>}
        <div className="jobo-s5-dialog-actions">
          {record && <button type="button" className="jobo-s5-delete-button" onClick={() => save(true)} disabled={saving || waiting || !writable}><Trash2 size={14} />{t('common.delete')}</button>}
          <button type="button" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className="jobo-s5-save-button" disabled={saving || waiting || !writable}>{saving ? t('common.loading') : t('common.save')}</button>
        </div>
      </form>
    </section>
  </div>;
}
