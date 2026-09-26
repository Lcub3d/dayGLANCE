import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, FileText, Pencil, X } from 'lucide-react';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { formatDuration } from '../../utils/formatDuration.js';
import { doDurationMinutes } from '../../jobo/core.js';
import { TimingSummary, progressText } from './PlanCard.jsx';

export default function ExecutionDetails({ item, anchor, onClose, onEdit, onNotes, ctx, t, writable, pendingIds = [] }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ top: 80, left: 12 });
  const records = item.attempts || (item.record ? [item.record] : []);
  const title = item.currentTask?.title || item.task?.title || item.record?.title || '';
  useLayoutEffect(() => {
    const positionPanel = () => {
      const box = anchor?.isConnected ? anchor.getBoundingClientRect() : { left: 12, bottom: 80, top: 80 };
      const panel = ref.current.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - panel.width - 12, box.left));
      const below = box.bottom + 6;
      const top = below + panel.height <= window.innerHeight - 12 ? below : Math.max(12, Math.min(box.top - panel.height - 6, window.innerHeight - panel.height - 12));
      setPosition({ left, top });
    };
    positionPanel();
    const observer = new ResizeObserver(positionPanel); observer.observe(ref.current);
    window.addEventListener('resize', positionPanel); window.addEventListener('scroll', positionPanel, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true); };
  }, [anchor]);
  useEffect(() => {
    const previous = anchor || document.activeElement;
    ref.current?.focus();
    const outside = event => { if (!ref.current?.contains(event.target) && !anchor?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); if (previous?.isConnected) previous.focus(); };
  }, [anchor, onClose]);
  const keys = event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const entries = [...ref.current.querySelectorAll('summary')];
    if (!entries.length) return;
    const index = entries.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    event.preventDefault(); entries[next]?.focus();
  };
  return createPortal(<section ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="jobo-execution-title" onKeyDown={keys}
    style={position} className={`jobo-s5-details ${ctx.cardBg} ${ctx.textPrimary} border ${ctx.borderClass}`}>
    <div className="jobo-s5-dialog-head"><div><h2 id="jobo-execution-title" className="jobo-s5-dialog-title">{renderTitleWithoutTags(title)}</h2><p>{t('jobo.view.executionHistory', { count: records.length })}</p></div><button type="button" className="jobo-s5-close-button" aria-label={t('common.close')} onClick={onClose}><X size={18} /></button></div>
    {item.plan && <p className="jobo-s5-detail-plan">{t(item.historical ? 'jobo.view.capturedPlan' : 'jobo.view.plan')}: {item.plan.date} · {ctx.formatTime(item.plan.startTime)} · {formatDuration(item.plan.duration, t)}</p>}
    <TimingSummary comparison={item.comparison} t={t} />
    {item.comparison?.metrics.recordedMinutes != null && <p>{t('jobo.view.measuredMinutes', { minutes: item.comparison.metrics.recordedMinutes })}</p>}
    {item.noteKey && <button type="button" className="jobo-s5-details-notes" onClick={() => { onNotes(item); onClose(); }}><FileText size={14} />{t('jobo.view.locateNotes')}</button>}
    {!records.length && <p className="jobo-s5-detail-empty">{t('jobo.view.noAttempts')}</p>}
    <div className="jobo-s5-attempt-list">{records.map((record, index) => <details key={record.id} open={records.length === 1 ? true : undefined}>
      <summary><span className="jobo-s5-attempt-progress">{index === 0 && <span>{t('jobo.view.latestShort')} · </span>}{progressText(record.progress, t)}</span><span>{record.date} · {record.timing === 'untimed' ? t('jobo.view.untimed') : `${ctx.formatTime(record.startTime)}–${record.endDate !== record.date ? `${record.endDate} ` : ''}${ctx.formatTime(record.endTime)}`}</span></summary>
      <div className="jobo-s5-attempt-body"><p>{record.title}</p><p>{t('jobo.view.sourceLabel')}: {t(`jobo.view.source.${record.source}`, { defaultValue: record.source })}</p>
        {record.timing === 'timed' && <p><Clock size={12} />{formatDuration(doDurationMinutes(record), t)}</p>}
        <p>{t('jobo.view.capturedPlan')}: {record.planSnapshot ? `${record.planSnapshot.date} ${ctx.formatTime(record.planSnapshot.startTime)} · ${formatDuration(record.planSnapshot.duration, t)}` : t('jobo.view.noTimedPlan')}</p>
        {pendingIds.includes(record.id) ? <p role="status">{t('jobo.view.pendingSave')}</p> : writable && <button type="button" className="jobo-s5-details-edit" onClick={() => onEdit({ record })}><Pencil size={13} />{t('common.edit')}</button>}
      </div>
    </details>)}</div>
  </section>, document.body);
}
