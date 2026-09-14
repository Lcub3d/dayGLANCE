import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { mobileToggleStates, nextState } from '../constants/views.js';

const ORANGE = '#fe8b00';

const GridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1"  y="1"  width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="10" y="1"  width="7" height="7" rx="1.5" fill={ORANGE} fillOpacity="0.55" />
    <rect x="1"  y="10" width="7" height="7" rx="1.5" fill={ORANGE} fillOpacity="0.55" />
    <rect x="10" y="10" width="7" height="7" rx="1.5" fill={ORANGE} fillOpacity="0.28" />
  </svg>
);

const ListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    {/* Vertical spine — flush left */}
    <rect x="1" y="1" width="2" height="16" rx="1" fill={ORANGE} />
    {/* Blocks to the right */}
    <rect x="5" y="2"  width="12" height="4" rx="1" fill={ORANGE} />
    <rect x="5" y="8"  width="12" height="4" rx="1" fill={ORANGE} fillOpacity="0.7" />
    <rect x="5" y="14" width="9"  height="3" rx="1" fill={ORANGE} fillOpacity="0.45" />
  </svg>
);

const SchedIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    {/* Day-group headers with task blocks beneath — the agenda silhouette */}
    <rect x="1" y="1"  width="8"  height="2.5" rx="1" fill={ORANGE} />
    <rect x="1" y="5"  width="16" height="3.5" rx="1" fill={ORANGE} fillOpacity="0.7" />
    <rect x="1" y="10.5" width="8"  height="2.5" rx="1" fill={ORANGE} />
    <rect x="1" y="14.5" width="16" height="3.5" rx="1" fill={ORANGE} fillOpacity="0.7" />
  </svg>
);

const MonthIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    {/* Four squares at full strength: a month as a grid of weeks (GRID fades its squares) */}
    <rect x="1"  y="1"  width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="10" y="1"  width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="1"  y="10" width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="10" y="10" width="7" height="7" rx="1.5" fill={ORANGE} />
  </svg>
);

const ICONS = { grid: GridIcon, list: ListIcon, sched: SchedIcon, month: MonthIcon };
const LABEL_KEYS = { grid: 'settings.viewGrid', list: 'settings.viewList', sched: 'settings.viewSched', month: 'sched.viewMonthShort' };

// GRID → LIST → MONTH → SCHED → GRID (MONTH steps out while the Day Dial is up; views turned off on this device are out altogether)
const MobileViewToggle = () => {
  const { mobileViewMode, setMobileViewMode, textSecondary, showDayDial, hiddenViews } = useDayPlannerCtx();
  const { t } = useTranslation();
  const states = mobileToggleStates(!!showDayDial, hiddenViews);
  const next = nextState(states, mobileViewMode);
  const label = (mode) => t(LABEL_KEYS[mode] || LABEL_KEYS.grid);

  const toggle = () => setMobileViewMode(next);
  const Icon = ICONS[mobileViewMode] || GridIcon;

  return (
    <button
      onClick={toggle}
      className="flex flex-col items-center justify-center gap-0.5 w-full h-full py-1 hover:bg-black/5 dark:hover:bg-white/5 active:bg-black/10 dark:active:bg-white/10 transition-colors"
      aria-label={t('sched.switchToView', 'Switch to {{view}} view', { view: label(next) })}
      title={t('sched.currentViewTap', 'Current view: {{view}}. Tap to switch.', { view: label(mobileViewMode) })}
    >
      <Icon />
      <span className={`text-[9px] font-semibold tracking-widest uppercase ${textSecondary} leading-none`}>
        {label(mobileViewMode)}
      </span>
    </button>
  );
};

export default MobileViewToggle;
