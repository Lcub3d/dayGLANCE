// The band of hours WEEK draws, and the labels for its edges.
//
// WEEK does not scroll: it divides the available height by the number of hours
// on show, so the window is what decides whether a row is readable. A full day
// in a laptop's viewport gives rows too short to hold a task chip comfortably,
// which is the whole reason the bounds exist — an 07:00 to 22:00 window is 15
// rows in the space 24 used to take, so each is 60% taller for nothing.
//
// Both bounds come from localStorage and are therefore arbitrary: a hand-edited
// value, a future settings change, or a merge from a device with different
// options can all produce a pair that does not describe a band at all. The
// window is resolved here rather than inline so those cases have one answer
// instead of a grid with zero or negative rows.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Resolve the hour band WEEK should draw.
 *
 * @param {number} startHour  first hour shown, 0-23
 * @param {number} endHour    exclusive last hour, 1-24 (24 = midnight, no trim)
 * @param {boolean} showAll   the gutter's escape hatch, which restores the day
 * @returns {{ startHour: number, endHour: number, visibleHours: number }}
 */
export function weekWindow({ startHour = 0, endHour = 24, showAll = false } = {}) {
  if (showAll) return { startHour: 0, endHour: 24, visibleHours: 24 };
  const start = Number.isFinite(startHour) ? clamp(Math.trunc(startHour), 0, 23) : 0;
  // At least one hour wide, whatever the stored end says. An end at or before
  // the start would otherwise render no rows and divide the height by zero.
  const end = Number.isFinite(endHour) ? clamp(Math.trunc(endHour), start + 1, 24) : 24;
  return { startHour: start, endHour: end, visibleHours: end - start };
}

/**
 * Gutter-sized hour label ("7AM", "10PM", "07:00"). No space before the meridiem,
 * because the gutter is narrow enough that one matters. 24 is the end of the day
 * and reads as midnight.
 */
export function compactHourLabel(hour, use24HourClock) {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (use24HourClock) return `${String(h).padStart(2, '0')}:00`;
  if (h === 0) return '12AM';
  if (h === 12) return '12PM';
  return h < 12 ? `${h}AM` : `${h - 12}PM`;
}

/**
 * How many of `tasks` start outside the window, split by which side.
 *
 * WEEK's container clips rather than scrolls, so a task outside the band simply
 * is not there — no scrollbar, no edge, nothing. That is tolerable for a bound
 * you chose, and intolerable without a way to know it is happening, which is
 * what these counts are for: the gutter's toggle can say how much it is hiding.
 *
 * Counted by START hour, so a task that begins inside the window and runs past
 * its end is not "hidden" — its chip is on screen. All-day items live in their
 * own row above the grid and are never clipped by the band.
 */
export function clippedCounts(tasks, { startHour = 0, endHour = 24 } = {}) {
  let above = 0;
  let below = 0;
  for (const task of tasks || []) {
    if (!task || task.isAllDay || !task.startTime) continue;
    const hour = Number(String(task.startTime).split(':')[0]);
    if (!Number.isFinite(hour)) continue;
    if (hour < startHour) above += 1;
    else if (hour >= endHour) below += 1;
  }
  return { above, below };
}
