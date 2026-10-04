import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { CARD_SIZES, clampCardSize } from '../utils/cardSize.js';

// Settings' home for the Goals & Projects card size (utils/cardSize.js),
// beside the timeline levels: a preference of this screen, saved on this
// device.
export default function CardSizeSettings() {
  const { t } = useTranslation();
  const { spaceCardSize, setSpaceCardSize, darkMode, textPrimary, textSecondary } = useDayPlannerCtx();
  if (typeof setSpaceCardSize !== 'function') return null;
  const current = clampCardSize(spaceCardSize);
  return (
    <div className="space-y-3" data-card-size-settings>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <LayoutGrid size={16} className={textSecondary} />
        {t('cardSize.label')}
      </h4>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('cardSize.label')}>
        {CARD_SIZES.map(({ id }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={current === id}
            data-card-size={id}
            onClick={() => setSpaceCardSize(id)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              current === id
                ? 'bg-blue-600 text-white border-blue-600'
                : `${darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-stone-300 text-stone-700'}`
            }`}
          >
            {t(`cardSize.${id}`)}
          </button>
        ))}
      </div>
      <p className={`text-[10px] ${textSecondary} opacity-70`}>{t('cardSize.hint')}</p>
    </div>
  );
}
