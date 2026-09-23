import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildWidgetMonthWindow, buildMonthDay, monthWindowStart, monthWindowDates, resolveMonthWindow,
  WIDGET_MONTH_WINDOW_DAYS, WIDGET_MONTH_PAYLOAD_DAYS, WIDGET_ROUTINE_HEX,
} from './widgetMonthWindow.js';
import { WIDGET_PROJECTION_DAYS, WIDGET_SNAPSHOT_CAP_BYTES, WIDGET_SNAPSHOT_WARN_BYTES, guardSnapshotSize } from './widgetDayProjection.js';
import { computeRecurringExpansionRange } from './recurringExpansionRange.js';
import { expandRecurringTasks } from './expandRecurringTasks.js';
import { evaluateSnapshotPush } from './widgetSnapshotDedupe.js';
import { buildLiveWidgetSnapshot, liveFixtureTasks } from './widgetSnapshotFixture.js';
import { dateToString } from './taskUtils.js';

// Pinned zone: the payload window below crosses the 1 Nov 2026 DST change.
let prevTZ;
beforeAll(() => { prevTZ = process.env.TZ; process.env.TZ = 'America/Denver'; });
afterAll(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

const d = (y, m, day) => new Date(y, m - 1, day, 12);
const plus = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12);
const WED = d(2026, 9, 23); // Wednesday
const str = (date) => dateToString(date);

const task = (over) => ({
  id: 't', title: 'Secret title #tag', color: 'bg-blue-500', startTime: '09:00', duration: 60,
  tags: ['tag'], completed: false, notes: 'private', projectId: 'p1', ...over,
});

const groupByDate = (list) => {
  const map = {};
  for (const t of list) (map[t.date] ||= []).push(t);
  return map;
};

/**
 * The app's path, minus React: range → expansion → per-date map → window.
 * `parkedOn` is where the user has navigated; the anchors must not care.
 */
function pipeline({ today, weekStartDay = 0, tasks = [], recurring = [], parkedOn = today, routinesForDate }) {
  const { rangeStart, rangeEnd } = computeRecurringExpansionRange({
    visibleDates: [parkedOn], selectedDate: parkedOn, schedDaysShown: 1, today, weekStartDay,
  });
  const instances = expandRecurringTasks(recurring, { rangeStart, rangeEnd, today: str(today) });
  const byDate = groupByDate([...tasks, ...instances]);
  return buildWidgetMonthWindow({
    today, weekStartDay, tasksForDate: (date) => byDate[str(date)] || [], routinesForDate,
  });
}

describe('window boundaries', () => {
  it.each([
    // [today, weekStartDay, expected first day]
    [WED, 0, '2026-09-20'],                // mid-week, Sunday weeks
    [WED, 1, '2026-09-21'],                // mid-week, Monday weeks
    [d(2026, 9, 20), 0, '2026-09-20'],     // today IS the first day of the week
    [d(2026, 9, 26), 0, '2026-09-20'],     // today is the LAST day of the week
    [d(2026, 9, 20), 1, '2026-09-14'],     // Sunday with Monday weeks: previous Monday
    [d(2026, 10, 1), 0, '2026-09-27'],     // week straddles a month boundary
    [d(2027, 1, 1), 1, '2026-12-28'],      // and a year boundary
  ])('today %s, weekStart %i → from %s', (today, weekStartDay, from) => {
    const w = buildWidgetMonthWindow({ today, weekStartDay });
    expect(w.from).toBe(from);
    expect(w.weekStart).toBe(weekStartDay);
    expect(w.days[0].date).toBe(from);
    expect(w.days).toHaveLength(WIDGET_MONTH_PAYLOAD_DAYS);
    // The 42-day grid contains today, in its first row.
    const idx = w.days.findIndex(x => x.date === str(today));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(7);
  });

  it('is 42 grid days plus a 7-day tail, contiguous across the DST change', () => {
    expect(WIDGET_MONTH_WINDOW_DAYS).toBe(42);
    expect(WIDGET_MONTH_PAYLOAD_DAYS).toBe(49);
    const dates = monthWindowDates(WED, 0).map(str);
    expect(dates[0]).toBe('2026-09-20');
    expect(dates[41]).toBe('2026-10-31');
    expect(dates[48]).toBe('2026-11-07');
    expect(dates).toContain('2026-11-01'); // DST ends in Denver
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i] + 'T12:00:00') - new Date(dates[i - 1] + 'T12:00:00')) / 86400000;
      expect(Math.round(gap), `${dates[i - 1]} → ${dates[i]}`).toBe(1);
    }
  });

  it('every grid starts on the configured weekday', () => {
    for (let i = 0; i < 14; i++) {
      for (const ws of [0, 1]) {
        expect(monthWindowStart(plus(WED, i), ws).getDay()).toBe(ws);
      }
    }
  });
});

