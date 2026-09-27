import React, { useCallback, useMemo } from 'react';
import LifePlanner from './lifeplanner/LifePlanner.jsx';
import { FeaturesContext, useFeaturesCtx } from '../context/FeaturesContext.jsx';

/**
 * Aspire — the real LifePlanner workspace opened from the Goals & Projects
 * space's FAB stack. LifePlanner already owns its focus, Escape, and draft
 * flush/discard behavior; this provider adapts its existing page-level close
 * action to the dashboard's modal state without creating another data store.
 */
export default function AspireModal({ onClose }) {
  const features = useFeaturesCtx();
  const closeLifePlanner = useCallback(show => {
    if (!show) onClose?.();
  }, [onClose]);
  const lifePlannerFeatures = useMemo(() => ({
    ...features,
    setShowLifePlanner: closeLifePlanner,
  }), [features, closeLifePlanner]);

  return (
    <FeaturesContext.Provider value={lifePlannerFeatures}>
      <div data-aspire-modal>
        <LifePlanner />
      </div>
    </FeaturesContext.Provider>
  );
}
