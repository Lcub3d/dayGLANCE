// Slice 6: past days show what was done (docs/jobo-past-days.md).
//
// Pure. The rule decides what a date before today shows in DAY, MULTI,
// WEEK and MONTH: a task with timed Do on that date shows its Do instead of
// its plan block; a task without shows as it stood; unlinked Do, and Do
// whose task is gone, show too. Only measured facts leave JOBO, so records
// whose interval was inferred from a plan duration stay out, as do JOBO's
// display-only estimates, which are never stored.
//
// The index is built once, not per day (MONTH asks for 42 days a render),
// in two parts memoized apart: the date slices on the ledger, the task
// resolver on the tasks. It reads the ledger through the same projection and
// task resolution as the JOBO view, so a record means the same thing
// everywhere. Nothing here writes.
import { DO_TIMING } from './core.js';
import { projectJoboRecords, timedSliceOnDate, buildJoboTaskResolver } from './viewModel.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
// A malformed or runaway interval must not stall a render: an attempt longer
// than this is still indexed, but only on its first and last days.
const MAX_SPAN_DAYS = 14;

const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const addDays = (dateStr, days) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// The civil dates an interval touches, first to last.
function datesCovered(record) {
  if (!DATE_RE.test(record.date) || !DATE_RE.test(record.endDate)) return [];
  const span = Math.round((Date.parse(`${record.endDate}T00:00:00Z`) - Date.parse(`${record.date}T00:00:00Z`)) / DAY_MS);
  if (!(span >= 0)) return [];
  if (span > MAX_SPAN_DAYS) return [record.date, record.endDate];
  return Array.from({ length: span + 1 }, (_, i) => addDays(record.date, i));
}

/**
 * Timed Do by the civil date they touch. Depends on the ledger alone, and
 * holds nearly all the cost (the projection validates every record), so the
 * caller memoizes it on the records and a task edit does not rebuild it.
 */
export function buildPastDaySlices(records = []) {
  const { liveRecords } = projectJoboRecords(records);
  const slicesByDate = new Map();
  for (const record of liveRecords) {
    if (record.timing !== DO_TIMING.TIMED || record.timingBasis === 'planDuration') continue;
    for (const date of datesCovered(record)) {
      const slice = timedSliceOnDate(record, date);
      if (!slice) continue;
      if (!slicesByDate.has(date)) slicesByDate.set(date, []);
      slicesByDate.get(date).push({ record, ...slice });
    }
  }
  return { slicesByDate, liveRecords };
}

/**
 * The index the rule reads: the date slices, and the resolver from a record
 * to its task as it stands, the JOBO view's own. `taskLookup` is every task
 * list that can own a record (scheduled, Inbox, expanded recurring
 * occurrences); recurring templates fill in occurrences outside the expanded
 * window. Pass `slices` from a memoized buildPastDaySlices to rebuild only
 * the resolver (cheap) when tasks change.
 */
export function buildPastDayIndex({ records = [], slices = buildPastDaySlices(records), taskLookup = [], recurringTasks = [] } = {}) {
  const resolveTask = buildJoboTaskResolver({ records: slices.liveRecords, taskLookup, recurringTasks });
  return { slicesByDate: slices.slicesByDate, resolveTask };
}

/**
 * What a date before today shows: the day's tasks, less those whose Do was
 * recorded that day, plus a task-shaped, read-only item for each timed Do
 * slice. The caller decides that the date is past and the JOBO flag is on;
 * this only applies the rule. `dayTasks` is what the view would otherwise
 * show for the date, unchanged in order.
 */
export function pastDayItems({ dateStr, dayTasks = [], index, isVisibleForUser } = {}) {
  const slices = index?.slicesByDate?.get(dateStr) || [];
  if (!slices.length) return dayTasks;
  const visible = (task) => !task || typeof isVisibleForUser !== 'function' || isVisibleForUser(task);
  const covered = new Set();
  const doItems = [];
  for (const slice of slices) {
    const { record } = slice;
    const task = index.resolveTask(record);
    // Another household member's Do never appears, as in the JOBO view.
    if (!visible(task)) continue;
    if (task) covered.add(String(task.id));
    doItems.push({
      id: `jobo-do:${record.id}:${dateStr}`,
      title: task?.title ?? record.title,
      color: task?.color ?? null,
      date: dateStr,
      startTime: clock(slice.startMinute),
      duration: slice.endMinute - slice.startMinute,
      isAllDay: false,
      completed: false,
      projectId: task?.projectId ?? null,
      // Read-only: views draw it striped and take no gestures on it.
      joboDo: true,
      joboRecordId: record.id,
      joboTaskId: task?.id ?? null,
      joboProgress: record.progress,
      // The part of the attempt that falls outside this day.
      joboClippedStart: slice.clippedStart,
      joboClippedEnd: slice.clippedEnd,
    });
  }
  const shown = dayTasks.filter((task) => !covered.has(String(task?.id)));
  doItems.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  return [...shown, ...doItems];
}

/**
 * What a view shows for a date: `dayTasks` unchanged for today and later, or
 * with no index (JOBO off, ledger not loaded); otherwise the past-day rule.
 * A Do carries its task's title, tags included, so `tagFilter` (the views'
 * tag filter, when they apply one) holds it to the same rule as the task.
 */
export function pastDayDisplay({ dateStr, todayStr, dayTasks = [], index, isVisibleForUser, tagFilter } = {}) {
  if (!index || !dateStr || !todayStr || dateStr >= todayStr) return dayTasks;
  const items = pastDayItems({ dateStr, dayTasks, index, isVisibleForUser });
  return items === dayTasks || typeof tagFilter !== 'function' ? items : tagFilter(items);
}
