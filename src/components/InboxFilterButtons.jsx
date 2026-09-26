import React from 'react';
import { Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

/**
 * The Inbox's two filter controls, the same on the phone, the tablet and the
 * desktop panel: a labelled Filter button that opens InboxFilterPopover (a dot
 * while any of its filters is on), and the priority toggle, which stays OUT of
 * the popover because it is a one-tap cycle — All, Low+, Medium+, High — and
 * says which in words beside its three dashes. Bordered 32px buttons, the
 * Goals tab's controls row.
 *
 * The popover lives with its caller (it needs the caller's open state), so the
 * caller passes the ref it anchors to and what a tap on Filter does.
 */
export default function InboxFilterButtons({ filterActive, onToggleFilter, filterButtonRef }) {
  const {
    darkMode, borderClass, textSecondary, hoverBg,
    inboxPriorityFilter, setInboxPriorityFilter, playUISound,
  } = useDayPlannerCtx();
  const { t } = useTranslation();
  const active = darkMode ? 'text-blue-400' : 'text-blue-600';
  const priorityHint = inboxPriorityFilter === 0
    ? t('inbox.showingAllPrioritiesClick', { defaultValue: 'Showing all priorities (click to filter)' })
    : t('inbox.showingPriorityClick', { priority: inboxPriorityFilter, defaultValue: 'Showing priority {{priority}}+ (click to change)' });
  const priorityLabels = [
    t('inbox.priorityAll'),
    `${t('task.lowPriority')}+`,
    `${t('task.mediumPriority')}+`,
    t('task.highPriority'),
  ];
  const level = priorityLabels[inboxPriorityFilter] !== undefined ? inboxPriorityFilter : 0;

  return (
    <div data-inbox-filter-buttons className="flex items-center gap-2">
      <button
        ref={filterButtonRef}
        type="button"
        onClick={() => { onToggleFilter(); playUISound?.('click'); }}
        className={`relative h-8 flex items-center gap-1.5 px-2.5 rounded-lg border ${borderClass} text-xs font-medium whitespace-nowrap ${
          filterActive ? active : textSecondary
        } ${hoverBg} transition-colors`}
        aria-label={t('common.filterInbox')}
        title={t('common.filterInbox')}
      >
        <Filter size={14} />
        <span>{t('goals.filterButton')}</span>
        {filterActive && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500" />}
      </button>
      <button
        type="button"
        onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound?.('click'); }}
        className={`h-8 flex items-center gap-0.5 px-2.5 rounded-lg border ${borderClass} ${hoverBg} whitespace-nowrap transition-colors`}
        aria-label={priorityHint}
        title={priorityHint}
      >
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className={`w-2.5 h-1 rounded-full ${
              inboxPriorityFilter === 0
                ? `${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`
                : i < inboxPriorityFilter
                  ? 'bg-blue-500'
                  : `${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`
            }`}
          />
        ))}
        {/* Every label is laid out in the same grid cell and only the
            current one is visible, so the button is always as wide as the
            longest: cycling never changes its width, and never flips a
            header that is close to full between one row and two. */}
        <span className={`ml-1.5 grid text-xs font-medium ${inboxPriorityFilter === 0 ? textSecondary : active}`}>
          {priorityLabels.map((label, i) => (
            <span
              key={i}
              {...(i === level ? { 'data-priority-label': true } : { 'aria-hidden': true })}
              className={`col-start-1 row-start-1 text-left ${i === level ? '' : 'invisible'}`}
            >
              {label}
            </span>
          ))}
        </span>
      </button>
    </div>
  );
}
