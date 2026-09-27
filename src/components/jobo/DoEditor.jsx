import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { completionMarker } from '../../jobo/completionMarker.js';
import { Trash2 } from 'lucide-react';
import { DO_PROGRESS, DO_TIMING } from '../../jobo/core.js';
import { doIntervalAt, prepareDoDelete, commitDoEdit } from '../../jobo/viewActions.js';
import { createManualDo, prepareDoEdit } from '../../jobo/viewActions.js';
import { receiptState } from '../../hooks/useJoboViewWriter.js';

const PROGRESS = [DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY, DO_PROGRESS.COMPLETED];
const minute = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
// An end before the start is the next day, the way people read "23:00 to
// 01:00". The form has no separate end-date field. An end equal to the start
// stays on the same day, so core refuses it as an empty interval rather than
// the form quietly recording 24 hours.
export const endDateFor = (date, startTime, endTime) => {
  if (!date || !startTime || !endTime || minute(endTime) >= minute(startTime)) return date;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

// Styled after DesktopNewTaskModal: the same shell, labels, inputs, footer
// and keyboard hint, so adding a Do reads like adding a task.
export default function DoEditor({ record, initial, records, writable, recordJobo, onClose, pendingIds = [], t, cardBg, textPrimary, textSecondary = '', borderClass, darkMode = false }) {
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
      const keepsPoint = marker && !draft.startTime && draft.date === marker.date && draft.endTime === marker.time;
      if (!remove && !hasInterval && !keepsPoint) throw new TypeError('A complete interval is required');
      const endDate = endDateFor(draft.date, draft.startTime, draft.endTime);
      const patch = hasInterval
        ? { timing: DO_TIMING.TIMED, date: draft.date, startTime: draft.startTime, endDate, endTime: draft.endTime }
        : {};
      let next;
      if (remove) next = prepareDoDelete({ records: latestRecords.current, record, now });
      else if (record) next = prepareDoEdit({ records: latestRecords.current, record, patch, progress: draft.progress, now });
      else {
        const duration = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${draft.date}T00:00:00Z`)) / 60000
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

  const input = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`;
  const label = `block text-sm ${textSecondary} mb-1`;
  const kbd = `px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded`;
  const busy = saving || waiting || !writable;

  return createPortal(<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialogRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="jobo-do-editor-title"
      className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto`}>
      <h3 id="jobo-do-editor-title" className={`font-semibold ${textPrimary} mb-4 text-lg`}>{record ? t('common.edit') : initial?.continuing ? t('jobo.view.continueDo') : t('jobo.view.addDo')}</h3>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label className={label} htmlFor="jobo-do-title">{t('task.title')}</label>
            <input id="jobo-do-title" className={input} required value={draft.title} onChange={set('title')} disabled={!!record || saving} />
            {record && <p className={`mt-1 text-xs ${textSecondary}`}>{t('jobo.view.capturedTitle')}</p>}
          </div>
          {marker && <p className={`text-xs ${textSecondary}`}>{t('jobo.view.completionPoint', { time: `${marker.date} ${marker.time}` })}</p>}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label} htmlFor="jobo-do-date">{t('common.date')}</label>
              <input id="jobo-do-date" className={input} required type="date" value={draft.date} onChange={set('date')} disabled={saving} />
            </div>
            <div>
              <label className={label} htmlFor="jobo-do-start">{t('common.start')}</label>
              <input id="jobo-do-start" className={input} required={!marker} type="time" value={draft.startTime} onChange={set('startTime')} disabled={saving} />
            </div>
            <div>
              <label className={label} htmlFor="jobo-do-end">{t('common.end')}</label>
              <input id="jobo-do-end" className={input} required type="time" value={draft.endTime} onChange={set('endTime')} disabled={saving} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="jobo-do-progress">{t('jobo.view.progressLabel')}</label>
            <select id="jobo-do-progress" className={input} value={draft.progress} onChange={set('progress')} disabled={saving}>
              {progressOptions.map((value) => <option key={value} value={value}>{value === DO_PROGRESS.COMPLETED ? t('common.completed') : t(`jobo.view.progress.${value}`)}</option>)}
            </select>
            {record && <p className={`mt-1 text-xs ${textSecondary}`}>{t('jobo.view.completedByCompletion')}</p>}
          </div>
        </fieldset>
        {waiting && <p className={`mt-3 text-xs ${textSecondary}`} role="status">{t('jobo.view.pendingSave')}</p>}
        {error && <p className={`mt-3 p-2 rounded-lg text-sm ${darkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-50 text-red-700'}`} role="alert">{error}</p>}
        <div className="flex gap-2 pt-4">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={busy}>
            {saving ? t('common.loading') : record ? t('common.save') : t('jobo.view.addDo')}
          </button>
          {record && (
            <button type="button" className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
              onClick={() => save(true)} disabled={busy}>
              <Trash2 size={14} />{t('common.delete')}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving}
            className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}>
            {t(waiting ? 'common.close' : 'common.cancel')}
          </button>
        </div>
        <div className={`mt-3 text-xs ${textSecondary} text-center`}>
          <kbd className={kbd}>Enter</kbd> {t('common.save')} • <kbd className={kbd}>Esc</kbd> {t('common.cancel')}
        </div>
      </form>
    </section>
  </div>, document.body);
}
