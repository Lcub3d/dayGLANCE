import React from 'react';
import { Calendar, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

/**
 * The desktop/tablet space switcher: a two-button segmented control at the far
 * left of the header row (calendar icon / the GitBranch icon the app already
 * uses for Goals & Projects — not Target, which is focus mode elsewhere) that swaps the sidebar and the main area between the
 * Calendar space and the Goals & Projects space (like Mail/Calendar in
 * Outlook). The header row itself, its height and its icon cluster are the
 * same in both spaces; only what sits below changes.
 *
 * `g` toggles the same state (useKeyboardShortcuts), so the tooltips say so.
 * Choosing Goals also enables the feature on first use, like `g` does.
 *
 * In Electron the header may sit inside a window drag region, so the control
 * opts out (WebkitAppRegion no-drag) or its buttons would drag the window.
 */
export default function SpaceSwitcher() {
  const { darkMode, textSecondary } = useDayPlannerCtx();
  const {
    desktopSpace = 'calendar', setDesktopSpace,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
  } = useFeaturesCtx() || {};
  const { t } = useTranslation();

  const pick = (space) => {
    if (space === 'goals' && !goalsProjectsEnabled) setGoalsProjectsEnabled?.(true);
    setDesktopSpace?.(space);
  };

  const spaces = [
    { key: 'calendar', Icon: Calendar, label: t('goals.spaceCalendar') },
    { key: 'goals', Icon: GitBranch, label: t('goals.dashboardTitle') },
  ];

  return (
    <div
      role="group"
      aria-label={t('goals.spaceSwitcher')}
      data-space-switcher
      className={`flex items-center gap-0.5 p-[3px] rounded-lg border flex-shrink-0 ${
        darkMode ? 'bg-gray-900/60 border-gray-700' : 'bg-stone-200 border-stone-300'
      }`}
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {spaces.map(({ key, Icon, label }) => {
        const active = desktopSpace === key;
        const title = `${label}  ·  ${t('goals.spaceToggleHint')}`;
        return (
          <button
            key={key}
            type="button"
            onClick={() => pick(key)}
            aria-pressed={active}
            aria-label={title}
            title={title}
            className={`w-9 h-8 rounded-md flex items-center justify-center transition-colors ${
              active
                ? 'bg-blue-600 text-white'
                : `${textSecondary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-300/70'}`
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The header centre while the Goals & Projects space is active: the space's
 * name plus a muted count, in place of the calendar's date navigation.
 */
export function GoalsSpaceTitle() {
  const { textPrimary, textSecondary } = useDayPlannerCtx();
  const { goals = [], projects = [], isVisibleForUser } = useFeaturesCtx() || {};
  const { t } = useTranslation();
  const visible = (item) => (isVisibleForUser ? isVisibleForUser(item) : true);
  const goalCount = goals.filter(g => g.status !== 'archived' && visible(g)).length;
  const projectCount = projects.filter(p => p.status !== 'archived' && visible(p)).length;
  return (
    <div className="flex items-baseline justify-center gap-2.5 min-w-0" data-goals-space-title>
      <span className={`${textPrimary} font-semibold text-base truncate`}>{t('goals.dashboardTitle')}</span>
      <span className={`text-xs ${textSecondary} whitespace-nowrap`}>
        {t('goals.goalCount', { count: goalCount })} · {t('goals.projectCount', { count: projectCount })}
      </span>
    </div>
  );
}
