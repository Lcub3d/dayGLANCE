import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { ALWAYS_ON_VIEWS } from '../constants/views.js';

/**
 * "Views on this device": one switch per view the form factor offers. A view
 * turned off leaves the switcher, the number keys and the C cycle, and the
 * default-view picker, on this device only. The form factor's home view
 * (MULTI on desktop, GRID on the phone) is always on and says so.
 *
 * @param {object} props
 * @param {string[]} props.views          the views to list, in switcher order
 * @param {(view: string) => string} props.label  the view's name as the pickers beside it show it
 */
export default function ViewToggles({ views, label }) {
  const { t } = useTranslation();
  const { hiddenViews = [], setViewHidden, darkMode, textPrimary, textSecondary } = useDayPlannerCtx();
  return (
    <div data-view-toggles>
      <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.viewsOnDevice')}</label>
      <p className={`text-xs ${textSecondary} opacity-70 mb-2`}>{t('settings.viewsOnDeviceHint')}</p>
      <div className="space-y-2">
        {views.map((view) => {
          const alwaysOn = ALWAYS_ON_VIEWS.includes(view);
          const on = alwaysOn || !hiddenViews.includes(view);
          return (
            <label key={view} data-view-toggle={view} data-on={on ? 'true' : 'false'} className={`flex items-center gap-3 ${alwaysOn ? 'opacity-60' : 'cursor-pointer'}`}>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={alwaysOn}
                  onChange={(e) => setViewHidden?.(view, !e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${on ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>
              <span className={`text-sm ${textPrimary}`}>{label(view)}</span>
              {alwaysOn && <span className={`text-xs ${textSecondary}`}>{t('settings.viewAlwaysOn')}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
