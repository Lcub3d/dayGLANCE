import React, { useState } from 'react';
import { ArrowLeft, Plus, Pencil, Star, Tag, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { LABEL_COLORS, sourceLabels } from '../../jobu/labels.js';
import { quoteFilterName } from '../../jobu/filters.js';
import { saveLabel } from '../../jobu/organizerStore.js';
import OrganizerDialog from './OrganizerDialog.jsx';
import './organizer.css';

function LabelEditor({ label, onClose }) {
  const f = useFeaturesCtx(), o = f.jobuOrganizer, { t } = useTranslation();
  const [name, setName] = useState(label?.name || ''), [color, setColor] = useState(label?.color || 'charcoal');
  const [favorite, setFavorite] = useState(!!label?.isFavorite), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dirty = name !== (label?.name || '') || color !== (label?.color || 'charcoal') || favorite !== !!label?.isFavorite;
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await saveLabel(f.jobuData, { ...label, name, color, isFavorite: favorite }, { expectedHead: label?.head ?? null, sourceNames: o.entries.flatMap(e => sourceLabels(e.task)) }); onClose(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <OrganizerDialog title={t(label ? 'organizer.editLabel' : 'organizer.newLabel')} onClose={onClose} dirty={dirty} busy={busy}>
    <form onSubmit={submit}>
      <label>{t('organizer.name')}<input value={name} maxLength={128} required onChange={e => setName(e.target.value)} /></label>
      <label>{t('organizer.color')}<select aria-label={t('organizer.color')} value={color} onChange={e => setColor(e.target.value)}>{LABEL_COLORS.map(value => <option key={value} value={value}>{t(`organizer.colors.${value}`)}</option>)}</select></label>
      <label><input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} />{t('organizer.favorite')}</label>
      <p className="ju-muted">{t('organizer.renameHint')}</p>
      {error && <p role="alert" className="jobu-error">{t(`organizer.errors.${error}`, { defaultValue: t('organizer.errors.storageWrite') })}</p>}
      <div className="ju-dialog-actions"><button type="submit" disabled={busy || !o.loaded || !o.writable || !name.trim()} className="jobu-primary">{t(busy ? 'organizer.saving' : 'common.save')}</button></div>
    </form>
  </OrganizerDialog>;
}
export default function LabelsPage({ onClose, headerActions }) {
  const f = useFeaturesCtx(), o = f.jobuOrganizer, { t } = useTranslation();
  const [search, setSearch] = useState(''), [editor, setEditor] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const labels = [...o.labels.definitions.values()].filter(label => !label.deleted && label.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name));
  const deleted = [...o.labels.definitions.values()].filter(label => label.deleted);
  const counts = new Map();
  for (const { task } of o.entries) if (!task.completed) for (const label of o.labels.labelsFor(task)) counts.set(label.id, (counts.get(label.id) || 0) + 1);
  async function change(label, patch = {}, remove = false) {
    if (busy || (remove && !window.confirm(t('organizer.deleteLabelConfirm', { name: label.name })))) return;
    setBusy(label.id); setError('');
    try { await saveLabel(f.jobuData, { ...label, ...patch }, { expectedHead: label.head, deleted: remove, sourceNames: o.entries.flatMap(e => sourceLabels(e.task)) }); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  return <section className="jobu-tasks ju-labels-page">
    <div className="jobu-page-heading"><div><button type="button" className="jobu-task-back" onClick={onClose}><ArrowLeft size={15} />{t('common.back')}</button><h1>{t('organizer.labels')}</h1><p>{t('organizer.localLabelsHint')}</p></div>{headerActions}</div>
    <div className="ju-organizer-tools"><input type="search" aria-label={t('organizer.searchLabels')} placeholder={t('organizer.searchLabels')} value={search} onChange={e => setSearch(e.target.value)} /><button type="button" disabled={!o.loaded || !o.writable} onClick={() => setEditor({ label: null })}><Plus size={15} />{t('organizer.newLabel')}</button></div>
    {!!o.labels.conflicts?.length && <p role="alert" className="jobu-warning">{t('organizer.aliasConflict')}</p>}
    {!o.loaded ? <p>{t('jobu.loading')}</p> : <div className="ju-label-catalog">{labels.map(label => <article className="ju-label-row" key={label.id}>
      <button type="button" className="ju-label-open" onClick={() => f.openJobuFilter(`%${quoteFilterName(label.name)}`, label.name)}><Tag size={16} className={`ju-color-${label.color}`} /><span>{label.name}</span><b>{counts.get(label.id) || 0}</b></button>
      <button type="button" aria-label={`${t('organizer.favorite')}: ${label.name}`} aria-pressed={label.isFavorite} disabled={!o.writable || !!busy} onClick={() => change(label, { isFavorite: !label.isFavorite })}><Star size={15} fill={label.isFavorite ? 'currentColor' : 'none'} /></button>
      <button type="button" aria-label={`${t('organizer.editLabel')}: ${label.name}`} disabled={!o.writable || !!busy} onClick={() => setEditor({ label })}><Pencil size={15} /></button>
      <button type="button" aria-label={`${t('common.delete')}: ${label.name}`} disabled={!o.writable || !!busy} onClick={() => change(label, {}, true)}><Trash2 size={15} /></button>
    </article>)}{!labels.length && <p className="ju-muted">{t('organizer.noLabels')}</p>}</div>}
    {!!deleted.length && <details className="ju-deleted-labels"><summary>{t('organizer.deletedLabels')}</summary>{deleted.map(label => <div className="ju-label-row" key={label.id}><span>{label.name}</span><button type="button" disabled={!o.writable || !!busy} onClick={() => change(label)}>{t('organizer.restoreLabel')}</button></div>)}</details>}
    {error && <p className="jobu-error" role="alert">{t(`organizer.errors.${error}`, { defaultValue: t('organizer.errors.storageWrite') })}</p>}
    {editor && <LabelEditor {...editor} onClose={() => setEditor(null)} />}
  </section>;
}
