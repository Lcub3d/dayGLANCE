// Slice 6: past days show what was done (docs/jobo-past-days.md), and its
// addendum: today too, split at the NOW line.
//
// Pure. The rule decides what a date shows in DAY, MULTI, WEEK and MONTH: a
// task's timed Do on that date are drawn, and a COMPLETED task's plan block
// gives way to them once the block has ended (on a past day, every block
// has); an unfinished task keeps its block beside its Do, so what is still
// owed stays in sight (Lcub3d on #1726). A task without Do shows as it
// stood; unlinked Do, and Do whose task is gone, show too. Only measured facts leave JOBO, so records
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

// The tasks with Do on the date that the viewer may see, by id.
function coveredIds({ dateStr, index, isVisibleForUser }) {
  const visible = (task) => !task || typeof isVisibleForUser !== 'function' || isVisibleForUser(task);
  const covered = new Set();
  for (const slice of index?.slicesByDate?.get(dateStr) || []) {
    const task = index.resolveTask(slice.record);
    if (task && visible(task)) covered.add(String(task.id));
  }
  return covered;
}

const planEndMinute = (task) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(task?.startTime || '');
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + (Number(task.duration) || 0);
};

/**
 * Today's tasks whose plan block has given way to their Do: completed, with
 * timed Do today, and the block over (its planned end at or before
 * `nowMinute`). All-day tasks have no end before midnight and are never in
 * it. The views read today through this set rather than the clock, so they
 * recompute only when it changes, at a block's end or a completion, not on
 * every tick. Returns the ids, and a `key` that changes only with them.
 *
 * @returns {{ ids: Set<string>, key: string }}
 */
export function todayEndedTasks({ dateStr, dayTasks = [], index, isVisibleForUser, nowMinute } = {}) {
  const covered = coveredIds({ dateStr, index, isVisibleForUser });
  const ids = new Set();
  if (covered.size && Number.isFinite(nowMinute)) {
    for (const task of dayTasks) {
      if (!task || task.isAllDay || !task.completed || !covered.has(String(task.id))) continue;
      const end = planEndMinute(task);
      if (end !== null && end <= nowMinute) ids.add(String(task.id));
    }
  }
  return { ids, key: [...ids].sort().join('|') };
}

/**
 * What a date shows: the day's tasks, less the completed ones whose Do was
 * recorded that day, plus a task-shaped, read-only item for each timed Do
 * slice. An unfinished task keeps its plan block beside its Do. On today,
 * `replaceIds` (todayEndedTasks) further limits the blocks that give way to
 * those that have ended; on a past day it is left out, since every block
 * has. The caller decides the date and that the JOBO flag is on; this only
 * applies the rule. `dayTasks` is what the view would otherwise show for
 * the date, unchanged in order.
 */
export function pastDayItems({ dateStr, dayTasks = [], index, isVisibleForUser, replaceIds = null } = {}) {
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
  // A plan block gives way to its Do only once the task is done, and on
  // today only once the block is over too.
  const givesWay = (task) => covered.has(String(task?.id)) && !!task.completed
    && (!replaceIds || replaceIds.has(String(task.id)));
  const shown = dayTasks.filter((task) => !givesWay(task));
  doItems.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  return [...shown, ...doItems];
}

/**
 * What a view shows for a date: `dayTasks` unchanged for later days, or with
 * no index (JOBO off, ledger not loaded); otherwise the rule. Today takes it
 * only with `todayEnded` (todayEndedTasks' ids), which the caller derives
 * from the clock; without it, today is unchanged. A Do carries its task's
 * title, tags included, so `tagFilter` (the views' tag filter, when they
 * apply one) holds it to the same rule as the task.
 */
export function pastDayDisplay({ dateStr, todayStr, dayTasks = [], index, isVisibleForUser, tagFilter, todayEnded = null } = {}) {
  if (!index || !dateStr || !todayStr || dateStr > todayStr) return dayTasks;
  if (dateStr === todayStr && !todayEnded) return dayTasks;
  const items = pastDayItems({ dateStr, dayTasks, index, isVisibleForUser, replaceIds: dateStr === todayStr ? todayEnded : null });
  return items === dayTasks || typeof tagFilter !== 'function' ? items : tagFilter(items);
}

/**
 * Each task's timed Do on one date, by task id: what SCHED's Do badge shows
 * on a task's card. The same slices, resolution and visibility as the
 * past-day rule, so a badge and the striped cards in DAY, MULTI and WEEK
 * always agree. Unlinked Do, and Do whose task is gone, have no card to sit
 * on and are left out. Sessions run in time order.
 *
 * @returns {Map<string, { recordId: string, startMinute: number, endMinute: number, progress: string, clippedStart: boolean, clippedEnd: boolean }[]>}
 */
export function doSessionsByTask({ dateStr, index, isVisibleForUser } = {}) {
  const byTask = new Map();
  for (const slice of index?.slicesByDate?.get(dateStr) || []) {
    const task = index.resolveTask(slice.record);
    if (!task) continue;
    if (typeof isVisibleForUser === 'function' && !isVisibleForUser(task)) continue;
    const key = String(task.id);
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push({
      recordId: slice.record.id,
      startMinute: slice.startMinute,
      endMinute: slice.endMinute,
      progress: slice.record.progress,
      clippedStart: !!slice.clippedStart,
      clippedEnd: !!slice.clippedEnd,
    });
  }
  for (const sessions of byTask.values()) sessions.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  return byTask;
}
