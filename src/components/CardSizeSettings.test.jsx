import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The Goals & Projects card size lives in Settings beside the timeline
// levels: four named steps, saved on this device.
let ctx = {};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ctx }));
const { default: CardSizeSettings } = await import('./CardSizeSettings.jsx');

const render = (spaceCardSize) => {
  ctx = { spaceCardSize, setSpaceCardSize: vi.fn(), darkMode: false, textPrimary: '', textSecondary: '' };
  return renderToStaticMarkup(<CardSizeSettings />);
};

describe('CardSizeSettings', () => {
  it('offers the four sizes in order', () => {
    expect([...render().matchAll(/data-card-size="(\w+)"/g)].map((m) => m[1])).toEqual(['small', 'normal', 'large', 'larger']);
  });

  it('marks the stored size, and Normal for anything unknown', () => {
    expect(render('large')).toMatch(/aria-checked="true" data-card-size="large"/);
    expect(render('huge')).toMatch(/aria-checked="true" data-card-size="normal"/);
  });

  it('renders nothing without the setter', () => {
    ctx = {};
    expect(renderToStaticMarkup(<CardSizeSettings />)).toBe('');
  });
});
