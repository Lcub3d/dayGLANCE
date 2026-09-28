import React from 'react';
import { Download, Minus, MoreHorizontal, Plus, Save, Undo2 } from 'lucide-react';
import { useSyncCtx } from '../../context/SyncContext.jsx';

export default function JoboTools({ ctx, t, scale, setScale, minScale, maxScale, defaultScale }) {
  const sync = useSyncCtx();
  return <div className="jobo-s5-tools jobo-note-tools">
    <button type="button" onClick={() => setScale(value => Math.max(minScale, value - 8))} aria-label={t('jobo.view.zoomOut')} disabled={scale <= minScale}><Minus size={14} /></button>
    <button type="button" onClick={() => setScale(defaultScale)} aria-label={t('jobo.view.resetZoom')}>{Math.round(scale / defaultScale * 100)}%</button>
    <button type="button" onClick={() => setScale(value => Math.min(maxScale, value + 8))} aria-label={t('jobo.view.zoomIn')} disabled={scale >= maxScale}><Plus size={14} /></button>
    <details className="jobo-note-menu"><summary aria-label={t('jobo.view.noteTools')} title={t('jobo.view.noteTools')}><MoreHorizontal size={18} /></summary>
      <div className={`${ctx.cardBg} ${ctx.borderClass} border`} onClick={event => event.currentTarget.parentElement.removeAttribute('open')}>
        <button type="button" onClick={() => ctx.performUndo?.()}><Undo2 size={14} />{t('jobo.view.undoTasks')}</button>
        <button type="button" onClick={() => sync?.exportBackup?.()}><Download size={14} />{t('jobo.view.exportBackup')}</button>
        <button type="button" onClick={() => sync?.setShowBackupMenu?.(true)}><Save size={14} />{t('backup.title')}</button>
      </div>
    </details>
  </div>;
}
