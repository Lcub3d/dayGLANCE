import React, { useId, useState } from 'react';
import { CheckSquare, RefreshCw, Link, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import '../todoist/strings.js';

export default function TodoistSettings() {
  const { t: todoistText, i18n } = useTranslation('todoist');
  const { darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const { todoist: sync } = useSyncCtx();
  const [input, setInput] = useState('');
  const id = useId();
  if (!sync) return null;
  const { settings, updateSettings, catalog, selected, status, connected } = sync;
  const busy = status === 'syncing';
  const disabled = busy || sync.multiUserEnabled;
  const fieldClass = `w-full rounded-lg border p-2 text-sm ${borderClass} ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'}`;
  const buttonClass = `rounded-lg border px-3 py-2 text-sm ${borderClass} disabled:opacity-40`;
  const toggle = (field, value) => updateSettings({ [field]: settings[field].includes(value)
    ? settings[field].filter(item => item !== value) : [...settings[field], value] });
  const choices = (resource, chosen) => {
    const result = new Map();
    for (const item of Object.values(catalog?.[resource] || {})) {
      if (item.is_deleted || item.is_archived) continue;
      result.set(resource === 'projects' ? String(item.id) : item.name, item.name);
    }
    for (const value of chosen) if (!result.has(value)) result.set(value, todoistText('missing', { name: value }));
    return [...result].sort((a, b) => a[1].localeCompare(b[1], i18n.resolvedLanguage));
  };
  const checkboxList = field => <fieldset className="space-y-2">
    <legend className="font-medium text-sm">{todoistText(field)}</legend>
    <div className={`max-h-36 overflow-y-auto rounded-lg border ${borderClass} p-2 space-y-1`}>
      {!catalog && <p className={`text-xs ${textSecondary}`}>{todoistText('noCatalog')}</p>}
      {choices(field, settings[field]).map(([value, name]) => <label key={value} className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={settings[field].includes(value)} disabled={disabled}
          onChange={() => toggle(field, value)} className="mt-1" />
        <span className="break-words min-w-0">{name}</span>
      </label>)}
    </div>
  </fieldset>;
  return <section aria-labelledby={`${id}-title`} className={`space-y-4 ${textPrimary}`}>
    <div className="flex items-center gap-2">
      <CheckSquare size={18} className="text-red-500" />
      <h4 id={`${id}-title`} className="font-semibold">{todoistText('title')}</h4>
      <span className={`ml-auto text-xs ${textSecondary}`}>{todoistText('beta')}</span>
    </div>
    <p className={`text-xs leading-relaxed ${textSecondary}`}>{todoistText('intro')}</p>
    {sync.multiUserEnabled && <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">{todoistText('errors.multiUser')}</p>}
    {!connected ? <form className="space-y-2" onSubmit={async event => {
      event.preventDefault(); await sync.connect(input); setInput('');
    }}>
      <label htmlFor={`${id}-token`} className="block text-sm font-medium">{todoistText('token')}</label>
      <input id={`${id}-token`} type="password" value={input} autoComplete="off" spellCheck={false}
        onChange={event => setInput(event.target.value)} disabled={disabled} className={fieldClass} />
      <p className={`text-xs ${textSecondary}`}>{todoistText('tokenHelp')}</p>
      <button type="submit" disabled={disabled || !input.trim()} className={`${buttonClass} inline-flex items-center gap-2`}>
        <Link size={14} />{todoistText('connect')}
      </button>
    </form> : <div className="flex items-center justify-between gap-2">
      <p className="text-sm min-w-0 break-words">{todoistText('account', { name: catalog?.user?.full_name || sync.account })}</p>
      <button type="button" onClick={sync.disconnect} className={`${buttonClass} flex gap-2 items-center shrink-0`}>
        <Unlink size={14} />{todoistText('disconnect')}
      </button>
    </div>}
    <details className={`text-xs ${textSecondary}`}>
      <summary className="cursor-pointer">{todoistText('token')}</summary>
      <p className="mt-2 leading-relaxed">{todoistText('security')}</p>
      <p className="mt-2 leading-relaxed">{todoistText('privacy')}</p>
    </details>
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-medium mb-2">{todoistText('filters')}</legend>
      <div className="flex items-center flex-wrap gap-3">
        <span className="text-sm">{todoistText('priorities')}</span>
        {[1, 2, 3, 4].map(priority => <label key={priority} className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={settings.priorities.includes(priority)} onChange={() => toggle('priorities', priority)} />P{priority}
        </label>)}
      </div>
      {checkboxList('projects')}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.subprojects} onChange={e => updateSettings({ subprojects: e.target.checked })} />{todoistText('subprojects')}
      </label>
      {checkboxList('labels')}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.labelMatch === 'all'} onChange={e => updateSettings({ labelMatch: e.target.checked ? 'all' : 'any' })} />{todoistText('labelAll')}
      </label>
      <select aria-label={todoistText('filters')} className={fieldClass} value={settings.match} onChange={e => updateSettings({ match: e.target.value })}>
        <option value="all">{todoistText('all')}</option><option value="any">{todoistText('any')}</option>
      </select>
      <p className={`text-xs ${textSecondary}`}>{todoistText('ruleHelp')}</p>
    </fieldset>
    {catalog && <div className={`rounded-lg border ${borderClass} p-3 space-y-2`} aria-live="polite">
      <p className="text-sm font-medium">{todoistText('preview', { count: selected.length })}</p>
      {selected.slice(0, 8).map(item => <p className={`text-xs break-words ${textSecondary}`} key={item.id}>
        P{5 - item.priority} · {item.content}{item.due?.date ? ` · ${todoistText('due', { date: item.due.date })}` : ''}
      </p>)}
      {!selected.length && <p className={`text-xs ${textSecondary}`}>{todoistText('empty')}</p>}
    </div>}
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={settings.enabled} disabled={disabled || !connected}
        onChange={e => updateSettings({ enabled: e.target.checked })} />{todoistText('enabled')}
    </label>
    <label className="block text-sm space-y-1">
      <span>{todoistText('interval')}</span>
      <select className={fieldClass} value={settings.intervalMinutes} disabled={disabled}
        onChange={e => updateSettings({ intervalMinutes: Number(e.target.value) })}>
        {[0, 1, 5, 15].map(value => <option value={value} key={value}>{value ? todoistText('minutes', { count: value }) : todoistText('manual')}</option>)}
      </select>
    </label>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={settings.completionWriteback} disabled={disabled}
        onChange={e => updateSettings({ completionWriteback: e.target.checked })} />{todoistText('writeback')}
    </label>
    <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">{todoistText('writeWarning')}</p>
    <p className={`text-xs ${textSecondary}`}>{todoistText('recurring')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !connected} className={buttonClass} onClick={sync.preview}>{todoistText('refresh')}</button>
      <button type="button" disabled={disabled || !connected || !settings.enabled} className={`${buttonClass} flex items-center gap-2`} onClick={sync.syncNow}>
        <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{todoistText('sync')}
      </button>
    </div>
    <div aria-live="polite" className={`space-y-1 text-xs ${textSecondary}`}>
      <p>{todoistText('status')}: {todoistText(status)}</p>
      {sync.lastSynced && <p>{todoistText('last', { date: new Date(sync.lastSynced).toLocaleString(i18n.resolvedLanguage) })}</p>}
      {sync.pending > 0 && <p>{todoistText('pending', { count: sync.pending })}</p>}
      {sync.error && <p role="alert" className="text-red-600 dark:text-red-400">{todoistText(`errors.${sync.error}`, { defaultValue: todoistText('errors.unknown') })}</p>}
    </div>
    {!!sync.blockedWrites.length && <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
      <p>{todoistText('blocked', { count: sync.blockedWrites.length })}</p>
      {sync.blockedWrites.slice(0, 10).map(task => <p key={task.id}>{task.title}</p>)}
    </div>}
    {!!sync.conflicts.length && <div className={`border rounded-lg ${borderClass} p-3 space-y-3`}>
      <p className="text-xs">{todoistText('conflicts')}</p>
      {sync.conflicts.map(task => <div key={task.id} className="space-y-1">
        <p className="text-sm break-words">{task.title}</p>
        {Object.entries(task.todoist.conflicts).map(([field, value]) => <p key={field} className={`text-xs break-words ${textSecondary}`}>
          {field}: {String(task[field] ?? '—')} → {String(value ?? '—')}
        </p>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => sync.resolveConflict(task.id, true)}>{todoistText('remote')}</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => sync.resolveConflict(task.id, false)}>{todoistText('local')}</button>
        </div>
      </div>)}
    </div>}
    <p className={`text-xs leading-relaxed ${textSecondary}`}>{todoistText('safety')}</p>
  </section>;
}
