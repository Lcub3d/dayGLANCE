import React, { useState } from 'react';
import { Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { labelTaskEntity } from '../../jobu/labels.js';
import { quoteFilterName } from '../../jobu/filters.js';
import { setTaskLabel } from '../../jobu/organizerStore.js';
import OrganizerDialog from './OrganizerDialog.jsx';
import './organizer.css';

export function TaskLabelChips({ task, onSelect, interactive = true }) {
  const f = useFeaturesCtx(), o = f?.jobuOrganizer;
  if (!o?.loaded) return null;
  const labels = o.labels.labelsFor(task);
  if (!labels.length) return null;
  return <span className="ju-label-chips" data-jobu-task-labels>{labels.map(label => {
    const content = <><Tag size={10} /><span>{label.name}</span></>;
    return interactive ? <button key={label.id} type="button" draggable={false} className={`ju-label-chip ju-color-${label.color}`} onMouseDown={e => e.stopPropagation()} onClick={e => {
      e.stopPropagation(); e.preventDefault(); const query = `%${quoteFilterName(label.name)}`;
      if (onSelect) onSelect(query, label.name); else f.openJobuFilter?.(query, label.name);
    }} title={label.name}>{content}</button> : <span key={label.id} className={`ju-label-chip ju-color-${label.color}`}>{content}</span>;
  })}</span>;
}
export function TaskLabelPicker({ task, onClose }) {
  const f = useFeaturesCtx(), o = f.jobuOrganizer, { t } = useTranslation();
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const liveTask = o.entries.find(entry => String(entry.task.id) === String(task.id))?.task;
  const selected = new Set(o.labels.labelsFor(liveTask || task).map(label => label.id));
  const choices = [...o.labels.definitions.values()].filter(label => !label.deleted && label.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name));
  async function toggle(label, enabled, control) {
    if (busy || !liveTask) return;
    setBusy(true); setError('');
    try { await setTaskLabel(f.jobuData, liveTask, label, enabled, o.heads.get(labelTaskEntity(task))?.id ?? null); }
    catch (e) { setError(e.message); } finally { setBusy(false); requestAnimationFrame(() => { if (control?.isConnected) control.focus(); }); }
  }
  return <OrganizerDialog title={t('organizer.taskLabels')} onClose={onClose} busy={busy}>
    <p className="ju-muted">{t(task.recurringTemplateId != null || task._jobuRecurringChild ? 'organizer.seriesLabels' : 'organizer.localLabelsHint')}</p>
    <input type="search" aria-label={t('organizer.searchLabels')} placeholder={t('organizer.searchLabels')} value={search} onChange={e => setSearch(e.target.value)} />
    {!liveTask && <p className="jobu-error" role="alert">{t('organizer.errors.missing')}</p>}
    <div className="ju-label-choices">{choices.map(label => <label key={label.id}><input type="checkbox" checked={selected.has(label.id)} disabled={busy || !liveTask || !o.writable || !o.loaded} onChange={e => toggle(label, e.target.checked, e.currentTarget)} /><span className={`ju-label-dot ju-color-${label.color}`} />{label.name}</label>)}</div>
    {busy && <p role="status" className="ju-muted">{t('organizer.saving')}</p>}
    {!choices.length && <p className="ju-muted">{t('organizer.noLabels')}</p>}
    {error && <p className="jobu-error" role="alert">{t(`organizer.errors.${error}`, { defaultValue: t('organizer.errors.storageWrite') })}</p>}
    <button type="button" disabled={busy} onClick={() => { onClose(); f.setJobuPage('labels'); }}>{t('organizer.manageLabels')}</button>
  </OrganizerDialog>;
}