describe('what a day carries', () => {
  const DAY = '2026-09-24';
  const build = (over = {}) => buildMonthDay({ dateStr: DAY, ...over });

  it('bars are {s, d, c} only — no titles, ids, tags, notes or projects', () => {
    const day = build({ dayTasks: [task({ date: DAY })] });
    expect(day).toEqual({ date: DAY, bars: [{ s: 540, d: 60, c: '#3b82f6' }], allDay: [], deadlines: [] });
    expect(JSON.stringify(day)).not.toMatch(/Secret|private|tag|p1/);
  });

  it('bars are in start order and colors are resolved hex, native calendar color first', () => {
    const day = build({ dayTasks: [
      task({ startTime: '14:30', duration: 30, color: 'bg-rose-500' }),
      task({ startTime: '07:05', duration: 25, color: '#123456' }),
      task({ startTime: '11:00', duration: 45, color: 'bg-rose-500', nativeCalendarColor: '#abcdef' }),
    ] });
    expect(day.bars.map(b => b.s)).toEqual([425, 660, 870]);
    expect(day.bars.map(b => b.c)).toEqual(['#123456', '#abcdef', '#f43f5e']);
  });

  it('keeps completed blocks (shape of the day), drops examples, untimed and zero-length ones', () => {
    const day = build({ dayTasks: [
      task({ id: 'done', completed: true }),
      task({ id: 'ex', isExample: true, startTime: '10:00' }),
      task({ id: 'untimed', startTime: '' }),
      task({ id: 'zero', startTime: '12:00', duration: 0 }),
    ] });
    expect(day.bars).toEqual([{ s: 540, d: 60, c: '#3b82f6' }]);
  });

  it('all-day items and deadlines are per-day color lists, never bars', () => {
    const day = build({
      dayTasks: [
        task({ isAllDay: true, startTime: '', duration: 0, color: 'bg-amber-500' }),
        task({ isAllDay: true, startTime: '09:00', duration: 60, color: 'bg-green-500' }), // all-day wins over a stale time
        task({ isAllDay: true, completed: true, color: 'bg-red-500' }),
      ],
      deadlineTasks: [{ color: 'bg-red-500' }, { color: 'bg-red-500', completed: true }],
    });
    expect(day.bars).toEqual([]);
    expect(day.allDay).toEqual(['#f59e0b', '#22c55e']);
    expect(day.deadlines).toEqual(['#ef4444']);
  });

  it('a block past midnight is clipped, and its remainder opens the next day', () => {
    const late = task({ startTime: '23:00', duration: 150, color: 'bg-indigo-500' });
    expect(build({ dayTasks: [late] }).bars).toEqual([{ s: 1380, d: 60, c: '#6366f1' }]);
    expect(build({ prevDayTasks: [late] }).bars).toEqual([{ s: 0, d: 90, c: '#6366f1' }]);
  });

  it('carries into the FIRST day of the window from the day before it', () => {
    const byDate = { '2026-09-19': [task({ startTime: '22:00', duration: 180 })] };
    const w = buildWidgetMonthWindow({ today: WED, tasksForDate: (date) => byDate[str(date)] || [] });
    expect(w.days[0].bars).toEqual([{ s: 0, d: 60, c: '#3b82f6' }]);
  });

  it('routines are bars on the day the caller supplies them for, in the routine color', () => {
    const routine = { id: 'r', name: 'Stretch', startTime: '07:00', duration: 15 };
    const w = buildWidgetMonthWindow({
      today: WED,
      routinesForDate: (ds) => (ds === str(WED) ? [routine, { id: 'u', name: 'Unplaced' }] : []),
    });
    const withBars = w.days.filter(x => x.bars.length);
    expect(withBars.map(x => x.date)).toEqual([str(WED)]);
    expect(withBars[0].bars).toEqual([{ s: 420, d: 15, c: WIDGET_ROUTINE_HEX }]);
  });
});

