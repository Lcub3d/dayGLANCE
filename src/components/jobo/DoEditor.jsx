import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { completionMarker } from '../../jobo/completionMarker.js';
import { Trash2, X } from 'lucide-react';
import { DO_PROGRESS, DO_TIMING } from '../../jobo/core.js';
import { doIntervalAt, prepareDoDelete, commitDoEdit } from '../../jobo/viewActions.js';
import { createManualDo, prepareDoEdit } from '../../jobo/viewActions.js';
import { receiptState } from '../../hooks/useJoboViewWriter.js';

const fieldClass = 'flex flex-col gap-1 mb-3 [&_input]:w-full [&_select]:w-full [&_input]:p-2 [&_select]:p-2 [&_input]:rounded-lg [&_select]:rounded-lg [&_input]:border [&_select]:border [&_input]:border-stone-300 [&_select]:border-stone-300 [&_input]:bg-transparent [&_select]:bg-transparent dark:[&_input]:border-gray-600 dark:[&_select]:border-gray-600 [&_input]:focus:ring-2 [&_input]:focus:ring-blue-500';
const PROGRESS = [DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY, DO_PROGRESS.COMPLETED];
const minute = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export default function DoEditor({ record, initial, records, writable, recordJobo, onClose, pendingIds = [], t, cardBg, textPrimary, borderClass }) {
  const [id] = useState(() => record?.id || `manual:${crypto.randomUUID()}`);
  const marker = completionMarker(record);
  const [draft, setDraft] = useState(() => ({
    title: record?.title || initial?.title || '',
    progress: record?.progress || DO_PROGRESS.STARTED,
    ...(record ? {
      timing: record.timing, date: marker?.date || record.date, startTime: record.startTime || '',
      endDate: record.endDate || marker?.date || record.date, endTime: record.endTime || marker?.time || '',
    } : doIntervalAt(initial.date, initial.startMinute, initial.duration || 30)),
    ...initial?.patch,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const waiting = accepted || pendingIds.includes(id);
  const submitted = useRef(null);
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
    if (!accepted || pendingIds.includes(id) || !submitted.current) return;
    const state = receiptState(submitted.current, records);
    if (state === 'saved') onClose();
    else if (state === 'superseded') { setAccepted(false); setError(t('jobo.view.recordChanged')); }
  }, [accepted, pendingIds, id, onClose, records, t]);

  const save = async (remove = false) => {
    if (!writable || waiting || savingRef.current) return;
    if (!remove && !draft.title.trim()) { setError(t('jobo.view.titleRequired')); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const now = Date.now();
      const hasInterval = !!draft.startTime && !!draft.endTime;
      const keepsPoint = marker && !draft.startTime && draft.date === marker.date
        && draft.endDate === marker.date && draft.endTime === marker.time;
      if (!remove && !hasInterval && !keepsPoint) throw new TypeError('A complete interval is required');
      const patch = hasInterval
        ? { timing: DO_TIMING.TIMED, date: draft.date, startTime: draft.startTime, endDate: draft.endDate, endTime: draft.endTime }
        : {};
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
      submitted.current = next;
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
  const progressOptions = PROGRESS.filter(value => value !== DO_PROGRESS.COMPLETED || record?.progress === DO_PROGRESS.COMPLETED);

  return createPortal(<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialogRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="jobo-do-editor-title"
      className={`w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-xl p-6 text-sm ${cardBg} ${textPrimary} border ${borderClass}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="jobo-do-editor-title" className="text-lg font-semibold">{record ? t('common.edit') : t('jobo.view.addDo')}</h2>
        <button type="button" className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10" disabled={saving} onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={saving || waiting || !writable}>
        <label className={fieldClass}><span>{t('task.title')}</span>
          <input required value={draft.title} onChange={set('title')} disabled={!!record || saving} />
        </label>
        {record && <p className="text-xs opacity-75 my-2">{t('jobo.view.capturedTitle')}</p>}
        {marker && <p className="text-xs opacity-75 my-2">{t('jobo.view.completionPoint', { time: `${marker.date} ${marker.time}` })}</p>}
        <div className="grid grid-cols-2 gap-x-3">
          <label className={fieldClass}><span>{t('common.date')}</span><input required type="date" value={draft.date} onChange={set('date')} disabled={saving} /></label>
          <>
            <label className={fieldClass}><span>{t('common.start')}</span><input required={!marker} type="time" value={draft.startTime} onChange={set('startTime')} disabled={saving} /></label>
            <label className={fieldClass}><span>{t('jobo.view.endDate')}</span><input required type="date" value={draft.endDate} onChange={set('endDate')} disabled={saving} /></label>
            <label className={fieldClass}><span>{t('common.end')}</span><input required type="time" value={draft.endTime} onChange={set('endTime')} disabled={saving} /></label>
          </>
        </div>
        <label className={fieldClass}><span>{t('jobo.view.progressLabel')}</span>
          <select value={draft.progress} onChange={set('progress')} disabled={saving}>
            {progressOptions.map((value) => <option key={value} value={value}>{value === DO_PROGRESS.COMPLETED ? t('common.completed') : t(`jobo.view.progress.${value}`)}</option>)}
          </select>
        </label>
        <p className="text-xs opacity-75 my-2">{t('jobo.view.completedByCompletion')}</p>
        </fieldset>
        {waiting && <p className="text-xs opacity-75 my-2" role="status">{t('jobo.view.pendingSave')}</p>}
        {error && <p className="p-2 my-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-300" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 mt-4 [&_button]:px-3 [&_button]:py-2 [&_button]:rounded-lg [&_button]:flex [&_button]:items-center [&_button]:gap-1 [&_button]:disabled:opacity-40">
          {record && <button type="button" className="text-red-600 mr-auto hover:bg-red-500/10" onClick={() => save(true)} disabled={saving || waiting || !writable}><Trash2 size={14} />{t('common.delete')}</button>}
          <button type="button" onClick={onClose} disabled={saving}>{t(waiting ? 'common.close' : 'common.cancel')}</button>
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white" disabled={saving || waiting || !writable}>{saving ? t('common.loading') : t('common.save')}</button>
        </div>
      </form>
    </section>
  </div>, document.body);
}
