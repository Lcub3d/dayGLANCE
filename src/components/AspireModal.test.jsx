import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FeaturesContext, useFeaturesCtx } from '../context/FeaturesContext.jsx';

const probe = vi.hoisted(() => ({ features: null }));

vi.mock('./lifeplanner/LifePlanner.jsx', () => ({
  default: function LifePlannerProbe() {
    probe.features = useFeaturesCtx();
    return null;
  },
}));

import AspireModal from './AspireModal.jsx';

describe('AspireModal', () => {
  it('mounts LifePlanner with a dashboard close adapter and preserves its data context', () => {
    const jobuData = { save: vi.fn() };
    const parentClose = vi.fn();
    const parentPageClose = vi.fn();
    const parentFeatures = { jobuData, setShowLifePlanner: parentPageClose, projects: [] };

    const html = renderToStaticMarkup(
      <FeaturesContext.Provider value={parentFeatures}>
        <AspireModal onClose={parentClose} />
      </FeaturesContext.Provider>,
    );

    expect(html).toContain('data-aspire-modal');
    expect(probe.features.jobuData).toBe(jobuData);
    expect(probe.features).not.toBe(parentFeatures);

    probe.features.setShowLifePlanner(false);
    expect(parentClose).toHaveBeenCalledTimes(1);
    expect(parentPageClose).not.toHaveBeenCalled();
  });
});
