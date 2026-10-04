import React, { useEffect, useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { normalizeFollowUpTag } from '../utils/followUp.js';

/**
 * Settings › Follow-ups: the tag "Schedule follow-up task" adds to the new
 * task (utils/followUp.js), on this device. Saved when the field is left or
 * Enter is pressed, so typing is never reshaped mid-word; anything that is
 * not one valid tag saves as none.
 */
export default function FollowUpTagSetting({ idSuffix = '' }) {
  const { t } = useTranslation();
  const { followUpTag, setFollowUpTag, darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const [draft, setDraft] = useState(followUpTag ? `#${followUpTag}` : '');
  useEffect(() => { setDraft(followUpTag ? `#${followUpTag}` : ''); }, [followUpTag]);
  const id = `follow-up-tag${idSuffix}`;
  // The field then shows what was kept: `#waitingfor`, or empty for none.
  const commit = () => {
    const tag = normalizeFollowUpTag(draft);
    setFollowUpTag(tag);
    setDraft(tag ? `#${tag}` : '');
  };

  return (
    <div className="space-y-3" data-follow-up-setting>
      <label htmlFor={id} className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <CornerDownRight size={16} className={textSecondary} />
        {t('followUp.settingTitle')}
      </label>
      <div>
        <div className={`text-sm ${textSecondary} mb-1`}>{t('followUp.settingLabel')}</div>
        <input
          id={id}
          type="text"
          value={draft}
          placeholder={t('followUp.settingPlaceholder')}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className={`w-48 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
        />
        <p className={`text-xs ${textSecondary} mt-1`}>{t('followUp.settingHint')}</p>
      </div>
    </div>
  );
}
