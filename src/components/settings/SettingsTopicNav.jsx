// The Settings topic list (#2075): one button per topic with something to show.
import React from 'react';
import { useTranslation } from 'react-i18next';

export default function SettingsTopicNav({ topics, activeId, onSelect, darkMode, textPrimary, textSecondary, borderClass }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('settings.title')}
      data-settings-topics
      className={`flex-shrink-0 w-36 md:w-44 border-r ${borderClass} overflow-y-auto py-3 px-2 space-y-0.5`}
    >
      {topics.map((topic) => {
        const active = topic.id === activeId;
        return (
          <button
            key={topic.id}
            type="button"
            data-settings-topic={topic.id}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(topic.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? `${darkMode ? 'bg-gray-700' : 'bg-stone-200'} font-medium ${textPrimary}`
                : `${textSecondary} ${darkMode ? 'hover:bg-gray-700/60' : 'hover:bg-stone-100'}`
            }`}
          >
            {t(topic.labelKey, topic.fallback)}
          </button>
        );
      })}
    </nav>
  );
}
