import { describe, it, expect, vi, afterEach } from 'vitest';
import i18next from 'i18next';
import { gatherTrmnlData, pushToTrmnl, fitTrmnlPayload, payloadBytes, TRMNL_PAYLOAD_BUDGET_BYTES } from './trmnl.js';
import en from '../public/locales/en/translation.json';
import de from '../public/locales/de/translation.json';

// Same interpolation config as src/i18n.js.
const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en }, de: { translation: de } }, interpolation: { escapeValue: false } });

const cfg = { webhookUrl: 'https://usetrmnl.com/api/custom_plugins/abc' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('pushToTrmnl', () => {
  it('reports a 429 as rate limited and carries Retry-After in seconds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, ok: false, headers: { get: (h) => (h === 'Retry-After' ? '900' : null) } })));
    const r = await pushToTrmnl(cfg, { a: 1 });
    expect(r).toMatchObject({ success: false, rateLimited: true, retryAfterSeconds: 900 });
  });

  it('a 429 without Retry-After still backs off (null hint)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, ok: false, headers: { get: () => null } })));
    const r = await pushToTrmnl(cfg, { a: 1 });
    expect(r).toMatchObject({ success: false, rateLimited: true, retryAfterSeconds: null });
  });

  it('passes on what TRMNL said rather than a bare status code', async () => {
    const body = JSON.stringify({ message: '[PluginSetting ID: 1] Large payload received (6076 bytes), should be less than 5kb. Subscribe to TRMNL+ for higher limit.' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 422, ok: false, headers: { get: () => null }, text: async () => body })));
    const r = await pushToTrmnl(cfg, { a: 1 });
    expect(r.success).toBe(false);
    expect(r.payloadTooLarge).toBe(true);
    expect(r.error).toContain('should be less than 5kb');
  });

  it('falls back to the status code when there is no message to pass on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500, ok: false, headers: { get: () => null }, text: async () => '' })));
    const r = await pushToTrmnl(cfg, { a: 1 });
    expect(r).toMatchObject({ success: false, error: 'HTTP 500' });
    expect(r.payloadTooLarge).toBeUndefined();
  });

  it('posts the merge variables and reports success', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true, headers: { get: () => null } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await pushToTrmnl({ ...cfg, apiKey: 'k' }, { a: 1 });
    expect(r).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(cfg.webhookUrl);
    expect(JSON.parse(init.body)).toEqual({ merge_variables: { a: 1 } });
    expect(init.headers.Authorization).toBe('Bearer k');
  });
});

describe('fitTrmnlPayload', () => {
  // TRMNL answers an oversized payload with a 422, so the schedule is trimmed
  // before the push rather than after a rejection.
  const rows = (specs) => specs.map(([title, done, past], i) => ({
    time: `${String(6 + i).padStart(2, '0')}:00`, dur: '45 хв',
    title: `${title} завдання з доволі довгою назвою ${i}`,
    done, pri: 'Середній', allDay: false, past,
  }));
  const payload = (schedule) => ({
    date: '2026-09-24', day_name: 'Четвер', date_label: '24 вер.', current_time: '08:00',
    weather: '', schedule, total: schedule.length, completed: 0, overdue: 0, pct: 0,
    time_planned: '8 г', upcoming: [], next_task: null, inbox_count: 3,
    habits: [], routines: [], note: '',
  });

  it('leaves a payload that already fits exactly as it was', () => {
    const p = payload(rows([['a', false, false], ['b', false, false]]));
    expect(fitTrmnlPayload(p)).toBe(p);
  });

  it('spends completed rows first, then past, and keeps the next thing due', () => {
    // Enough rows to force a trim, mixed so the order of sacrifice is visible.
    const specs = [];
    for (let i = 0; i < 30; i += 1) specs.push([`t${i}`, i % 3 === 0, i % 3 === 1]);
    const out = fitTrmnlPayload(payload(rows(specs)), 1200);
    const kinds = out.schedule.map((r) => (r.done ? 'done' : r.past ? 'past' : 'due'));
    expect(kinds.every((k) => k === 'due')).toBe(true);
    // What survives stays in order, and the earliest due row is still there.
    expect(out.schedule[0].title).toMatch(/t2 /);
    expect(payloadBytes(out)).toBeLessThanOrEqual(1200);
  });

  it('drops the furthest ahead before the soonest when only due rows are left', () => {
    const specs = Array.from({ length: 20 }, (_, i) => [`t${i}`, false, false]);
    const out = fitTrmnlPayload(payload(rows(specs)), 1200);
    expect(out.schedule[0].title).toMatch(/t0 /);
    expect(out.schedule.at(-1).title).not.toMatch(/t19 /);
  });

  it('never reports fewer tasks than the day holds, only draws fewer', () => {
    const specs = Array.from({ length: 30 }, (_, i) => [`t${i}`, false, false]);
    const p = payload(rows(specs));
    const out = fitTrmnlPayload(p, 1200);
    expect(out.total).toBe(30);
    expect(out.schedule.length).toBeLessThan(30);
  });
});

