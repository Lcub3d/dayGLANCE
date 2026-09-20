import React, { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

// Local jobo-pre experiment inside main's sixth view. Keep main's feature flag,
// navigation, tasks and daily notes. The prototype never replaces DAY or WEEK.
// Lazy loading also keeps its experimental ledger unopened while the flag is off.
const Prototype = lazy(() => import('./jobo/JoboViews.jsx').then(module => ({
  default: module.JoboDayView,
})));

export default function JoboView() {
  const { t } = useTranslation();
  const { dataLoaded, isTrayMode, textPrimary, textSecondary } = useDayPlannerCtx();
  const { joboEnabled, multiUserEnabled } = useFeaturesCtx();
  if (!joboEnabled) return null;
  if (isTrayMode || multiUserEnabled) {
    return <p data-jobo-unavailable className={`p-4 text-sm ${textSecondary}`}>{t('jobo.unavailable')}</p>;
  }
  return (
    <div data-jobo-view className={`h-full min-h-0 flex flex-col ${textPrimary}`}>
      <p className={`shrink-0 px-3 py-1 text-xs ${textSecondary}`}>{t('jobo.localOnly')}</p>
      <div className="flex-1 min-h-0">
        {dataLoaded ? <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
          <Prototype />
        </Suspense> : <p className="p-4">{t('common.loading')}</p>}
      </div>
    </div>
  );
}
