// The nightly page reload that resets the timeline to the new day (App.jsx).
//
// WHY 30 SECONDS AFTER MIDNIGHT, NOT ONE: the routine day-rollover in
// useRoutines runs on the app clock tick, which fires every 15s at an
// arbitrary offset. A reload at 00:00:01 raced it — on the nights the tick
// landed inside that first second the in-app rollover ran and was torn down
// mid-flight by the reload; on every other night the reload won and the
// launch-on-a-new-day path handled the date change instead. Two code paths
// for one event, chosen by chance. That race is how a sync cycle once pushed
// yesterday's routine completions stamped at today's midnight (the seed of the
// routineCompletions push loop, PRs #1674 / #1679).
//
// 30s is past the worst-case first tick (14.99s), the file-tier upload
// debounce (5s) and a vault sync cycle, so the in-app rollover ALWAYS runs
// and settles before the reload. Longer buys nothing.
export const MIDNIGHT_REFRESH_OFFSET_SECONDS = 30;

// Milliseconds from `now` until the next local 00:00:30. Built from local
// setDate/setHours so a DST change overnight still lands on the local clock
// time, not 24h later.
export const msUntilMidnightRefresh = (now = new Date()) => {
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(0, 0, MIDNIGHT_REFRESH_OFFSET_SECONDS, 0);
  return target.getTime() - now.getTime();
};
