import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The header's magnifier shows only in a view that zooms (MULTI, WEEK,
// JOBO), and says the level when it is not 100%.
let ctx = {};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ctx }));
const { default: TimelineZoomControl } = await import('./TimelineZoomControl.jsx');

const render = (view, zooms = {}) => {
  ctx = { timelineZooms: zooms, setTimelineZoom: vi.fn(), darkMode: false, hoverBg: '', cardBg: '', borderClass: '', textPrimary: '', textSecondary: '' };
  return renderToStaticMarkup(<TimelineZoomControl view={view} />);
};

describe('TimelineZoomControl', () => {
  it('appears in MULTI, WEEK and JOBO, and nowhere else', () => {
    for (const view of ['multi', 'week', 'jobo']) expect(render(view)).toContain(`data-timeline-zoom="${view}"`);
    for (const view of ['day', 'month', 'sched']) expect(render(view)).toBe('');
  });

  it('names the level on the button when it is not 100%', () => {
    expect(render('multi')).not.toMatch(/>100%</);
    expect(render('multi', { multi: 1.2 })).toContain('>120%<');
    expect(render('multi', { multi: 1.2 })).toContain('aria-label="timelineZoom.label: 120%"');
  });

  it('shows the level of the view it is in', () => {
    expect(render('week', { multi: 1.2 })).toContain('aria-label="timelineZoom.label: 100%"');
  });
});
