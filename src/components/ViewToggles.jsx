import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

/**
 * "Views on this device": one switch per view a switcher offers. A view
 * turned off leaves that switcher, the number keys and the C cycle, and the
 * default-view picker, on this device only. At least one stays on: the last
 * switch still on is disabled. A tablet renders one group per orientation,
 * since its two switchers keep separate lists.
 *
 * @param {object} props
 * @param {'desktop'|'mobile'} props.scope  which switcher's list: the cycler or the phone toggle
 * @param {string[]} props.views          the views to list, in switcher order
 * @param {(view: string) => string} props.label  the view's name as the pickers beside it show it
 * @param {string} [props.heading]        replaces "Views on this device" (a tablet names the orientation)
 * @param {boolean} [props.hint]          show the explanatory line (default true; a second group on a tablet skips it)
 */
export default function ViewToggles({ scope, views, label, heading, hint = true }) {
  const { t } = useTranslation();
  const { hiddenViews, setViewHidden, darkMode, textPrimary, textSecondary } = useDayPlannerCtx();
  const hidden = hiddenViews?.[scope] || [];
  return (
    <div data-view-toggles={scope}>
      <label className={`block text-xs ${textSecondary} mb-1.5`}>{heading || t('settings.viewsOnDevice')}</label>
      {hint && <p className={`text-xs ${textSecondary} opacity-70 mb-2`}>{t('settings.viewsOnDeviceHint')}</p>}
      <div className="space-y-2">
        {views.map((view) => {
          const on = !hidden.includes(view);
          const last = on && views.filter((v) => !hidden.includes(v)).length === 1;
          return (
            <label key={view} data-view-toggle={view} data-on={on ? 'true' : 'false'} className={`flex items-center gap-3 ${last ? 'opacity-60' : 'cursor-pointer'}`}>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={last}
                  onChange={(e) => setViewHidden?.(scope, view, !e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${on ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>
              <span className={`text-sm uppercase ${textPrimary}`}>{label(view)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
