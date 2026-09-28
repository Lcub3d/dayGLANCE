import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { compileJobuFilter, quoteFilterName } from '../../jobu/filters.js';
import { savePersonalFilter } from '../../jobu/organizerStore.js';
import OrganizerDialog from './OrganizerDialog.jsx';

export function filterError(t, filter) {
  return `${t(`organizer.errors.${filter.error || 'filter'}`)}${filter.errorToken ? ` — ${filter.errorToken}` : ''}`;
}
export default function FilterEditor({ row = null, template = null, query: initialQuery = 'today', onClose, onSaved }) {
  const f = useFeaturesCtx(), o = f.jobuOrganizer, { t } = useTranslation();
  const original = row?.value || template || { name: '', query: initialQuery };
  const [name, setName] = useState(original.name), [query, setQuery] = useState(original.query);
  const [favorite, setFavorite] = useState(!!original.isFavorite), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('today'), [argument, setArgument] = useState(''), [join, setJoin] = useState('&');
  const filter = useMemo(() => compileJobuFilter(query, o.options), [query, o.options]);
  const count = o.entries.filter(e => filter.test(e.task)).length;
  const dirty = name !== original.name || query !== original.query || favorite !== !!original.isFavorite;
  function addCondition() {
    let atom = kind;
    if (kind === 'label') atom = `%${quoteFilterName(argument)}`;
    else if (kind === 'project') atom = `#${quoteFilterName(argument)}`;
    else if (kind === 'search') atom = `search: ${quoteFilterName(argument)}`;
    else if (kind === 'hours') atom = `due before: +${argument} hours`;
    else if (kind === 'date') atom = `date: ${argument}`;
    if (['label','project','search','hours','date'].includes(kind) && !argument.trim()) return;
    if (join === '!') atom = `!(${atom})`;
    setQuery(current => {
      if (!current.trim()) return atom;
      if (join === ',') return `${current}, ${atom}`;
      const sections = compileJobuFilter(current, o.options);
      if (sections.error) return current;
      const queries = sections.sections.map(section => section.query);
      queries[queries.length - 1] = `(${queries.at(-1)}) ${join === '!' ? '&' : join} (${atom})`;
      return queries.join(', ');
    });
  }
  async function save(event) {
    event.preventDefault(); if (busy || filter.error || !name.trim()) return;
    setBusy(true); setError('');
    try {
      await savePersonalFilter(f.jobuData, { ...original, ...(template ? { templateId: template.id, builtin: false } : {}), name, query, isFavorite: favorite }, { entityId: row?.entityId, expectedHead: row?.id ?? null });
      onSaved?.({ name: name.trim(), query }); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <OrganizerDialog title={t(row ? 'organizer.editFilter' : 'organizer.newFilter')} onClose={onClose} dirty={dirty} busy={busy}>
    <form onSubmit={save}>
      <label>{t('organizer.name')}<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} /></label>
      <label className="ju-stacked">{t('organizer.query')}<textarea value={query} maxLength={2000} required rows={3} spellCheck={false} onChange={e => setQuery(e.target.value)} /></label>
      <details className="ju-condition-builder"><summary>{t('organizer.addCondition')}</summary>
        <div className="ju-condition-row"><select aria-label={t('organizer.condition')} value={kind} onChange={e => { setKind(e.target.value); setArgument(''); }}>
          {['today','overdue','no date','no time','no label','p1','p2','p3','p4','recurring','subtask','label','project','search','hours','date'].map(key => <option key={key} value={key}>{t(`organizer.conditions.${key.replaceAll(' ', '_')}`)}</option>)}
        </select>
        {kind === 'label' || kind === 'project' ? <select aria-label={t('organizer.value')} value={argument} onChange={e => setArgument(e.target.value)}><option value="">{t('organizer.choose')}</option>
          {(kind === 'label' ? [...o.labels.definitions.values()].filter(x => !x.deleted).map(x => x.name) : [...new Set(o.options.projects.filter(p => !p.deleted && !p.archived).map(p => p.title))]).map(value => <option key={value}>{value}</option>)}
        </select> : ['hours','date','search'].includes(kind) && <input aria-label={t('organizer.value')} type={kind === 'hours' ? 'number' : kind === 'date' ? 'date' : 'text'} min={kind === 'hours' ? 0 : undefined} value={argument} onChange={e => setArgument(e.target.value)} />}
        <select aria-label={t('organizer.operator')} value={join} onChange={e => setJoin(e.target.value)}>{['&','|','!',','].map(value => <option key={value} value={value}>{t(`organizer.operators.${value === '&' ? 'and' : value === '|' ? 'or' : value === '!' ? 'not' : 'section'}`)}</option>)}</select>
        <button type="button" onClick={addCondition}>{t('common.add')}</button></div>
      </details>
      <p className="ju-muted">{t('organizer.syntax')}</p>
      <p aria-live="polite" className={filter.error ? 'jobu-error' : 'ju-muted'}>{filter.error ? filterError(t, filter) : t('organizer.preview', { count, groups: filter.sections.length })}</p>
      <label><input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} />{t('organizer.favorite')}</label>
      {error && <p role="alert" className="jobu-error">{t(`organizer.errors.${error}`, { defaultValue: t('organizer.errors.storageWrite') })}</p>}
      <div className="ju-dialog-actions"><button type="submit" className="jobu-primary" disabled={busy || !o.writable || !o.loaded || !!filter.error || !name.trim()}>{t(busy ? 'organizer.saving' : 'common.save')}</button></div>
    </form>
  </OrganizerDialog>;
}
