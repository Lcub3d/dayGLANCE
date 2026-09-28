import React, { useState } from 'react';
import { Filter, Plus, Pencil, Trash2, Tag, Star, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { FILTER_TEMPLATES } from '../../jobu/filterTemplates.js';
import { compileJobuFilter } from '../../jobu/filters.js';
import { savePersonalFilter } from '../../jobu/organizerStore.js';
import FilterEditor, { filterError } from './FilterEditor.jsx';
import './organizer.css';

export function FiltersTab({ active, onClick }) {
  const f = useFeaturesCtx(), { t } = useTranslation();
  return f?.setJobuPage ? <button type="button" data-jobu-filters-tab onClick={onClick} aria-pressed={active} className={`ju-filters-tab ${active ? 'active' : ''}`}><Filter size={15} />{t('organizer.filters')}</button> : null;
}
export function LabelsEntry() {
  const f = useFeaturesCtx(), { t } = useTranslation();
  return f?.setJobuPage ? <button type="button" data-jobu-labels-entry className="ju-labels-entry" onClick={() => f.setJobuPage('labels')}><Tag size={15} />{t('organizer.labels')}</button> : null;
}
export default function FilterSidebar({ compact = false, onSelect }) {
  const f = useFeaturesCtx(), o = f?.jobuOrganizer, { t } = useTranslation();
  const [editor, setEditor] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState('');
  if (!o) return null;
  const select = value => onSelect ? onSelect(value.query, value.name) : f.openJobuFilter(value.query, value.name);
  async function remove(row) {
    if (!window.confirm(t('organizer.deleteFilterConfirm', { name: row.value.name }))) return;
    setPending(row.entityId); setError('');
    try { await savePersonalFilter(f.jobuData, row.value, { entityId: row.entityId, expectedHead: row.id, deleted: true }); }
    catch (e) { setError(e.message); } finally { setPending(''); }
  }
  const item = (value, id, row, template) => {
    const compiled = compileJobuFilter(value.query, o.options);
    const count = !o.loaded ? '…' : compiled.error ? '!' : o.entries.filter(e => compiled.test(e.task)).length;
    return <div className="ju-filter-row" key={id}>
      <button type="button" className="ju-filter-select" onClick={() => select(value)} title={compiled.error ? filterError(t, compiled) : value.query}>
        {value.isFavorite ? <Star size={13} /> : <Filter size={13} />}<span>{value.name}</span><b>{count}</b>
      </button>
      <button type="button" className="ju-icon-button" aria-label={`${t(row ? 'organizer.editFilter' : 'organizer.useTemplate')}: ${value.name}`} title={t(row ? 'organizer.editFilter' : 'organizer.useTemplate')} disabled={!o.loaded || !o.writable} onClick={() => setEditor(row ? { row } : { template })}>{row ? <Pencil size={13} /> : <Copy size={13} />}</button>
      {row && <button type="button" className="ju-icon-button" aria-label={`${t('common.delete')}: ${value.name}`} disabled={!o.writable || !!pending} onClick={() => remove(row)}><Trash2 size={13} /></button>}
    </div>;
  };
  return <aside className={`ju-filter-sidebar ${compact ? 'compact' : ''}`} aria-label={t('organizer.filters')}>
    <div className="ju-organizer-heading"><h2>{t('organizer.filters')}</h2><button type="button" className="ju-icon-button" aria-label={t('organizer.newFilter')} disabled={!o.loaded || !o.writable} onClick={() => setEditor({})}><Plus size={17} /></button></div>
    <h3>{t('organizer.personal')}</h3>
    {o.filters.map(row => item(row.value, row.entityId, row))}
    {!o.loaded ? <p className="ju-muted">{t('jobu.loading')}</p> : !o.filters.length && <p className="ju-muted">{t('organizer.noPersonal')}</p>}
    <h3>{t('organizer.templates')}</h3><p className="ju-muted">{t('organizer.templateHint')}</p>
    {FILTER_TEMPLATES.map(template => item(template, template.id, null, template))}
    <LabelsEntry />
    {error && <p className="jobu-error" role="alert">{t(`organizer.errors.${error}`, { defaultValue: t('organizer.errors.storageWrite') })}</p>}
    {editor && <FilterEditor {...editor} onClose={() => setEditor(null)} />}
  </aside>;
}
