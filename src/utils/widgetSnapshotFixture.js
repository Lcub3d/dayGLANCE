// A widget snapshot shaped like a LIVE push, built by the same producers the
// app's snapshot effect uses (buildProjectedDay → computeSkySnapshot,
// projectDialSnapshot), from a fixed day, place and task set. Written to
// dayglance-ios/TestFixtures/widgetSnapshot.live.json by `npm run
// ios:vectors` and consumed by the widget extension's own unit tests
// (dayglance-ios/DayGlanceWidgetTests), which push it through the widget's
// decoder, day resolution and face mapping and sample the rendered face.
//
// Why a second fixture next to dayDial.vectors.json: the vectors pin single
// functions. This pins the WHOLE payload the widget sees, so a field the JS
// side stops sending, or sends in a shape the strict Swift decoder rejects,
// fails a test here and in Swift instead of showing up as a blank ring on a
// phone. The DIAL_PREVIEW widget draws from a hand-made fixture and cannot
// catch that; this can. Same drift guard as the vectors:
// widgetSnapshotFixture.test.js fails when the committed file no longer
// matches what this builds.

import { buildProjectedDay, projectionDates, dateToString } from './widgetDayProjection.js';

export const LIVE_SNAPSHOT_TIMEZONE = 'America/Denver';
export const LIVE_SNAPSHOT_PATH = 'dayglance-ios/TestFixtures/widgetSnapshot.live.json';
/** Denver, the vectors' site: an ordinary sunrise and sunset, a real moon. */
export const LIVE_SNAPSHOT_COORDS = { lat: 39.7392, lon: -104.9903 };
/** Monday 2026-09-21, local noon. */
export const LIVE_SNAPSHOT_TODAY = () => new Date(2026, 8, 21, 12);

const task = (dateStr, over) => ({
  id: 'x', title: 'Untitled', color: 'bg-blue-500', date: dateStr,
  startTime: '09:00', duration: 60, tags: [], completed: false, projectId: null, ...over,
});

/** A plausible day: a done morning block, work, lunch, an evening event. */
export function liveFixtureTasks(dateStr) {
  return [
    task(dateStr, { id: `${dateStr}-run`, title: 'Run #health', startTime: '06:40', duration: 35, tags: ['health'], completed: true, color: 'bg-emerald-500' }),
    task(dateStr, { id: `${dateStr}-deep`, title: 'Deep work #deep [[Spec]]', startTime: '09:00', duration: 90, tags: ['deep'] }),
    task(dateStr, { id: `${dateStr}-standup`, title: 'Standup', startTime: '10:45', duration: 15, color: 'bg-purple-500' }),
    task(dateStr, { id: `${dateStr}-lunch`, title: 'Lunch', startTime: '12:15', duration: 45, color: 'bg-amber-500' }),
    task(dateStr, { id: `${dateStr}-review`, title: 'Review PRs', startTime: '14:05', duration: 55, color: 'bg-blue-500' }),
    task(dateStr, { id: `${dateStr}-dinner`, title: 'Dinner with Sam', startTime: '18:30', duration: 90, color: 'bg-rose-500' }),
    task(dateStr, { id: `${dateStr}-read`, title: 'Read', startTime: '21:00', duration: 40, color: 'bg-indigo-500' }),
  ];
}

export function buildLiveWidgetSnapshot() {
  const today = LIVE_SNAPSHOT_TODAY();
  const day = (date) => {
    const dateStr = dateToString(date);
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return buildProjectedDay({
      date,
      dateStr,
      dateLabel: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      dayTasks: liveFixtureTasks(dateStr),
      prevDayTasks: liveFixtureTasks(dateToString(prev)),
      dayWindow: { start: '06:30', stop: '22:30' },
      coords: LIVE_SNAPSHOT_COORDS,
    });
  };
  return {
    // The pushed day's fields at the top level, as App.jsx sends them, then
    // the day-invariant blocks, then the projected days.
    ...day(today),
    use24Hour: false,
    allGoals: [],
    allProjects: [],
    days: projectionDates(today).map(day),
    timezone: LIVE_SNAPSHOT_TIMEZONE,
    updatedAt: Date.UTC(2026, 8, 21, 18, 0, 0),
    reloadWidgets: true,
  };
}
