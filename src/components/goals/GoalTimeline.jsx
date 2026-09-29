import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import { RoadmapBar, RoadmapGrid } from './RoadmapChart.jsx';
import { calculateGoalProgress } from '../../utils/goalProgress.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';

/** Native grouping/date policy; chart primitives are shared with LifeMap. */
const toHex = bgClass => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

const PERIODS = [
  { key: '1m', months: 1 },
  { key: '3m', months: 3 },
  { key: '6m', months: 6 },
  { key: '1y', months: 12 },
  { key: '2y', months: 24 },
];

const TOP_PAD = 12;     // space above the first row
const BOTTOM_PAD = 30;  // space for the month labels below the last row
const HEADER_H = 30;    // area group header height (px)

const goalStartMs = (goal) => {
  if (goal.startDate) return new Date(goal.startDate + 'T00:00:00').getTime();
  if (goal.createdAt) return new Date(goal.createdAt).getTime();
  return null;
};
const goalEndMs = (goal) => (goal.targetDate ? new Date(goal.targetDate + 'T00:00:00').getTime() : null);

/**
 * Temporal (Gantt/roadmap) view of goals grouped by Area. Each goal is a bar
 * from its start → target date: the remaining portion is a light tint of the
 * goal's colour and the completed portion is the full swatch colour (a fuel
 * gauge). Labels ride in darker pills so they stay legible on any bar. The left
 * edge is fixed at the current month; the period selector zooms out (1M–2Y).
 */