describe('gatherTrmnlData', () => {
  // gatherTrmnlData reads the clock to hide routines that have already ended.
  afterEach(() => { vi.useRealTimers(); });

  const day = (lng) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00'));
    return gatherTrmnlData({
      tasks: [
        { id: 'a', date: '2026-09-24', title: 'Plan', startTime: '09:00', duration: 90, priority: 1 },
        { id: 'b', date: '2026-09-24', title: 'Review', startTime: '11:00', duration: 45, priority: 2 },
        { id: 'c', date: '2026-09-24', title: 'Ship', startTime: '14:00', duration: 60, priority: 3 },
      ],
      selectedDate: '2026-09-24',
      use24HourClock: true,
      routinesEnabled: true,
      todayRoutines: [
        { name: 'Stretch', isAllDay: true },
        { name: 'Walk', startTime: '18:00', duration: 30 },
      ],
      t: i18n.getFixedT(lng),
      language: lng,
    });
  };

  it('renders every label and the date in the requested language', () => {
    const d = day('de');
    expect(d.day_name).toBe('Donnerstag');
    expect(d.date_label).toBe('24. Sept.');
    expect(d.schedule.map((s) => s.pri)).toEqual(['Niedrig', 'Mittel', 'Hoch']);
    expect(d.schedule.map((s) => s.dur)).toEqual(['1 Std. 30 Min.', '45 Min.', '1 Std.']);
    expect(d.time_planned).toBe('3 Std. 15 Min.');
    expect(d.routines).toEqual([
      { name: 'Stretch', time: 'Ganztägig', dur: '' },
      { name: 'Walk', time: '18:00', dur: '30 Min.' },
    ]);
  });

  it('keeps the English durations the device has always shown', () => {
    const d = day('en');
    expect(d.day_name).toBe('Thursday');
    expect(d.date_label).toBe('Sep 24');
    expect(d.schedule.map((s) => s.dur)).toEqual(['1h 30m', '45m', '1h']);
    expect(d.time_planned).toBe('3h 15m');
  });

  // An all-day task carries `isAllDay`; `allDay` is the native calendar's name
  // for the same thing. Reading the wrong one sent allDay false for every
  // all-day row, and since an all-day task has no startTime the template fell
  // through to an empty time followed by a duration.
  it('flags an all-day task so the template does not render an empty time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00'));
    const d = gatherTrmnlData({
      tasks: [
        { id: 'a', date: '2026-09-24', title: 'Conference', isAllDay: true, duration: 0 },
        // An all-day row that also carries a startTime. A recurring template
        // keeps its old startTime when it is made all-day, so the upcoming and
        // overdue filters cannot lean on a missing time to exclude it.
        { id: 'b', date: '2026-09-24', title: 'Summit', isAllDay: true, startTime: '16:00', duration: 0 },
        { id: 'c', date: '2026-09-24', title: 'Standup', isAllDay: true, startTime: '07:00', duration: 0 },
        { id: 'd', date: '2026-09-24', title: 'Ship', startTime: '14:00', duration: 60 },
      ],
      selectedDate: '2026-09-24',
      use24HourClock: true,
      t: i18n.getFixedT('en'),
      language: 'en',
    });
    // Keyed by title: the schedule is sorted by startTime, and the all-day rows
    // sit wherever their stale time puts them.
    expect(Object.fromEntries(d.schedule.map((s2) => [s2.title, s2.allDay]))).toEqual({
      Conference: true, Standup: true, Summit: true, Ship: false,
    });
    // An all-day row belongs to the day rather than to a moment, so it is
    // neither upcoming nor overdue even when it carries a stale startTime.
    expect(d.upcoming.map((u) => u.title)).toEqual(['Ship']);
    expect(d.overdue).toBe(0);
  });

  it('translates AM and PM on a 12-hour clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00'));
    const at = (lng) => gatherTrmnlData({
      tasks: [
        { id: 'a', date: '2026-09-24', title: 'Morning', startTime: '09:00', duration: 30 },
        { id: 'b', date: '2026-09-24', title: 'Afternoon', startTime: '14:00', duration: 30 },
      ],
      selectedDate: '2026-09-24',
      use24HourClock: false,
      t: i18n.getFixedT(lng),
      language: lng,
    }).schedule.map((s2) => s2.time);
    expect(at('en')).toEqual(['9:00 AM', '2:00 PM']);
    expect(at('de')).toEqual([`9:00 ${en.common.am === de.common.am ? 'AM' : de.common.am}`, `2:00 ${de.common.pm}`]);
  });

  // The locale decides where the cliff is: the same day is 5050 bytes at 28
  // tasks in Ukrainian and needs 39 to get there in English. A fixed row cap
  // would be wrong in one language or the other, so the budget is in bytes.
  it('keeps a heavy day inside the budget, in the language that costs most', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00'));
    const d = gatherTrmnlData({
      tasks: Array.from({ length: 40 }, (_, i) => ({
        id: `t${i}`, date: '2026-09-24', title: `Завдання ${i} з доволі довгою назвою`,
        startTime: `${String(6 + (i % 18)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
        duration: 45, priority: (i % 3) + 1,
      })),
      selectedDate: '2026-09-24',
      routinesEnabled: true,
      todayRoutines: Array.from({ length: 8 }, (_, i) => ({ name: `Розпорядок ${i}`, startTime: '23:00', duration: 30 })),
      habits: Array.from({ length: 5 }, (_, i) => ({ id: `h${i}`, name: `Звичка ${i}`, target: 3 })),
      dailyNotes: { '2026-09-24': { text: 'Нотатка '.repeat(12) } },
      t: i18n.getFixedT('uk'),
      language: 'uk',
    });
    const size = payloadBytes(d);
    expect(size, `payload is ${size} bytes`).toBeLessThanOrEqual(TRMNL_PAYLOAD_BUDGET_BYTES);
    // Trimmed for the display, honest about the day.
    expect(d.total).toBe(40);
    expect(d.schedule.length).toBeLessThan(40);
  });

  it('leaves the priority label empty when a task has none', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00'));
    const d = gatherTrmnlData({
      tasks: [{ id: 'a', date: '2026-09-24', title: 'Plain', startTime: '09:00', duration: 30 }],
      selectedDate: '2026-09-24',
      t: i18n.getFixedT('de'),
      language: 'de',
    });
    expect(d.schedule[0].pri).toBe('');
  });
});
