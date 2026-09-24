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

function recurringInstanceDateFromRecord(record) {
  if (record?.source !== 'completion' || record.taskId == null || typeof record.id !== 'string') return null;
  const prefix = `do:${String(record.taskId)}:`;
  if (!record.id.startsWith(prefix)) return null;
  const rest = record.id.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}:/.test(rest) ? rest.slice(0, 10) : null;
}

function recordGroupKey(record) {
  // An unlinked Do has no task identity that can prove two rows are sessions
  // of the same execution. Keep each one independent rather than deriving
  // "split" across unrelated manual records.
  if (record.taskId == null) return `record::${record.id}`;

  // A timed Final Plan is the strongest execution anchor. For null snapshots,
  // recurring completions still need an occurrence boundary: every occurrence
  // shares the template taskId, and all-day/untimed occurrences would otherwise
  // collapse into one false "split" history across dates.
  if (record.planSnapshot) {
    return `${String(record.taskId)}::${planSnapshotKey(record.planSnapshot)}`;
  }
  const instanceDate = recurringInstanceDateFromRecord(record);
  return `${String(record.taskId)}::${instanceDate ? `instance:${instanceDate}` : 'none'}`;
}

function taskLinkId(task) {
  if (!task) return null;
  if (task.recurringTemplateId != null) return String(task.recurringTemplateId);
  return task.id == null ? null : String(task.id);
}

function taskPlanGroupKey(task, plan) {
  const taskId = taskLinkId(task);
  return taskId == null ? null : `${taskId}::${planSnapshotKey(plan)}`;
}

function safeSummary(plan, records, options = {}) {
  try {
    return summarizeTiming(compareExecutionToPlan(plan, records, options));
  } catch {
    return [];
  }
}

export function resolveEditableDoRecord(records, openedRecord) {
  if (!Array.isArray(records) || !openedRecord?.id) return null;
  const current = records.find((record) => record?.id === openedRecord.id);
  if (!current || current.deleted) return null;
  // A newer reassessment, interval correction or tombstone must win over a
  // dialog that was opened earlier. Exact-timestamp tie resolution may swap
  // pristine copies, so use the current winner as the edit base when the
  // version timestamp itself has not advanced.
  if (current.updatedAt !== openedRecord.updatedAt) return null;
  return current;
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

  // Rendering is date-windowed, but comparison is not: an attempt can happen
  // on a later day and still be evidence against this Plan. Group the complete
  // live ledger here, then use visibleRecords only for drawing the selected day.
  const groups = new Map();
  for (const record of validLiveRecords) {
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

  // Final Plan is capture-once history. Render a captured Plan from the record
  // even when the live task was later renamed, rescheduled or deleted; otherwise
  // the card position could disagree with the very snapshot used for its badges.
  const capturedPlanKeys = new Set();
  const capturedPlans = [];
  for (const [key, group] of groups) {
    const representative = group[0];
    const plan = representative?.planSnapshot ?? null;
    if (!plan || plan.date !== date) continue;

    capturedPlanKeys.add(key);
    const linkedTask = representative.taskId == null
      ? null
      : taskById.get(String(representative.taskId)) || null;
    const task = linkedTask
      ? { ...linkedTask, title: representative.title }
      : {
          id: representative.taskId,
          title: representative.title,
          color: 'bg-blue-500',
          notes: '',
        };
    const startMinute = timeMinutes(plan.startTime);
    capturedPlans.push({
      id: `captured::${key}`,
      task,
      plan,
      labels: summaryByGroup.get(key) || [],
      startMinute,
      endMinute: Math.min(DAY_MINUTES, startMinute + plan.duration),
    });
  }

  const currentPlans = (Array.isArray(tasks) ? tasks : [])
    .map((task) => ({ task, plan: planFromTask(task) }))
    .filter(({ plan }) => plan && plan.date === date)
    // When a record already captured this exact Final Plan, the captured copy
    // is the historical source of truth and also preserves the captured title.
    .filter(({ task, plan }) => !capturedPlanKeys.has(taskPlanGroupKey(task, plan)))
    .map(({ task, plan }) => {
      const startMinute = timeMinutes(plan.startTime);
      const key = taskPlanGroupKey(task, plan);
      const linked = key == null ? [] : (groups.get(key) || []);

      let labels = [];
      if (linked.length === 0 && now && invalidRecordCount === 0) {
        // Core's internal key remains notStarted, but Slice 4 clarified the
        // product meaning: this is only "no Do recorded", never proof that no
        // execution happened. Invalid ledger rows also suppress that absence
        // inference because the evidence set is not clean.
        labels = safeSummary(plan, [], { displayedPlan: plan, now });
      } else if (linked.length > 0) {
        labels = safeSummary(plan, linked, { displayedPlan: plan });
      }

      return {
        id: `current::${String(task.id)}::${planSnapshotKey(plan)}`,
        task,
        plan,
        labels,
        startMinute,
        endMinute: Math.min(DAY_MINUTES, startMinute + plan.duration),
      };
    });

  const planned = [...capturedPlans, ...currentPlans];

  return {
    plans: assignOverlapColumns(planned),
    timedRecords,
    untimedRecords,
    invalidRecordCount,
  };
}

export { DAY_MINUTES, TIMING_SUMMARY };
