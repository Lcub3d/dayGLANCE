import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Renderer-free harness, as in useDayWindows.test.js: useState slots by call
// order (the hook calls it three times), effects skipped, callbacks bare.
let slots = [];
let idx = 0;
vi.mock('react', () => ({
  useState: (init) => {
    const i = idx++;
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
    return [slots[i], (up) => { slots[i] = typeof up === 'function' ? up(slots[i]) : up; }];
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
}));
vi.mock('../utils/trayMode.js', () => ({ isTrayMode: false }));
const storeWeatherCoords = vi.fn();
vi.mock('../utils/solar.js', () => ({ storeWeatherCoords: (...a) => storeWeatherCoords(...a) }));
vi.mock('../utils/localeFormatting.js', () => ({ formatLocalizedDate: () => 'Mon' }));

const { default: useWeather } = await import('./useWeather.js');

const WEATHER_SLOT = 2; // zip, unit, weather

const forecastBody = {
  current: { temperature_2m: 61.2, weather_code: 0 },
  daily: {
    time: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'],
    temperature_2m_max: [70, 71, 72, 73, 74, 75],
    temperature_2m_min: [50, 51, 52, 53, 54, 55],
    weather_code: [0, 1, 2, 3, 0, 1],
  },
  hourly: { time: ['2026-09-21T12:00'], temperature_2m: [65.4], weather_code: [0], uv_index: [6.1] },
};

describe('useWeather.fetchWeather: the location outlives the header toggle', () => {
  let store;
  let urls;

  beforeEach(() => {
    slots = []; idx = 0;
    store = new Map();
    urls = [];
    storeWeatherCoords.mockClear();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.fetch = vi.fn(async (url) => {
      urls.push(url);
      if (url.includes('zippopotam')) {
        return { ok: true, json: async () => ({ places: [{ latitude: '39.7392', longitude: '-104.9903' }] }) };
      }
      if (url.includes('api.open-meteo.com/v1/forecast')) {
        return { ok: true, json: async () => forecastBody };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.fetch;
  });

  const useHook = () => { idx = 0; return useWeather(); };
  const forecastCalls = () => urls.filter((u) => u.includes('/v1/forecast'));

  it('header weather OFF: still geocodes and stores the coords, skips the forecast', async () => {
    store.set('day-planner-weather-enabled', 'false');
    store.set('day-planner-weather-zip', '80202');
    await useHook().fetchWeather();

    expect(storeWeatherCoords).toHaveBeenCalledWith({ lat: 39.7392, lon: -104.9903 });
    expect(forecastCalls()).toHaveLength(0);
    expect(slots[WEATHER_SLOT]).toBeNull();
  });

  it('header weather ON (the default): geocodes and fetches the forecast', async () => {
    store.set('day-planner-weather-zip', '80202');
    await useHook().fetchWeather();

    expect(storeWeatherCoords).toHaveBeenCalledWith({ lat: 39.7392, lon: -104.9903 });
    expect(forecastCalls()).toHaveLength(1);
    expect(forecastCalls()[0]).toContain('temperature_unit=fahrenheit');
    expect(slots[WEATHER_SLOT]?.hourlyByDate?.['2026-09-21']?.[12]?.temp).toBe(65);
  });

  it('the unit setting reaches the forecast request', async () => {
    store.set('day-planner-weather-zip', '80202');
    store.set('day-planner-weather-temp-unit', 'celsius');
    await useHook().fetchWeather();
    expect(forecastCalls()[0]).toContain('temperature_unit=celsius');
  });

  it('no location: clears the coords and calls nothing', async () => {
    store.set('day-planner-weather-enabled', 'false');
    await useHook().fetchWeather();
    expect(storeWeatherCoords).toHaveBeenCalledWith(null);
    expect(urls).toHaveLength(0);
  });
});
