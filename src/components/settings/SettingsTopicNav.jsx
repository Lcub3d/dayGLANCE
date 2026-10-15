// The Settings topic list (#2075): one button per topic with something to show.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { topicAttention } from './settingsTopics.js';

export default function SettingsTopicNav({ topics, sections, activeId, onSelect, darkMode, textPrimary, textSecondary, borderClass }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('settings.title')}
      data-settings-topics
      className={`flex-shrink-0 w-36 md:w-44 border-r ${borderClass} overflow-y-auto py-3 px-2 space-y-0.5`}
    >
      {topics.map((topic) => {
        const active = topic.id === activeId;
        // The same marks the header's Settings button carries (an update, a
        // timezone notice), placed on the topic that explains them.
        const mark = topicAttention(topic, sections);
        return (
          <button
            key={topic.id}
            type="button"
            data-settings-topic={topic.id}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(topic.id)}
            data-settings-topic-mark={mark || undefined}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? `${darkMode ? 'bg-gray-700' : 'bg-stone-200'} font-medium ${textPrimary}`
                : `${textSecondary} ${darkMode ? 'hover:bg-gray-700/60' : 'hover:bg-stone-100'}`
            }`}
          >
            <span className="flex-1 min-w-0 truncate">{t(topic.labelKey, topic.fallback)}</span>
            {mark && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${mark === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />}
          </button>
        );
      })}
    </nav>
  );
}
