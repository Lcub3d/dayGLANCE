import {
  DO_TIMING,
  TIMING_SUMMARY,
  compareExecutionToPlan,
  summarizeTiming,
  validateDoRecord,
} from './core.js';

const DAY_MINUTES = 24 * 60;

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function dayNumber(date) {
  if (!validDate(date)) return null;
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86400000);
}

function absoluteMinute(date, time) {
  const day = dayNumber(date);
  const minute = timeMinutes(time);
  return day == null || minute == null ? null : day * DAY_MINUTES + minute;
}

function planSnapshotKey(snapshot) {
  if (!snapshot) return 'none';
  return `${snapshot.date}|${snapshot.startTime}|${snapshot.duration}`;
}

function recordGroupKey(record) {
  return `${record.taskId == null ? 'null' : String(record.taskId)}::${planSnapshotKey(record.planSnapshot)}`;
}

function safeSummary(plan, records, options = {}) {
  try {
    return summarizeTiming(compareExecutionToPlan(plan, records, options));
  } catch {
    return [];
  }
}

export function planFromTask(task) {
  if (!task || !validDate(task.date) || task.isAllDay) return null;
  const start = timeMinutes(task.startTime);
  const duration = Number(task.duration);
  if (start == null || !Number.isFinite(duration) || duration <= 0) return null;
  return {
    date: task.date,
    startTime: task.startTime,
    duration,
  };
}

export function timedSliceOnDate(record, date) {
  if (!record || record.timing !== DO_TIMING.TIMED || !validDate(date)) return null;
  const start = absoluteMinute(record.date, record.startTime);
  const end = absoluteMinute(record.endDate, record.endTime);
  const day = dayNumber(date);
  if (start == null || end == null || day == null || end <= start) return null;
  const dayStart = day * DAY_MINUTES;
  const dayEnd = dayStart + DAY_MINUTES;
  const visibleStart = Math.max(start, dayStart);
  const visibleEnd = Math.min(end, dayEnd);
  if (visibleEnd <= visibleStart) return null;
  return {
    startMinute: visibleStart - dayStart,
    endMinute: visibleEnd - dayStart,
    durationMinutes: visibleEnd - visibleStart,
    clippedStart: start < dayStart,
    clippedEnd: end > dayEnd,
  };
}

export function assignOverlapColumns(items) {
  const sorted = [...items].sort((a, b) =>
    a.startMinute - b.startMinute
    || a.endMinute - b.endMinute
    || String(a.id).localeCompare(String(b.id)));

  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const columnEnds = [];
    const placed = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMinute);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = item.endMinute;
      return { ...item, column };
    });
    const columnCount = Math.max(1, columnEnds.length);
    out.push(...placed.map((item) => ({
      ...item,
      columnCount,
      leftPct: (item.column / columnCount) * 100,
      widthPct: 100 / columnCount,
    })));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length && item.startMinute >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }
  flush();
  return out;
}

export function buildJoboDayModel({
  date,
  tasks = [],
  taskLookup = tasks,
  records = [],
  now,
}) {
  const sourceTasks = Array.isArray(taskLookup) ? taskLookup : [];
  const taskById = new Map();
  for (const task of sourceTasks) {
    if (task?.id != null) taskById.set(String(task.id), task);
    // Slice 4 keeps the recurring template id in Do.taskId, while the visible
    // planner occurrence has a composite recurring-* id. Alias the template
    // only to the occurrence for this civil day so its title/color and Plan
    // remain connected without changing either upstream identity.
    if (task?.recurringTemplateId != null && task.date === date) {
      taskById.set(String(task.recurringTemplateId), task);
    }
  }

  const recordBelongsToTask = (record, task) => {
    if (record.taskId == null || task?.id == null) return false;
    const recordId = String(record.taskId);
    return recordId === String(task.id)
      || (task.recurringTemplateId != null && recordId === String(task.recurringTemplateId));
  };

  const validLiveRecords = [];
  let invalidRecordCount = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const validation = validateDoRecord(record);
    if (!validation.ok) {
      invalidRecordCount += 1;
      continue;
    }
    if (!record.deleted) validLiveRecords.push(record);
  }

  const visibleRecords = validLiveRecords.filter((record) => (
    record.timing === DO_TIMING.UNTIMED
      ? record.date === date
      : timedSliceOnDate(record, date) !== null
  ));

  const groups = new Map();
  for (const record of visibleRecords) {
    const key = recordGroupKey(record);
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }

  const summaryByGroup = new Map();
  for (const [key, group] of groups) {
    const snapshot = group[0]?.planSnapshot ?? null;
    const knownUnplanned = snapshot === null && group.every((record) => record.taskId === null);
    summaryByGroup.set(key, safeSummary(snapshot, group, { knownUnplanned }));
  }

  const timedRecords = assignOverlapColumns(
    visibleRecords
      .filter((record) => record.timing === DO_TIMING.TIMED)
      .map((record) => {
        const slice = timedSliceOnDate(record, date);
        return {
          id: record.id,
          record,
          task: record.taskId == null ? null : taskById.get(String(record.taskId)) || null,
          labels: summaryByGroup.get(recordGroupKey(record)) || [],
          ...slice,
        };
      }),
  );

  const untimedRecords = visibleRecords
    .filter((record) => record.timing === DO_TIMING.UNTIMED)
    .map((record) => ({
      id: record.id,
      record,
      task: record.taskId == null ? null : taskById.get(String(record.taskId)) || null,
      labels: summaryByGroup.get(recordGroupKey(record)) || [],
    }))
    .sort((a, b) => String(a.record.title).localeCompare(String(b.record.title)));

  const planned = (Array.isArray(tasks) ? tasks : [])
    .map((task) => ({ task, plan: planFromTask(task) }))
    .filter(({ plan }) => plan && plan.date === date)
    .map(({ task, plan }) => {
      const startMinute = timeMinutes(plan.startTime);
      const linked = visibleRecords.filter((record) => recordBelongsToTask(record, task));

      let labels = [];
      if (linked.length === 0 && now) {
        labels = safeSummary(plan, [], { displayedPlan: plan, now });
      } else if (linked.length > 0) {
        const snapshots = new Map();
        for (const record of linked) {
          if (record.planSnapshot) snapshots.set(planSnapshotKey(record.planSnapshot), record.planSnapshot);
        }
        if (snapshots.size === 1) {
          const anchor = [...snapshots.values()][0];
          labels = safeSummary(anchor, linked, { displayedPlan: plan });
        }
      }

      return {
        id: String(task.id),
        task,
        plan,
        labels,
        startMinute,
        endMinute: Math.min(DAY_MINUTES, startMinute + plan.duration),
      };
    });

  return {
    plans: assignOverlapColumns(planned),
    timedRecords,
    untimedRecords,
    invalidRecordCount,
  };
}

export { DAY_MINUTES, TIMING_SUMMARY };
