import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  getPeakSunElevation, getStoredWeatherCoords, getSunElevation, getSunTimes,
  POLAR_DAY, POLAR_NIGHT, storeWeatherCoords,
} from './solar.js';

// Value assertions use longitude close to 0 so that local time equals solar
// UT and the expectations hold regardless of algorithm internals. Tolerance is
// generous (25 min), since the layer draws hairlines rather than an almanac.
//
// getSunTimes returns minutes on the LOCAL clock, so comparing it against UT
// ephemeris times is only valid where the local clock IS UT. vitest.config.js
// pins TZ=UTC so that holds wherever the suite runs; it used to be assumed,
// and the file quietly failed for anyone outside UTC. The guard below keeps
// the assumption from going unstated again, and 'converts UT to the local
// clock' covers what UTC alone cannot see.
const close = (actual, expectedMin, tol = 25) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual - expectedMin)).toBeLessThanOrEqual(tol);
};

// Without this the ephemeris assertions below fail by whole hours, and the
// message blames the astronomy rather than the clock.
it('runs in UTC, as the ephemeris expectations require', () => {
  expect(new Date(2026, 5, 21).getTimezoneOffset(),
    'set TZ=UTC (vitest.config.js test.env) or the solar expectations below are off by the local offset').toBe(0);
});

describe('getSunTimes', () => {
  it('matches the ephemeris for London at the June solstice', () => {
    // 2026-06-21, London (51.5074, -0.1278): sunrise 03:43 UT, sunset 20:21 UT.
    const { sunriseMin, sunsetMin } = getSunTimes(new Date(2026, 5, 21), 51.5074, -0.1278);
    close(sunriseMin, 3 * 60 + 43);
    close(sunsetMin, 20 * 60 + 21);
  });

  it('gives a near-12-hour day on the equator at the equinox', () => {
    const { sunriseMin, sunsetMin } = getSunTimes(new Date(2026, 2, 20), 0, 0);
    close(sunriseMin, 6 * 60);
    close(sunsetMin, 18 * 60);
    // Refraction + solar diameter make the day slightly longer than 12h.
    expect(sunsetMin - sunriseMin).toBeGreaterThan(12 * 60);
    expect(sunsetMin - sunriseMin).toBeLessThan(12 * 60 + 30);
  });

  it('tells polar day from polar night instead of collapsing both', () => {
    // Tromsø, 69.65°N: midnight sun in June, polar night in December. Both
    // have no rise or set to mark, but they are opposite days — a caller
    // drawing a lit SPAN has to fill one end to end and leave the other
    // empty, so the distinction cannot be thrown away.
    expect(getSunTimes(new Date(2026, 5, 21), 69.65, 18.95))
      .toEqual({ sunriseMin: null, sunsetMin: null, polar: POLAR_DAY });
    expect(getSunTimes(new Date(2026, 11, 21), 69.65, 18.95))
      .toEqual({ sunriseMin: null, sunsetMin: null, polar: POLAR_NIGHT });
  });

  it('leaves polar null on an ordinary day', () => {
    expect(getSunTimes(new Date(2026, 5, 21), 51.5074, -0.1278).polar).toBeNull();
  });

  it('makes northern summer days longer than winter days', () => {
    const june = getSunTimes(new Date(2026, 5, 21), 41.85, 0);
    const dec = getSunTimes(new Date(2026, 11, 21), 41.85, 0);
    const len = ({ sunriseMin, sunsetMin }) => sunsetMin - sunriseMin;
    expect(len(june)).toBeGreaterThan(len(dec) + 4 * 60);
    expect(june.sunriseMin).toBeLessThan(dec.sunriseMin);
  });
});

