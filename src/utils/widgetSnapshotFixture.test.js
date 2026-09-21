import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildLiveWidgetSnapshot, LIVE_SNAPSHOT_PATH, LIVE_SNAPSHOT_TIMEZONE,
} from './widgetSnapshotFixture.js';

// The committed fixture is what the widget extension's tests decode and
// render (dayglance-ios/DayGlanceWidgetTests). It must be what the producers
// build NOW, or the Swift side keeps passing against a payload the app no
// longer sends.

const fixtureUrl = new URL(`../../${LIVE_SNAPSHOT_PATH}`, import.meta.url);

let previousTZ;
beforeAll(() => { previousTZ = process.env.TZ; process.env.TZ = LIVE_SNAPSHOT_TIMEZONE; });
afterAll(() => {
  if (previousTZ === undefined) delete process.env.TZ;
  else process.env.TZ = previousTZ;
});

const isWholeOrNull = (v) => v === null || Number.isInteger(v);

describe('live widget snapshot fixture', () => {
  it('matches what the producers build now (refresh with `npm run ios:vectors`)', () => {
    const committed = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
    expect(buildLiveWidgetSnapshot()).toEqual(committed);
  });

  it('carries a sky for the pushed day and for every projected day', () => {
    const s = buildLiveWidgetSnapshot();
    for (const day of [s, ...s.days]) {
      expect(day.sky, day.date).not.toBeNull();
      expect(day.sky.hours, day.date).toHaveLength(24);
      expect(day.sky.sunriseMin, day.date).toEqual(expect.any(Number));
      expect(day.sky.sunsetMin, day.date).toEqual(expect.any(Number));
      expect(day.sky.hours.some((h) => h.sun > 0.5), day.date).toBe(true);
    }
    expect(s.days).toHaveLength(3);
  });

  it('sends every minute field as a whole number, which the widget decodes as Int?', () => {
    // WidgetModels.swift declares sunriseMin, sunsetMin and moon.glyphMin as
    // Int?. JSONDecoder rejects 391.5 for an Int, and one rejected field
    // fails the WHOLE snapshot: every iOS widget goes blank, not just the
    // sky. So the contract is pinned here, at the producer.
    const s = buildLiveWidgetSnapshot();
    for (const day of [s, ...s.days]) {
      expect(isWholeOrNull(day.sky.sunriseMin), `${day.date} sunriseMin`).toBe(true);
      expect(isWholeOrNull(day.sky.sunsetMin), `${day.date} sunsetMin`).toBe(true);
      expect(isWholeOrNull(day.sky.moon.glyphMin), `${day.date} glyphMin`).toBe(true);
      for (const b of day.dial.blocks) {
        expect(Number.isInteger(b.startMin), `${day.date} ${b.id} startMin`).toBe(true);
        expect(Number.isInteger(b.durationMin), `${day.date} ${b.id} durationMin`).toBe(true);
      }
    }
  });

  it('is serialisable without loss', () => {
    const s = buildLiveWidgetSnapshot();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
