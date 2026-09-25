import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { groupWidgetNativeEvents, widgetDayTasks } from './widgetNativeEvents.js';
import { monthWindowFetchDates, buildWidgetMonthWindow, WIDGET_MONTH_PAYLOAD_DAYS } from './widgetMonthWindow.js';
import { nativeResultsToTasks } from './nativeCalendar.js';
import { dateToString } from './taskUtils.js';

let prevTZ;
beforeAll(() => { prevTZ = process.env.TZ; process.env.TZ = 'America/Denver'; });
afterAll(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

const WED = new Date(2026, 8, 23, 12);

// A bridge event as nativeGetEvents returns it.
const event = (id, date, start, end, over = {}) => ({
  id, title: `Event ${id}`, start: `${date}T${start}:00`, end: `${date}T${end}:00`, allDay: false,
  notes: '', location: '', calendarId: 'work', calendarName: 'Work', color: '#aa00ff', ...over,
});

describe('monthWindowFetchDates — the one source for the widget fetch', () => {
  it('is exactly the days buildWidgetMonthWindow reads', () => {
    for (const weekStartDay of [0, 1]) {
      const read = [];
      buildWidgetMonthWindow({ today: WED, weekStartDay, tasksForDate: (d) => { read.push(dateToString(d)); return []; } });
      expect(monthWindowFetchDates(WED, weekStartDay)).toEqual(read);
    }
  });

  it('is the day before the window, then its 49 days', () => {
    const dates = monthWindowFetchDates(WED, 0);
    expect(dates).toHaveLength(WIDGET_MONTH_PAYLOAD_DAYS + 1);
    expect(dates[0]).toBe('2026-09-19');
    expect(dates[1]).toBe('2026-09-20');
    expect(dates.at(-1)).toBe('2026-11-07');
  });

  it('covers the day-keyed projection too (today … today+3 and the days before)', () => {
    const dates = new Set(monthWindowFetchDates(WED, 1));
    for (const d of ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']) expect(dates.has(d)).toBe(true);
  });
});

describe('nativeResultsToTasks — shared by the view fetch and the widget fetch', () => {
  it('tags, filters by calendar, dedupes by occurrence and applies overrides', () => {
    const dates = ['2026-10-14', '2026-10-15'];
    const results = [
      [event('e1', '2026-10-14', '09:00', '10:00'), event('p1', '2026-10-14', '11:00', '12:00', { calendarId: 'personal' })],
      [event('e2', '2026-10-15', '14:00', '15:00'), event('e2', '2026-10-15', '14:00', '15:00')],
    ];
    const { events, tasks } = nativeResultsToTasks(results, dates, {
      calendarFilter: ['work'],
      overrides: { e2: { startTime: '16:00', title: 'Moved' } },
    });
    expect(events).toHaveLength(4);
    expect(events[0]._queryDate).toBe('2026-10-14');
    expect(tasks.map(t => t.nativeEventId)).toEqual(['e1', 'e2']);
    expect(tasks.every(t => t._native)).toBe(true);
    expect(tasks[1]).toMatchObject({ startTime: '16:00', title: 'Moved', isAllDay: false });
  });

  it('an empty filter keeps every calendar; a failed day contributes nothing', () => {
    const { tasks } = nativeResultsToTasks([null, [event('p1', '2026-10-15', '09:00', '10:00', { calendarId: 'personal' })]],
      ['2026-10-14', '2026-10-15']);
    expect(tasks.map(t => t.nativeEventId)).toEqual(['p1']);
  });
});

describe('widgetDayTasks', () => {
  const view = [
    { id: 'task', title: 'Mine', date: '2026-10-14', startTime: '08:00', duration: 30 },
    { id: 'stale-native', _native: true, title: 'From the view fetch', date: '2026-10-14', startTime: '09:00', duration: 60 },
  ];

  it('swaps in the widget fetch\'s device events on a covered day, keeping the app\'s own tasks', () => {
    const { tasks } = nativeResultsToTasks([[event('e1', '2026-10-14', '13:00', '14:00')]], ['2026-10-14']);
    const widgetNative = groupWidgetNativeEvents(['2026-10-14'], tasks);
    const out = widgetDayTasks('2026-10-14', view, widgetNative);
    expect(out.map(t => t.id)).toEqual(['task', tasks[0].id]);
  });

  it('a covered day with no events has none — the view\'s leftovers do not survive', () => {
    const out = widgetDayTasks('2026-10-14', view, groupWidgetNativeEvents(['2026-10-14'], []));
    expect(out.map(t => t.id)).toEqual(['task']);
  });

  it('a day outside the fetch (or a failed one), or before any fetch, is the app\'s list untouched', () => {
    expect(widgetDayTasks('2026-10-14', view, groupWidgetNativeEvents(['2026-10-15'], []))).toBe(view);
    expect(widgetDayTasks('2026-10-14', view, null)).toBe(view);
  });

  it('end to end: a device event six weeks out reaches the month window', () => {
    const dates = monthWindowFetchDates(WED, 0);
    const far = '2026-10-29';
    const results = dates.map(d => (d === far ? [event('late', far, '10:00', '11:30', { color: '#123456' })] : []));
    const { tasks } = nativeResultsToTasks(results, dates);
    const widgetNative = groupWidgetNativeEvents(dates, tasks);
    const w = buildWidgetMonthWindow({ today: WED, tasksForDate: (d) => widgetDayTasks(dateToString(d), [], widgetNative) });
    const day = w.days.find(x => x.date === far);
    expect(day.bars).toEqual([{ s: 600, d: 90, c: '#123456' }]);
  });
});