describe('getSunElevation', () => {
  // Longitude 0 and TZ=UTC, so the local clock is solar time and noon is noon.
  // Tolerance is a degree, since the band it feeds is a soft gradient.
  const near = (actual, expected, tol = 1) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

  it('peaks at the geometric maximum for the latitude and season', () => {
    // At solar noon the sun stands at (90 - |lat| + declination) degrees.
    // London at the June solstice: 90 - 51.5 + 23.44 = 61.9.
    near(getSunElevation(new Date(2026, 5, 21), 51.5074, 0, 12 * 60), 61.9);
    // ...and at the December solstice, 23.44 below the equator: 15.1.
    near(getSunElevation(new Date(2026, 11, 21), 51.5074, 0, 12 * 60), 15.1);
    // The equinox drops the declination term entirely: 90 - 51.5 = 38.5.
    near(getSunElevation(new Date(2026, 2, 20), 51.5074, 0, 12 * 60), 38.5, 1.5);
  });

  it('puts the sun below the horizon at midnight and above it at noon', () => {
    const at = (min) => getSunElevation(new Date(2026, 5, 21), 51.5074, 0, min);
    expect(at(0)).toBeLessThan(0);
    expect(at(12 * 60)).toBeGreaterThan(0);
    // Monotonic through the morning — this is what shapes the band.
    expect(at(8 * 60)).toBeLessThan(at(10 * 60));
    expect(at(10 * 60)).toBeLessThan(at(12 * 60));
  });

  it('keeps the midnight sun above the horizon around the clock', () => {
    for (let m = 0; m < 1440; m += 60) {
      expect(getSunElevation(new Date(2026, 5, 21), 69.65, 18.95, m)).toBeGreaterThan(0);
    }
  });

  it('never leaves the real range', () => {
    for (const lat of [-89, -23, 0, 39.7, 69.65, 89]) {
      for (let m = 0; m < 1440; m += 97) {
        const e = getSunElevation(new Date(2026, 7, 3), lat, 12, m);
        expect(e).toBeGreaterThanOrEqual(-90);
        expect(e).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe('getPeakSunElevation', () => {
  it('is the best noon of the year for the latitude', () => {
    expect(getPeakSunElevation(39.7392)).toBeCloseTo(73.7, 1);
    expect(getPeakSunElevation(-39.7392)).toBeCloseTo(73.7, 1); // symmetric
    expect(getPeakSunElevation(51.5074)).toBeCloseTo(61.93, 1);
  });

  it('caps inside the tropics, where the sun does pass overhead', () => {
    expect(getPeakSunElevation(0)).toBe(90);
    expect(getPeakSunElevation(15)).toBe(90);
    expect(getPeakSunElevation(23.44)).toBe(90);
    expect(getPeakSunElevation(30)).toBeLessThan(90);
  });
});

/**
 * In UTC the local-clock conversion is a no-op, so neither the shift in
 * getSunTimes nor the getTimezoneOffset term in getSunElevation is exercised
 * by anything above: a sunrise of 03:42 UT reads back as 03:42 either way.
 *
 * These run in a child process with TZ set, the way src/jobo/core.test.js
 * does, because both functions read the ambient zone through Date and the
 * suite's own zone is pinned. Asia/Shanghai is UTC+8 with no DST, so the
 * expected numbers are arithmetic rather than a calendar lookup.
 */
describe('local-clock conversion outside UTC', () => {
  // offsetMin is what getTimezoneOffset should report in the child: minutes
  // BEHIND UTC, so UTC+8 is -480. Asserting it first means a child that did
  // not take the TZ fails on that rather than on the astronomy.
  const inZone = (tz, offsetMin, body) => {
    const script = `
      import assert from 'node:assert/strict';
      import { getSunTimes, getSunElevation } from ${JSON.stringify(new URL('./solar.js', import.meta.url).href)};
      assert.equal(new Date(2026, 5, 21).getTimezoneOffset(), ${offsetMin}, 'child did not take TZ=${tz}');
      (${body.toString()})(getSunTimes, getSunElevation, assert);
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 10000,
    });
  };

  it('converts UT to the local clock, wrapping past midnight', () => {
    inZone('Asia/Shanghai', -480, (getSunTimes, _getSunElevation, assert) => {
      // London at the June solstice is 03:42 and 20:21 UT, asserted against
      // the ephemeris above. UTC+8 puts sunrise at 11:42 and carries sunset
      // over midnight to 04:21 the next day.
      const { sunriseMin, sunsetMin } = getSunTimes(new Date(2026, 5, 21), 51.5074, -0.1278);
      assert.equal(sunriseMin, (222 + 480) % 1440);
      assert.equal(sunsetMin, (1221 + 480) % 1440);
      // The wrap is the point: a conversion that only added the offset would
      // report 1701, a minute-of-day that does not exist.
      assert.ok(sunsetMin < sunriseMin, 'sunset should read earlier on the clock than sunrise here');
    });
  });

  it('reads minOfDay as the local clock, not as UT', () => {
    inZone('Asia/Shanghai', -480, (_getSunTimes, getSunElevation, assert) => {
      // Local noon in Shanghai is 04:00 UT, so the London sun has barely
      // risen: nowhere near the 61.9 it reaches at local noon in UTC.
      const atLocalNoon = getSunElevation(new Date(2026, 5, 21), 51.5074, 0, 12 * 60);
      assert.ok(atLocalNoon < 10, `expected a low sun, got ${atLocalNoon}`);
      // Its real peak sits where local time makes solar noon: 20:00 local.
      const atSolarNoon = getSunElevation(new Date(2026, 5, 21), 51.5074, 0, 20 * 60);
      assert.ok(Math.abs(atSolarNoon - 61.9) <= 1, `expected the 61.9 peak, got ${atSolarNoon}`);
    });
  });
});

describe('weather coords storage', () => {
  // Minimal localStorage stand-in (node test env has none) — the util only
  // needs get/set/remove.
  beforeEach(() => {
    const map = new Map();
    globalThis.localStorage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  });

  it('round-trips coordinates and clears on null', () => {
    expect(getStoredWeatherCoords()).toBeNull();
    storeWeatherCoords({ lat: 41.85, lon: -87.65 });
    expect(getStoredWeatherCoords()).toEqual({ lat: 41.85, lon: -87.65 });
    storeWeatherCoords(null);
    expect(getStoredWeatherCoords()).toBeNull();
  });

  it('rejects malformed stored values', () => {
    localStorage.setItem('day-planner-weather-coords', 'not json');
    expect(getStoredWeatherCoords()).toBeNull();
    localStorage.setItem('day-planner-weather-coords', JSON.stringify({ lat: 'x', lon: 2 }));
    expect(getStoredWeatherCoords()).toBeNull();
  });
});
