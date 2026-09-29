import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Focus, UnfoldVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { RoadmapBar, RoadmapGrid, ROADMAP_ROW_HEIGHT } from '../goals/RoadmapChart.jsx';
import { buildLifeGantt, civilDay, GANTT_PERIODS, ganttGeometry, ganttWindow, shiftGanttMonth } from '../../lifeplanner/gantt.js';
import { localDate } from '../../lifeplanner/model.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import './lifeGantt.css';

/** A second view of the current LifeMap graph, never another task/goal store. */
export default function LifeMapGantt({ graph, nodes, tasks, unscheduledTasks, recurringTasks, goals, projects,
  selectedId, onSelect, onFocus, root, ready, active = true }) {
  const { t, i18n } = useTranslation();
  const G = (key, options) => t(`lifeGantt.${key}`, options);
  const ctx = useDayPlannerCtx();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const [months, setMonths] = useState(12), [anchor, setAnchor] = useState(() => `${localDate().slice(0, 7)}-01`);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const chartRef = useRef(null), [chartW, setChartW] = useState(0);
  const hasRows = graph.nodes.length > 0;
  useEffect(() => {
    if (!active || !chartRef.current) return;
    const element = chartRef.current, update = () => setChartW(element.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }
    const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect();
  }, [active, ready, hasRows]);
  const rows = useMemo(() => buildLifeGantt({ graph, nodes, tasks, unscheduledTasks, recurringTasks, goals, projects, collapsed, root }),
    [graph, nodes, tasks, unscheduledTasks, recurringTasks, goals, projects, collapsed, root]);
  const rangeWindow = ganttWindow(anchor, months);
  const fmt = value => value ? formatLocalizedDate(new Date(`${value}T12:00:00`), { year: 'numeric', month: 'short', day: 'numeric' }, language) : G('unset');
  const labelEvery = months <= 6 ? 1 : months <= 12 ? 2 : months <= 24 ? (chartW && chartW < 700 ? 6 : 3) : (chartW && chartW < 700 ? 12 : 6);
  const today = civilDay(localDate()), todayPct = (today - rangeWindow.left) / (rangeWindow.right - rangeWindow.left) * 100;
  const fold = id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const dates = rows.flatMap(row => [row.schedule.startDate, row.schedule.targetDate]).filter(d => civilDay(d) !== null).sort();
  const overview = () => {
    if (!dates.length) return;
    const start = dates[0], end = dates.at(-1);
    const needed = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
    setAnchor(`${start.slice(0, 7)}-01`); setMonths(GANTT_PERIODS.find(value => value >= needed) || 60);
  };
  return <div className="lg-host" data-life-gantt aria-label={G('title')} hidden={!active}>
    <div className="lg-toolbar">
      <span className={`text-xs ${ctx.textSecondary}`}>{t('goals.range')}</span>
      {GANTT_PERIODS.map(value => <button type="button" key={value} aria-pressed={months === value} onClick={() => setMonths(value)}
        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${months === value ? 'bg-accent-600 text-white'
          : ctx.darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
        {t(value < 12 ? 'goals.rangeMonthsShort' : 'goals.rangeYearsShort', { count: value < 12 ? value : value / 12 })}
      </button>)}
      <span className="lg-nav">
        <button type="button" aria-label={G('previous')} onClick={() => setAnchor(shiftGanttMonth(anchor, -months))}><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setAnchor(`${localDate().slice(0, 7)}-01`)}>{t('common.today')}</button>
        <button type="button" aria-label={G('next')} onClick={() => setAnchor(shiftGanttMonth(anchor, months))}><ChevronRight size={16} /></button>
      </span>
      <button type="button" disabled={!dates.length} onClick={overview}>{G('overview')}</button>
      <button type="button" aria-label={G('expandAll')} disabled={!collapsed.size} onClick={() => setCollapsed(new Set())}><UnfoldVertical size={14} />{G('expandAll')}</button>
    </div>
    <div className={`lg-caption text-xs ${ctx.textSecondary}`}>
      <span>{fmt(rangeWindow.startDate)} — {fmt(new Date((rangeWindow.right - 1) * 86400000).toISOString().slice(0, 10))}</span>
      <span>{G('legend')}</span>
    </div>
    {!ready ? <p className="lg-empty" role="status">{t('lifeBoard.preparing')}</p> : !rows.length
      ? <p className="lg-empty" role="status">{G('empty')}</p>
      : <div className="lg-scroll" tabIndex={0} aria-label={G('scroll')}>
        <div className="lg-table">
          <div className="lg-row lg-scale">
            <span className="lg-name">{G('name')}</span>
            <div className="relative h-full" ref={chartRef}>
              <RoadmapGrid {...rangeWindow} labelEvery={labelEvery} labelsOnly topPad={0} bottomPad={0}
                language={language} timeZone="UTC" yearLabels={months > 12} textSecondary={ctx.textSecondary} darkMode={ctx.darkMode} />
            </div>
          </div>
          <div className="lg-grid" aria-hidden="true">
            <RoadmapGrid {...rangeWindow} labelEvery={labelEvery} showLabels={false} topPad={0} bottomPad={0}
              language={language} timeZone="UTC" yearLabels={months > 12} darkMode={ctx.darkMode} />
            {todayPct >= 0 && todayPct < 100 && <div className="lg-today" style={{ left: `${todayPct}%` }} title={t('common.today')} />}
          </div>
          {rows.map(row => {
            const s = row.schedule, geometry = ganttGeometry(s, rangeWindow);
            const kind = row.kind === 'untyped' ? t('lifeBoard.untyped') : t(`lifeMap.${row.kind}`);
            const source = G(s.summary ? 'summary' : `source.${s.source}`);
            const range = s.invalid ? G('invalidDate') : `${fmt(s.startDate)} → ${fmt(s.targetDate)}`;
            const tooltip = [row.title, kind, range, source, row.extraParents.length ? G('parents', { total: row.extraParents.length }) : null].filter(Boolean).join('\n');
            const pct = Number.isFinite(row.progress) ? new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(row.progress) : null;
            const endLabel = s.targetDate ? fmt(s.targetDate) : G('openEnded');
            return <div key={row.id} className={`lg-row ${selectedId === row.id ? 'lg-selected' : ''}`} data-gantt-row={row.id} style={{ minHeight: ROADMAP_ROW_HEIGHT }}>
              <div className="lg-name" style={{ paddingLeft: 8 + Math.min(row.depth, 8) * 12 }}>
                {row.childCount > 0 ? <button type="button" className="lg-fold" aria-label={`${G(collapsed.has(row.id) ? 'expand' : 'collapse')} · ${row.title}`}
                  aria-expanded={!collapsed.has(row.id)} onClick={() => fold(row.id)}>{collapsed.has(row.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : <span className="lg-fold" />}
                <button type="button" className="lg-title" title={tooltip} onClick={() => onSelect(row.id)}>
                  <span>{row.title || t('lifeBoard.untitled')}</span><small>{kind}{row.extraParents.length ? ` · +${row.extraParents.length}` : ''}</small>
                </button>
                {row.kind !== 'task' && <button type="button" className="lg-focus" aria-label={`${t('lifeBoard.focus')} · ${row.title}`} onClick={() => onFocus(row.id)}><Focus size={13} /></button>}
              </div>
              <div className="lg-cell">
                {geometry ? <RoadmapBar id={row.id} title={row.title || t('lifeBoard.untitled')} color={row.color} {...geometry}
                  summary={s.summary} progress={row.progress} chartW={chartW} darkMode={ctx.darkMode} selected={selectedId === row.id}
                  leftText={row.title} rightText={[endLabel, pct].filter(Boolean).join(' · ')}
                  combinedText={[s.summary ? G('summary') : row.title, endLabel, pct].filter(Boolean).join(' · ')}
                  tooltip={tooltip} onSelect={onSelect} />
                  : <button type="button" className={`lg-no-date ${s.invalid ? 'lg-invalid' : ''}`} onClick={() => {
                    const date = s.startDate || s.targetDate;
                    if (!s.invalid && date) setAnchor(`${date.slice(0, 7)}-01`); else onSelect(row.id);
                  }}>{s.invalid ? G('invalidDate') : s.startDate || s.targetDate ? G('outside') : G('unset')}</button>}
              </div>
            </div>;
          })}
        </div>
      </div>}
  </div>;
}