describe('recurrence across the full window', () => {
  const daily = { id: 'daily', title: 'Standup', startTime: '09:30', duration: 15, color: 'bg-purple-500',
    recurrence: { type: 'daily', startDate: '2026-01-01' } };
  const weekly = { id: 'weekly', title: 'Gym', startTime: '18:00', duration: 60, color: 'bg-emerald-500',
    recurrence: { type: 'weekly', daysOfWeek: [2, 4], startDate: '2026-01-01' } };
  const monthly = { id: 'monthly', title: 'Rent', isAllDay: true, color: 'bg-red-500',
    recurrence: { type: 'monthly', monthDay: 1, startDate: '2026-01-01' } };
  const lateWeekly = { id: 'late', title: 'Night shift', startTime: '22:00', duration: 240, color: 'bg-indigo-500',
    recurrence: { type: 'weekly', daysOfWeek: [6], startDate: '2026-01-01' } };
  const recurring = [daily, weekly, monthly, lateWeekly];

  // Parked on last month: nothing the user is looking at reaches the window,
  // so every instance below exists only because of the month-window anchor.
  const w = pipeline({ today: WED, recurring, parkedOn: plus(WED, -35) });
  const byDate = Object.fromEntries(w.days.map(x => [x.date, x]));
  const hasBar = (ds, c, s) => byDate[ds].bars.some(b => b.c === c && b.s === s);

  it('a daily series has a bar on today and every day after it, through the last payload day', () => {
    const today = str(WED);
    for (const day of w.days.filter(x => x.date >= today)) {
      expect(hasBar(day.date, '#a855f7', 570), day.date).toBe(true);
    }
    expect(hasBar('2026-11-07', '#a855f7', 570)).toBe(true);
  });

  it('a weekly series lands on exactly its weekdays in all seven weeks', () => {
    const expected = w.days
      .filter(x => x.date >= str(WED))
      .filter(x => [2, 4].includes(new Date(x.date + 'T12:00:00').getDay()))
      .map(x => x.date);
    const actual = w.days.filter(x => hasBar(x.date, '#10b981', 1080)).map(x => x.date);
    expect(actual).toEqual(expected);
    expect(actual.at(-1)).toBe('2026-11-05'); // the rollover tail, not just the grid
  });

  it('a monthly all-day series lands in allDay on the 1st of each month in the window', () => {
    const firsts = w.days.filter(x => x.allDay.includes('#ef4444')).map(x => x.date);
    expect(firsts).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('a recurring overnight block carries into the next day, including across the DST change', () => {
    // Saturdays 22:00 + 4h: Sunday gets 0–120.
    expect(byDate['2026-10-31'].bars).toContainEqual({ s: 1320, d: 120, c: '#6366f1' });
    expect(byDate['2026-11-01'].bars).toContainEqual({ s: 0, d: 120, c: '#6366f1' });
  });

  it('past days of the current week follow the app: completed instances show, missed ones do not', () => {
    const doneMonday = { ...daily, completedDates: ['2026-09-21'] };
    const w2 = pipeline({ today: WED, recurring: [doneMonday] });
    const bars = (ds) => w2.days.find(x => x.date === ds).bars;
    expect(bars('2026-09-20')).toEqual([]);                            // missed, in the past
    expect(bars('2026-09-21')).toEqual([{ s: 570, d: 15, c: '#a855f7' }]); // done
    expect(bars('2026-09-23')).toEqual([{ s: 570, d: 15, c: '#a855f7' }]); // today
  });

  it('honours skipped exceptions and per-instance overrides', () => {
    const edited = { ...daily, exceptions: {
      '2026-10-14': { skipped: true },
      '2026-10-15': { startTime: '11:00', color: 'bg-amber-500' },
    } };
    const w2 = pipeline({ today: WED, recurring: [edited] });
    const bars = (ds) => w2.days.find(x => x.date === ds).bars;
    expect(bars('2026-10-14')).toEqual([]);
    expect(bars('2026-10-15')).toEqual([{ s: 660, d: 15, c: '#f59e0b' }]);
  });
});

describe('rollover', () => {
  // A push made at `pushDay` and never refreshed: what does the widget draw
  // on each later local day, and does it match what a fresh push would say?
  const tasks = [];
  for (let i = -10; i < 70; i++) {
    const ds = str(plus(WED, i));
    tasks.push(task({ id: `t${i}`, date: ds, startTime: `${String(6 + (i % 12 + 12) % 12).padStart(2, '0')}:00` }));
  }
  const recurring = [{ id: 'w', startTime: '18:00', duration: 60, color: 'bg-emerald-500',
    recurrence: { type: 'weekly', daysOfWeek: [1], startDate: '2026-01-01' } }];

  it('a stale push resolves to the SAME 42 days a fresh build would, for every day up to the projection horizon', () => {
    for (let p = 0; p < 7; p++) {                 // push on each weekday
      for (const weekStartDay of [0, 1]) {
        const pushDay = plus(WED, p);
        const stored = pipeline({ today: pushDay, weekStartDay, tasks, recurring });
        for (let k = 0; k <= WIDGET_PROJECTION_DAYS; k++) {
          const later = plus(pushDay, k);
          const drawn = resolveMonthWindow(stored, str(later));
          expect(drawn, `push ${str(pushDay)} ws${weekStartDay}, drawn on ${str(later)}`).not.toBeNull();
          const fresh = pipeline({ today: later, weekStartDay, tasks, recurring });
          // Past days in a fresh build drop missed recurring instances that the
          // stale push still has; compare from the later day on, and the dates
          // everywhere.
          expect(drawn.map(x => x.date)).toEqual(fresh.days.slice(0, 42).map(x => x.date));
          const from = drawn.findIndex(x => x.date === str(later));
          expect(drawn.slice(from)).toEqual(fresh.days.slice(from, 42));
        }
      }
    }
  });

  it('crossing a week boundary moves the grid down a row, served from the tail', () => {
    const stored = pipeline({ today: d(2026, 9, 26), weekStartDay: 0, tasks }); // Saturday
    expect(resolveMonthWindow(stored, '2026-09-26')[0].date).toBe('2026-09-20');
    const sunday = resolveMonthWindow(stored, '2026-09-27');
    expect(sunday[0].date).toBe('2026-09-27');
    expect(sunday[41].date).toBe('2026-11-07'); // last tail day
  });

  it('without the tail, that same rollover would leave the bottom row empty', () => {
    const stored = pipeline({ today: d(2026, 9, 26), weekStartDay: 0, tasks });
    const truncated = { ...stored, days: stored.days.slice(0, WIDGET_MONTH_WINDOW_DAYS) };
    expect(resolveMonthWindow(truncated, '2026-09-27')).toBeNull();
  });

  it('too old or before the window: null, so the widget shows its stale state', () => {
    const stored = pipeline({ today: WED, tasks });
    expect(resolveMonthWindow(stored, '2026-10-04')).toBeNull(); // two week-boundaries later
    expect(resolveMonthWindow(stored, '2026-09-19')).toBeNull(); // before `from`
    expect(resolveMonthWindow(null, '2026-09-23')).toBeNull();
  });

  it('a fresh build on the new day is a new window (the foreground path)', () => {
    const sat = pipeline({ today: d(2026, 9, 26), tasks });
    const sun = pipeline({ today: d(2026, 9, 27), tasks });
    expect(sat.from).toBe('2026-09-20');
    expect(sun.from).toBe('2026-09-27');
  });
});

describe('gate rule: monthWindow is hot across all of it', () => {
  const base = () => ({
    date: '2026-09-23',
    sections: [],
    days: [{ date: '2026-09-24', x: 1 }, { date: '2026-09-25', x: 1 }, { date: '2026-09-26', x: 1 }],
    monthWindow: pipeline({ today: WED, tasks: [task({ date: '2026-09-23' })] }),
    updatedAt: 1,
  });
  const first = evaluateSnapshotPush(base(), '');

  it.each([0, 20, 41, 48])('a change on payload day %i pushes AND reloads', (i) => {
    const s = base();
    s.monthWindow.days[i].bars.push({ s: 600, d: 30, c: '#000000' });
    const r = evaluateSnapshotPush(s, first.fingerprint);
    expect(r).toMatchObject({ push: true, reload: true });
  });

  it('an all-day or deadline change deep in the window reloads too', () => {
    const s = base();
    s.monthWindow.days[35].deadlines.push('#ef4444');
    expect(evaluateSnapshotPush(s, first.fingerprint)).toMatchObject({ push: true, reload: true });
  });

  it('a rolled window (new `from`) reloads', () => {
    const s = base();
    s.monthWindow = pipeline({ today: d(2026, 9, 27) });
    expect(evaluateSnapshotPush(s, first.fingerprint)).toMatchObject({ push: true, reload: true });
  });

  it('the existing rule is intact: days[2] alone is stored without a reload', () => {
    const s = base();
    s.days[2].x = 2;
    expect(evaluateSnapshotPush(s, first.fingerprint)).toMatchObject({ push: true, reload: false });
  });

  it('an unchanged window with a new updatedAt does not push', () => {
    const s = base();
    s.updatedAt = 999;
    expect(evaluateSnapshotPush(s, first.fingerprint)).toMatchObject({ push: false, reload: false });
  });
});

describe('size against the 400 KB App Group cap', () => {
  // A realistic busy six weeks: the live fixture's seven blocks every day
  // (one of them completed), a daily standup and a Tue/Thu series on top,
  // an all-day item every few days and a deadline twice a week.
  const busyTasks = [];
  for (let i = -8; i < 60; i++) {
    const ds = str(plus(WED, i));
    busyTasks.push(...liveFixtureTasks(ds).map(t => ({ ...t, date: ds })));
    if (i % 3 === 0) busyTasks.push(task({ id: `ad${i}`, date: ds, isAllDay: true, startTime: '', duration: 0, color: 'bg-amber-500' }));
  }
  const busyRecurring = [
    { id: 'su', startTime: '10:00', duration: 15, color: 'bg-purple-500', recurrence: { type: 'daily', startDate: '2026-01-01' } },
    { id: 'gy', startTime: '17:30', duration: 60, color: 'bg-emerald-500', recurrence: { type: 'weekly', daysOfWeek: [2, 4], startDate: '2026-01-01' } },
  ];
  const deadlines = (ds) => ([1, 4].includes(new Date(ds + 'T12:00:00').getDay()) ? [{ color: 'bg-red-500' }] : []);

  const busyWindow = () => {
    const { rangeStart, rangeEnd } = computeRecurringExpansionRange({ selectedDate: WED, today: WED });
    const byDate = groupByDate([...busyTasks, ...expandRecurringTasks(busyRecurring, { rangeStart, rangeEnd, today: str(WED) })]);
    return buildWidgetMonthWindow({ today: WED, tasksForDate: (date) => byDate[str(date)] || [], deadlinesForDate: deadlines });
  };
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

  it('the busy window alone is small, and the whole snapshot stays under the warning line', () => {
    const monthWindow = busyWindow();
    const windowBytes = bytes(monthWindow);
    const snapshot = { ...buildLiveWidgetSnapshot(), monthWindow };
    const total = bytes(snapshot);
    // Measured 2026-09-23: window 15,738 B (49 days, 402 bars, ~320 B/day;
    // 13,473 B for the 42 grid days alone) on a 15,751 B live snapshot,
    // 31,504 B together — under 8% of the cap.
    expect(windowBytes).toBeLessThan(20_000);
    expect(total).toBeLessThan(WIDGET_SNAPSHOT_WARN_BYTES);
    expect(guardSnapshotSize(snapshot, { log: { warn: () => {}, error: () => {} } }).dropped).toBe(false);
  });

  it('even a 30-block-a-day window fits well under the cap', () => {
    const heavy = [];
    for (let i = -8; i < 60; i++) {
      const ds = str(plus(WED, i));
      for (let k = 0; k < 30; k++) {
        heavy.push(task({ date: ds, startTime: `${String(6 + Math.floor(k / 2)).padStart(2, '0')}:${k % 2 ? '30' : '00'}`, duration: 25, color: '#a1b2c3' }));
      }
    }
    const byDate = groupByDate(heavy);
    const w = buildWidgetMonthWindow({ today: WED, tasksForDate: (date) => byDate[str(date)] || [] });
    expect(bytes(w)).toBeLessThan(WIDGET_SNAPSHOT_CAP_BYTES / 4);
  });
});

describe('guardSnapshotSize with a month window', () => {
  const quiet = { warn: () => {}, error: () => {} };
  it('sheds monthWindow before days', () => {
    const snap = { date: 'x', days: [{ pad: 'a'.repeat(40) }], monthWindow: { days: [{ pad: 'b'.repeat(200) }] } };
    const r = guardSnapshotSize(snap, { cap: 150, warn: 100, log: quiet });
    expect(r.droppedFields).toEqual(['monthWindow']);
    expect(JSON.parse(r.json)).toEqual({ date: 'x', days: [{ pad: 'a'.repeat(40) }] });
  });

  it('sheds both when one is not enough', () => {
    const snap = { date: 'x', days: [{ pad: 'a'.repeat(200) }], monthWindow: { days: [{ pad: 'b'.repeat(200) }] } };
    const r = guardSnapshotSize(snap, { cap: 100, warn: 50, log: quiet });
    expect(r.droppedFields).toEqual(['monthWindow', 'days']);
    expect(JSON.parse(r.json)).toEqual({ date: 'x' });
  });
});
