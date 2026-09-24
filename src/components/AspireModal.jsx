import React from 'react';
import { Compass, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

/**
 * Aspire — placeholder for the life-planning view (life wish list, five-year
 * vision, mottos; prototype: Lcub3d/dayGLANCE `lifeplanner`). Behind the
 * Experimental "Aspire" switch, opened from the Goals & Projects space's FAB
 * stack. Escape is owned by GoalDashboard's chain; the backdrop and X close it.
 */
export default function AspireModal({ onClose }) {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-aspire-modal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aspire-title"
        onClick={e => e.stopPropagation()}
        className={`relative ${cardBg} rounded-2xl shadow-2xl border ${borderClass} w-full max-w-md p-6 flex flex-col items-center text-center gap-3`}
      >
        <button type="button" onClick={onClose} className={`absolute top-3 right-3 p-1.5 rounded-lg ${hoverBg}`} aria-label={t('common.close')}>
          <X size={16} className={textSecondary} />
        </button>
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${darkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-50 text-amber-500'}`}>
          <Compass size={28} />
        </div>
        <h2 id="aspire-title" className={`text-lg font-semibold ${textPrimary}`}>{t('aspire.title')}</h2>
        <p className={`text-sm ${textSecondary} leading-relaxed`}>{t('aspire.placeholder')}</p>
        <span className={`mt-1 text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-500'}`}>
          {t('aspire.comingSoon')}
        </span>
      </div>
    </div>
  );
}
