import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import DayDial from './DayDial.jsx';
import { muteDialColor, muteDialFrameColor } from '../utils/dayDial.js';
import { FRAME_SCENARIOS, SCENARIO_DATE, SCENARIO_NOW, SCENARIO_WINDOW } from './dayDialFrameScenarios.js';

// The four frame preview scenarios, rendered: the enclosures on the ring, the
// hub's frame rows (only when nothing is running), and the Frames figure.

async function i18nEn() {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en', fallbackLng: false,
    resources: { en: { translation: await loaders.en() } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

const render = (i18n, scenario, props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayDial
      dayTasks={scenario.dayTasks}
      frames={scenario.frames}
      dayWindow={SCENARIO_WINDOW}
      date={new Date(`${SCENARIO_DATE}T12:00:00`)}
      nowMin={SCENARIO_NOW}
      formatTime={(hhmm) => hhmm}
      use24HourClock
      {...props}
    />
  </I18nextProvider>,
);

// The enclosures: stroked, unfilled paths at the frame opacity.
const enclosures = (html) => Array.from(
  html.matchAll(/<path d="([^"]*)" fill="none" stroke="(#[0-9a-f]{6})" stroke-opacity="0.45" stroke-width="([^"]*)"/g),
).map(([, d, stroke, width]) => ({ d, stroke, width: Number(width) }));
const legendValue = (html, label) => {
  const m = html.match(new RegExp(`>${label}</div><div class="[^"]*">([^<]*)<`));
  return m ? m[1] : null;
};

describe('Day Dial frames', () => {
  it('task running: the frames draw, the hub keeps the task', async () => {
    const html = render(await i18nEn(), FRAME_SCENARIOS.running);
    const rings = enclosures(html);
    expect(rings.map((r) => r.stroke)).toEqual(['#3b82f6', '#f59e0b', '#f43f5e'].map(muteDialFrameColor));
    // 1.2 of the widget's 22pt band, on this band's 85 units.
    expect(rings[0].width).toBeCloseTo((1.2 / 22) * 85, 5);
    expect(html).toContain('Monthly budget review');
    expect(html).not.toContain('available');
    expect(legendValue(html, 'Frames')).toMatch(/^\d+%$/);
  });

  it('nothing running: the hub speaks for the frame, at the standard mute', async () => {
    const html = render(await i18nEn(), FRAME_SCENARIOS.frameRows);
    expect(html).toContain('>Admin</span>');
    expect(html).toContain(`color:${muteDialColor('#f59e0b')}`);
    expect(html).toContain('14:00–17:45');
    // 17:18–17:45, the only free slot left in Admin once Expenses ends at 16:45 (+5m buffer).
    expect(html).toContain('27m available');
  });

  it('nested: the inner frame steps in one level', async () => {
    const rings = enclosures(render(await i18nEn(), FRAME_SCENARIOS.nested));
    expect(rings).toHaveLength(3);
    const [outer, inner] = rings;
    expect(inner.d).not.toBe(outer.d);
    // Outer radius of the nested one is 3.2/22 of the band inside the top level's.
    const firstRadius = (d) => Number(d.split(' A ')[1].split(' ')[0]);
    expect(firstRadius(outer.d) - firstRadius(inner.d)).toBeCloseTo((3.2 / 22) * 85, 5);
  });

  it('a frame at 0 %: drawn, the figure reads 0 %, all of it available', async () => {
    const html = render(await i18nEn(), FRAME_SCENARIOS.empty);
    expect(enclosures(html)).toHaveLength(1);
    expect(legendValue(html, 'Frames')).toBe('0%');
    expect(html).toContain('>Reading</span>');
    expect(html).toContain('1h 12m available');
  });

  it('a day without frames draws none and has no Frames entry', async () => {
    const html = render(await i18nEn(), { dayTasks: FRAME_SCENARIOS.frameRows.dayTasks, frames: null });
    expect(enclosures(html)).toHaveLength(0);
    expect(legendValue(html, 'Frames')).toBeNull();
    expect(html).not.toContain('available');
  });
});
