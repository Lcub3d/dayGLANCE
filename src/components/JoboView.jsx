import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// JOBO: plan versus actual. The sixth desktop view, behind the `joboEnabled`
// flag, being landed in slices from the prototype in #1673.
//
// This first slice is the switch and the seat: the view is registered, keyed
// to 6, cycles, and can be turned off per device like any other, so every
// later slice has somewhere to land that already behaves like a view. What it
// SHOWS comes after the ledger does (src/jobo/, none of it here yet), because
// a view drawn from a store that cannot survive a sync is worse than no view.
export default function JoboView() {
  const { t } = useTranslation();
  const { textPrimary, textSecondary } = useDayPlannerCtx();
  return (
    <div data-jobo-view className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-2">
        <div className={`text-lg font-semibold tracking-wide ${textPrimary}`}>{t('jobo.title')}</div>
        <p className={`text-sm ${textSecondary}`}>{t('jobo.placeholder')}</p>
      </div>
    </div>
  );
}
