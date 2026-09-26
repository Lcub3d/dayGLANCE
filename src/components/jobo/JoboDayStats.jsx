import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Clock, LogIn, LogOut, Hourglass, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildJoboDaySummary } from '../../jobo/daySummary.js';
import { formatDuration } from '../../utils/formatDuration.js';
import './JoboDayStats.css';

export function DayStatsDetails({ stats, t, ctx, pendingCount, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const { evidence: e, comparison: c } = stats;
  const duration = value => value === null ? '—' : formatDuration(value, t);
  const keys = event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const controls = [...ref.current.querySelectorAll('button:not(:disabled),summary')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return createPortal(<div className="jobo-s5-modal-mask" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="jobo-daily-heading" onKeyDown={keys}
      className={`jobo-day-details ${ctx.cardBg} ${ctx.textPrimary} border ${ctx.borderClass}`}>
      <div className="jobo-s5-dialog-head"><h2 id="jobo-daily-heading">{t('jobo.daily.title')} · {stats.date}</h2><button type="button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button></div>
      <p className={ctx.textSecondary}>{t('jobo.daily.scope')}</p>
      {pendingCount > 0 && <p role="status">{t('jobo.daily.pending', { count: pendingCount })}</p>}
      <dl className="jobo-day-facts">
        <div><dt>{t('jobo.daily.native')}</dt><dd>{stats.native.completed} / {stats.native.total}</dd></div>
        <div><dt>{t('jobo.daily.planned')}</dt><dd>{duration(stats.native.plannedMinutes)}</dd></div>
        <div><dt>{t('jobo.daily.recorded')}</dt><dd>{duration(e?.recordedMinutes ?? null)}</dd></div>
        <div><dt>{t('jobo.daily.untimed')}</dt><dd>{e?.untimedCount ?? '—'}</dd></div>
        {!!e?.inferredCount && <div><dt>{t('jobo.daily.inferred')}</dt><dd>{e.inferredCount}</dd></div>}
        <div><dt>{t('jobo.daily.records')}</dt><dd>{e?.recordCount ?? '—'}</dd></div>
        <div><dt>{t('jobo.daily.overlap')}</dt><dd>{duration(e?.overlapMinutes ?? null)}</dd></div>
        <div><dt>{t('jobo.daily.noPlan')}</dt><dd>{e?.noTimedPlanCount ?? '—'}</dd></div>
        <div><dt>{t('jobo.daily.multiple')}</dt><dd>{c?.multipleRecordGroups ?? '—'}</dd></div>
      </dl>
      {!stats.available && <p role="status">{t('jobo.daily.unavailable')}</p>}
      {!!e?.invalidCount && <p role="status">{t('jobo.view.invalidRecords', { count: e.invalidCount })}</p>}
      <h3>{t('jobo.daily.compare')}</h3>
      <p className={ctx.textSecondary}>{t('jobo.daily.comparisonScope')}</p>
      <p>{t('jobo.daily.denominator', { count: c?.comparableCount ?? '—', total: c?.groupCount ?? '—' })}{!!c?.untimedGroupCount && ` · ${t('jobo.daily.incompleteGroups', { count: c.untimedGroupCount })}`}</p>
      <table className="jobo-day-table"><thead><tr><th>{t('jobo.daily.dimension')}</th><th>{t('jobo.daily.earlyShorter')}</th><th>{t('jobo.daily.onTimeEstimate')}</th><th>{t('jobo.daily.lateLonger')}</th></tr></thead>
        <tbody>{['start', 'finish', 'duration'].map(dimension => <tr key={dimension}><th>{t(`jobo.daily.${dimension}`)}</th>{Object.values(c?.[dimension] || { a: 0, b: 0, c: 0 }).map((value, index) => <td key={index}>{c?.clean && c.comparableCount > 0 ? value : '—'}</td>)}</tr>)}</tbody>
      </table>
      <p className={ctx.textSecondary}>{t('jobo.daily.independent')}</p>
      {!!c?.groups.length && <details><summary>{t('jobo.daily.groupDetails')}</summary><table className="jobo-day-table"><thead><tr><th>{t('task.title')}</th><th>{t('jobo.daily.start')}</th><th>{t('jobo.daily.finish')}</th><th>{t('jobo.daily.duration')}</th></tr></thead><tbody>
        {c.groups.map(group => <tr key={group.id}><th>{group.title}</th>{[group.startOffset, group.finishOffset, group.durationDifference].map((value, index) => <td key={index}>{t('jobo.daily.signedMinutes', { value: `${value > 0 ? '+' : ''}${value}` })}</td>)}</tr>)}
      </tbody></table></details>}
      {!!e?.recordCount && <details><summary>{t('jobo.daily.attemptProgress')}</summary><p>{t('jobo.daily.progressScope')}</p><dl className="jobo-day-facts">{Object.entries(e.progress).map(([key, count]) => <div key={key}><dt>{t(key === 'completed' ? 'common.completed' : `jobo.view.progress.${key}`)}</dt><dd>{count}</dd></div>)}</dl></details>}
    </section>
  </div>, document.body);
}

/** MonthStats-style header tiles, but with JOBO's measured-evidence semantics. */
export default function JoboDayStats({ date, tasks, records, loaded, taskLookup, recurringTasks, isVisibleForUser, pendingCount = 0, ctx, className = '' }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const stats = useMemo(() => buildJoboDaySummary({ date, tasks, records, loaded, taskLookup, recurringTasks, isVisibleForUser }), [date, tasks, records, loaded, taskLookup, recurringTasks, isVisibleForUser]);
  if (!stats) return null;
  const duration = value => value === null ? '—' : formatDuration(value, t);
  const c = stats.comparison, e = stats.evidence;
  const denominator = c?.comparableCount;
  const hasComparisons = c?.clean && denominator > 0;
  const percentage = stats.native.percent === null ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(stats.native.percent / 100);
  const label = `text-[10px] leading-none whitespace-nowrap flex items-center gap-1 ${ctx.textSecondary}`;
  const value = `text-sm font-semibold leading-tight tabular-nums whitespace-nowrap ${ctx.textPrimary}`;
  const sub = `text-[11px] font-normal ${ctx.textSecondary}`;
  const tile = (key, Icon, title, content, secondary, tone) => <button key={key} type="button" data-jobo-daily-tile={key} className={`jobo-day-tile border-l ${ctx.borderClass}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`${title}: ${typeof content === 'string' ? content : ''} ${t('jobo.daily.details')}`}>
    <span className={label}><Icon size={10} className={tone} aria-hidden="true" />{title}</span><span className={value}>{content}</span><span className={sub}>{secondary}</span>
  </button>;
  const dimensions = [
    ['start', LogIn, 'lateStart', 'text-amber-500', 'early', 'onTime'],
    ['finish', LogOut, 'lateFinish', 'text-orange-400', 'early', 'onTime'],
    ['duration', Hourglass, 'longer', 'text-purple-400', 'shorter', 'onEstimate'],
  ];
  return <>
    <div data-jobo-day-stats data-recorded-minutes={e?.recordedMinutes ?? ''} data-comparable-groups={denominator ?? ''} className={`jobo-day-stats ${className}`}>
      {tile('native', CheckCircle, t('jobo.daily.native'), `${stats.native.completed} / ${stats.native.total}`,
        <span className="jobo-day-percent">{percentage}<span className="jobo-day-track" aria-hidden="true"><span style={{ width: `${stats.native.percent ?? 0}%` }} /></span></span>, 'text-green-500')}
      {tile('time', Clock, t('jobo.daily.recorded'), duration(e?.recordedMinutes ?? null), <>{t('jobo.daily.planShort', { time: duration(stats.native.plannedMinutes) })}{e?.untimedCount ? ` · ${t('jobo.daily.untimedShort', { count: e.untimedCount })}` : ''}{pendingCount ? ' *' : ''}</>, 'text-orange-400')}
      {dimensions.map(([dimension, Icon, title, tone, early, onTime]) => tile(dimension, Icon, t(`jobo.daily.${title}`),
        hasComparisons ? `${c[dimension][dimension === 'duration' ? 'longer' : 'late']} / ${denominator}` : '—',
        hasComparisons ? t(dimension === 'duration' ? 'jobo.daily.durationSub' : 'jobo.daily.timingSub', { early: c[dimension][early], onTime: c[dimension][onTime] }) : t(stats.available ? 'jobo.daily.noComparable' : 'jobo.daily.unavailable'), tone))}
    </div>
    {open && <DayStatsDetails stats={stats} t={t} ctx={ctx} pendingCount={pendingCount} onClose={() => setOpen(false)} />}
  </>;
}
