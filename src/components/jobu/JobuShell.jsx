import React, { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeaturesContext, useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { restorePlanningRevision } from '../../jobu/lifeNodeStore.js';
import { dayKey } from '../../jobu/year.js';
import './jobu.css';

const TasksView = lazy(() => import('./TasksView.jsx'));

export default function JobuShell({ children }) {
  const f = useFeaturesCtx(), ctx = useDayPlannerCtx(), { t } = useTranslation();
  const [page, setPage] = useState('calendar');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [entity, setEntity] = useState('');
  const file = useRef(null);
  const navigationGuard = useRef(null);
  const registerJobuNavigationGuard = useCallback(guard => {
    navigationGuard.current = guard;
    return () => {
      if (navigationGuard.current === guard) navigationGuard.current = null;
    };
  }, []);

  // CalendarHeader owns all timeline views. This shell only opens the task
  // list; it no longer has a second, competing Plan/Do or year-view route.
  const select = next => {
    if (next !== page && navigationGuard.current && !navigationGuard.current()) return;
    if (next === 'tasks') { setPage('tasks'); return; }
    if (next === 'jobo' || next === 'year' || next === 'year2') {
      if (next === 'jobo') f.setJoboEnabled(true);
      ctx.setViewMode(next);
    }
    setPage('calendar');
  };
  const personal = { ...f, registerJobuNavigationGuard, setJobuPage: select };
  const exportData = () => {
    try {
      const blob = new Blob([f.jobuData.export()], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `jobu-personal-${dayKey(new Date())}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
  };
  const importData = async e => {
    const input = e.target, uploaded = input.files?.[0];
    if (!uploaded) return;
    try {
      if (uploaded.size > 50000000) throw Error('file too large');
      const data = JSON.parse(await uploaded.text());
      if (data.format !== 'jobu-personal' || data.version !== 1) throw Error('format');
      if (window.confirm(t('jobu.importConfirm'))) await f.jobuData.restore(data.records);
    } catch (err) { setError(err.message); }
    finally { input.value = ''; }
  };
  const entities = [...new Set((f.jobuRecords || []).map(row => row.entityId))];
  const revisions = (f.jobuRecords || []).filter(row => row.entityId === entity).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const dataActions = <details className="jobu-data-menu">
    <summary aria-label={t('jobu.dataActions')} title={t('jobu.dataActions')}><MoreHorizontal size={20} /></summary>
    <div>
      <button onClick={exportData} disabled={!f.jobuLoaded}>{t('jobu.backup')}</button>
      <button onClick={() => file.current?.click()}>{t('jobu.import')}</button>
      <button onClick={() => setHistory(true)}>{t('jobu.history')}</button>
    </div>
  </details>;

  return <FeaturesContext.Provider value={personal}>
    <div className={`jobu-shell ${ctx.darkMode ? 'jobu-dark' : ''}`} onKeyDown={e => {
      if (page === 'tasks') {
        e.stopPropagation();
        if (e.key === 'Escape' && !e.target.closest('input,textarea,select,[contenteditable="true"]')) setPage('calendar');
      } else if (e.target.closest('input,textarea,select,[contenteditable="true"]')) e.stopPropagation();
    }}>
      <input ref={file} type="file" accept="application/json" hidden onChange={importData} />
      {(f.jobuError || error) && <div className="jobu-global-error" role="alert">{t('jobu.saveError')}: {error || f.jobuError} <button onClick={() => { setError(''); f.jobuData.load(); }}>{t('jobu.retry')}</button></div>}
      {f.multiUserEnabled && <p className="jobu-global-error">{t('jobu.personalOnly')}</p>}
      {(f.lifeNodesError || f.lifeNodesPending > 0) && <div className="jobu-global-error" role="status">
        {f.lifeNodesError ? t('lifeBoard.nativeSaveError', { code: f.lifeNodesError }) : t('lifeBoard.saving')}
        {f.lifeNodesError && <><button onClick={f.retryLifeNodes}>{t('jobu.retry')}</button>
          {f.lifeNodesReady && <button onClick={() => { if (window.confirm(t('lifeBoard.discard'))) f.discardLifeNodeWrites(); }}>{t('lifeBoard.discardAction')}</button>}</>}
      </div>}
      <div className="jobu-content">
        <Suspense fallback={<p>{t('jobu.loading')}</p>}>
          {page === 'tasks'
            ? <TasksView onClose={() => setPage('calendar')} headerActions={dataActions} />
            : <div className="jobu-native">{children}</div>}
        </Suspense>
      </div>
      {history && <div className="jobu-dialog-backdrop" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setHistory(false); }}>
        <div className="jobu-dialog" role="dialog" aria-modal="true" aria-label={t('jobu.history')}>
          <h2>{t('jobu.history')}</h2><p>{t('jobu.historyHint')}</p>
          <select aria-label={t('jobu.entity')} value={entity} onChange={e => setEntity(e.target.value)}><option value="">{t('jobu.entity')}</option>{entities.map(id => <option key={id}>{id}</option>)}</select>
          {revisions.map(row => <details key={row.id}><summary>{row.updatedAt} {row.deleted ? '×' : ''}</summary><pre>{JSON.stringify(row.value, null, 2)}</pre><button disabled={!f.jobuWritable || row.kind === 'lifeNodeSchema' || (f.lifeNodesReady && row.kind === 'lifeWish')} title={f.lifeNodesReady && row.kind === 'lifeWish' ? t('lifeBoard.legacyHistory') : undefined} onClick={async () => {
            try { await restorePlanningRevision(f.jobuData, row); setHistory(false); }
            catch (e) { setError(e.message); }
          }}>{t('jobu.restoreRevision')}</button></details>)}
          <button onClick={() => setHistory(false)}>{t('jobu.close')}</button>
        </div>
      </div>}
    </div>
  </FeaturesContext.Provider>;
}