const GoalTimeline = ({ goals, projects, areas = [], selectedGoalId, onSelectGoal }) => {
  const { darkMode, textPrimary, textSecondary, tasks, unscheduledTasks, isMobile } = useDayPlannerCtx();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const [periodKey, setPeriodKey] = useState('6m');
  const period = PERIODS.find(p => p.key === periodKey) || PERIODS[2];

  const chartRef = useRef(null);
  const [chartW, setChartW] = useState(0);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allTasks = useMemo(() => [...(tasks || []), ...(unscheduledTasks || [])], [tasks, unscheduledTasks]);

  const { leftEdge, span, monthTicks, nowYear } = useMemo(() => {
    const now = new Date();
    const left = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const right = new Date(now.getFullYear(), now.getMonth() + period.months, 1, 0, 0, 0, 0);
    const ticks = [];
    for (let i = 0; i <= period.months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      ticks.push({ ms: d.getTime(), month: d.getMonth(), year: d.getFullYear() });
    }
    return { leftEdge: left.getTime(), span: right.getTime() - left.getTime(), monthTicks: ticks, nowYear: now.getFullYear() };
  }, [period.months]);

  const frac = (ms) => Math.max(0, Math.min(1, (ms - leftEdge) / span));
  const rightEdgeMs = leftEdge + span;

  let labelEvery;
  if (period.months <= 6) labelEvery = 1;
  else if (period.months <= 12) labelEvery = isMobile ? 2 : 1;
  else labelEvery = isMobile ? 4 : 3;

  // Short date like "Dec 20", adding the year only when it isn't the current one.
  const fmtDate = (ymd) => {
    const d = new Date(ymd + 'T00:00:00');
    return formatLocalizedDate(d, {
      month: 'short', day: 'numeric',
      ...(d.getFullYear() !== nowYear ? { year: 'numeric' } : {}),
    }, language);
  };
  const daysLabel = (goal) => {
    if (!goal.targetDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((new Date(goal.targetDate + 'T00:00:00') - today) / 86400000);
    if (diff === 0) return t('goals.dueToday');
    if (diff < 0) return t('goals.daysOverdue', { count: Math.abs(diff) });
    return t('goals.daysLeft', { count: diff });
  };

  // Per-goal geometry + metadata, in-range only, sorted by start.
  const rows = useMemo(() => {
    const built = [];
    for (const goal of goals) {
      const startMs = goalStartMs(goal);
      const endMs = goalEndMs(goal);
      const effectiveStart = startMs == null ? leftEdge : startMs;
      const openEnded = endMs == null;
      const intersects = openEnded
        ? effectiveStart <= rightEdgeMs
        : effectiveStart <= rightEdgeMs && endMs >= leftEdge;
      if (!intersects) continue;
      const sPct = frac(Math.min(effectiveStart, rightEdgeMs)) * 100;
      const ePct = (openEnded ? 1 : frac(endMs)) * 100;
      built.push({
        goal,
        leftPct: sPct,
        widthPct: Math.max(ePct - sPct, 1.2),
        clippedLeft: startMs != null && startMs < leftEdge,
        clippedRight: !openEnded && endMs > rightEdgeMs,
        openEnded,
        progress: calculateGoalProgress(goal.id, projects, allTasks),
        projCount: projects.filter(p => p.goalId === goal.id && p.status !== 'archived').length,
      });
    }
    return built.sort((a, b) => (goalStartMs(a.goal) ?? leftEdge) - (goalStartMs(b.goal) ?? leftEdge));
  }, [goals, projects, allTasks, leftEdge, span]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group rows by area (ordered), with an unassigned group last.
  const groups = useMemo(() => {
    const sortedAreas = [...areas].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const byArea = new Map();
    const noArea = [];
    for (const r of rows) {
      const aid = r.goal.areaId;
      const area = aid && sortedAreas.find(a => a.id === aid);
      if (area) { if (!byArea.has(aid)) byArea.set(aid, []); byArea.get(aid).push(r); }
      else noArea.push(r);
    }
    const gs = [];
    for (const a of sortedAreas) { const rs = byArea.get(a.id); if (rs && rs.length) gs.push({ area: a, rows: rs }); }
    if (noArea.length) gs.push({ area: null, rows: noArea });
    return gs;
  }, [rows, areas]);

  const hiddenCount = goals.length - rows.length;

  const renderBar = (row) => {
    const { goal, leftPct, widthPct, clippedLeft, clippedRight, openEnded, progress, projCount } = row;
    const selected = goal.id === selectedGoalId;
    const pct = Math.round(progress * 100);

    const dLabel = daysLabel(goal);
    const projLabel = t('goals.projectCount', { count: projCount });
    const endLabel = openEnded ? null : (goal.targetDate ? fmtDate(goal.targetDate) : null);
    const pctLabel = `${pct}%`;

    const leftText = [goal.title, dLabel, projLabel].filter(Boolean).join('  ·  ');
    const rightText = [endLabel, pctLabel].filter(Boolean).join('  ·  ');
    const combinedText = openEnded
      ? [goal.title, projLabel, pctLabel].filter(Boolean).join('  ·  ')
      : [leftText, rightText].filter(Boolean).join('  ·  ');

    const tooltip = [
      goal.title,
      goal.startDate ? `${t('goals.start')}: ${fmtDate(goal.startDate)}` : null,
      goal.targetDate ? `${t('goals.target')}: ${fmtDate(goal.targetDate)}` : t('goals.noTarget'),
      dLabel,
      projLabel,
      t('goals.completePct', { pct }),
    ].filter(Boolean).join('\n');

    return <RoadmapBar key={goal.id} id={goal.id} title={goal.title} color={goal.color}
      leftPct={leftPct} widthPct={widthPct} clippedLeft={clippedLeft} clippedRight={clippedRight}
      openEnded={openEnded} progress={progress} chartW={chartW} darkMode={darkMode}
      selected={selected} dimmed={!!selectedGoalId && !selected}
      leftText={leftText} rightText={rightText} combinedText={combinedText} tooltip={tooltip} onSelect={onSelectGoal} />;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Period selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-xs font-medium ${textSecondary} mr-1`}>{t('goals.range')}</span>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodKey(p.key)}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
              p.key === periodKey
                ? 'bg-accent-600 text-white'
                : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {t(p.months < 12 ? 'goals.rangeMonthsShort' : 'goals.rangeYearsShort', {
              count: p.months < 12 ? p.months : p.months / 12,
            })}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className={`text-sm ${textSecondary} opacity-60 py-8 text-center`}>
          {t('goals.noGoalsInRange')}
        </div>
      ) : (
        <div ref={chartRef} className="relative w-full">
          {/* Month gridlines + labels (behind the bars) */}
          <RoadmapGrid monthTicks={monthTicks} leftEdge={leftEdge} span={span} labelEvery={labelEvery}
            darkMode={darkMode} textSecondary={textSecondary} topPad={TOP_PAD} bottomPad={BOTTOM_PAD} language={language} />

          {/* Grouped rows */}
          <div style={{ paddingTop: TOP_PAD, paddingBottom: BOTTOM_PAD }}>
            {groups.map((g) => (
              <div key={g.area?.id || '__none__'}>
                <div
                  className="relative z-10 flex items-center gap-1.5 transition-opacity duration-200"
                  style={{ height: HEADER_H, opacity: selectedGoalId && !g.rows.some(r => r.goal.id === selectedGoalId) ? 0.32 : 1 }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: g.area ? toHex(g.area.color) : (darkMode ? '#6b7280' : '#9ca3af') }}
                  />
                  <span className={`text-xs font-semibold ${textPrimary} truncate`}>
                    {g.area ? (g.area.name || t('goals.untitledArea')) : t('goals.noDefinedArea')}
                  </span>
                </div>
                {g.rows.map(renderBar)}
              </div>
            ))}
          </div>
        </div>
      )}

      {hiddenCount > 0 && (
        <p className={`text-xs ${textSecondary} opacity-60`}>
          {t('goals.goalsOutsideRange', { count: hiddenCount })}
        </p>
      )}
    </div>
  );
};

export default GoalTimeline;
