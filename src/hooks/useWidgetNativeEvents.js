// The widget snapshot's own device-calendar fetch: every day the month window
// reads (widgetMonthWindow.js monthWindowFetchDates — one source for both),
// whatever the app is showing. See utils/widgetNativeEvents.js for why.
//
// WHEN IT RUNS: on the first render with data, when the day rolls, when the
// week start or the calendar filter changes, when an event is edited in the
// app (nativeCalendarKey), and when the app returns to the foreground, at most
// every FOREGROUND_REFETCH_MS. That last one is how a change made in another
// app while this one was away gets in: the JS cannot run while the app is
// suspended, and iOS delivers a suspended app's EKEventStoreChanged on resume,
// i.e. at the same moment.
//
// COST: the mobile bridge is synchronous and per day, so 50 days are walked in
// week-sized chunks with a yield between, exactly as MONTH's view fetch does,
// and applied once at the end — a partial result would read as empty days.

import { useEffect, useRef, useState } from 'react';
import { nativeGetEvents } from '../native.js';
import { nativeResultsToTasks } from '../utils/nativeCalendar.js';
import { monthWindowFetchDates } from '../utils/widgetMonthWindow.js';
import { groupWidgetNativeEvents } from '../utils/widgetNativeEvents.js';

export const FOREGROUND_REFETCH_MS = 5 * 60 * 1000;
const CHUNK = 7;

/**
 * @param opts.enabled          Native app with device calendars and data loaded.
 * @param opts.todayKey         'YYYY-MM-DD' of today; rolls the window.
 * @param opts.weekStartDay     0 = Sunday, 1 = Monday.
 * @param opts.calendarFilter   Calendar ids to keep (empty: all).
 * @param opts.nativeCalendarKey Bumped when a device event is edited in the app.
 * @param opts.getEvents        Injected for tests; the bridge by default.
 * @returns groupWidgetNativeEvents(…) once a fetch has landed, else null.
 */
export function useWidgetNativeEvents({
  enabled, todayKey, weekStartDay, calendarFilter, nativeCalendarKey, getEvents = nativeGetEvents,
}) {
  const [result, setResult] = useState(null);
  const [foregroundTick, setForegroundTick] = useState(0);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchRef.current < FOREGROUND_REFETCH_MS) return;
      setForegroundTick(t => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !todayKey) return undefined;
    const dates = monthWindowFetchDates(new Date(`${todayKey}T12:00:00`), weekStartDay);
    let cancelled = false;
    const acc = new Array(dates.length).fill(null);
    let i = 0;
    const step = () => {
      if (cancelled) return;
      const end = Math.min(i + CHUNK, dates.length);
      for (; i < end; i++) {
        try { acc[i] = getEvents(dates[i]); } catch { acc[i] = null; }
      }
      if (i < dates.length) { setTimeout(step, 0); return; }
      let overrides = {};
      try { overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}'); } catch { /* none */ }
      const { tasks } = nativeResultsToTasks(acc, dates, { calendarFilter, overrides });
      lastFetchRef.current = Date.now();
      // Only days the bridge answered count as covered: a failed day is no
      // information, and must not replace the app's events with nothing.
      setResult(groupWidgetNativeEvents(dates.filter((_, k) => Array.isArray(acc[k])), tasks));
    };
    step();
    return () => { cancelled = true; };
  // calendarFilter is an array rebuilt on change only (useState), so identity is the change.
  }, [enabled, todayKey, weekStartDay, calendarFilter, nativeCalendarKey, foregroundTick, getEvents]);

  return enabled ? result : null;
}
