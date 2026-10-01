import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Timeline size lives in Settings: one level per scrolling timeline, saved
// on this device. JOBO's row appears only with JOBO on, and WEEK, which fits
// its range on screen at 100%, only grows.
let ctx = {};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ctx }));
const { default: TimelineSizeSettings } = await import('./TimelineSizeSettings.jsx');

const render = (zooms = {}, joboEnabled = false) => {
  ctx = { timelineZooms: zooms, setTimelineZoom: vi.fn(), darkMode: false, borderClass: '', textPrimary: '', textSecondary: '' };
  return renderToStaticMarkup(<TimelineSizeSettings joboEnabled={joboEnabled} />);
};
const select = (html, view) => html.match(new RegExp(`<select data-timeline-size="${view}"[\\s\\S]*?</select>`))?.[0] ?? '';

describe('TimelineSizeSettings', () => {
  it('offers MULTI and WEEK, and JOBO only when it is on', () => {
    expect(select(render(), 'multi')).not.toBe('');
    expect(select(render(), 'week')).not.toBe('');
    expect(select(render(), 'jobo')).toBe('');
    expect(select(render({}, true), 'jobo')).not.toBe('');
  });

  it('shows each view\'s own level', () => {
    const html = render({ multi: 1.2 });
    expect(select(html, 'multi')).toMatch(/<option value="1.2" selected="">120%<\/option>/);
    expect(select(html, 'week')).toMatch(/<option value="1" selected="">100%<\/option>/);
  });

  it('runs MULTI from 80% and WEEK from 100%, both to 150%', () => {
    const html = render();
    expect(select(html, 'multi')).toMatch(/^[^]*?>80%<[^]*>150%</);
    expect(select(html, 'week')).not.toContain('>90%<');
    expect(select(html, 'week')).toContain('>150%<');
  });
});
