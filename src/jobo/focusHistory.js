/*
 * Focus Mode currently persists two different kinds of data:
 *
 *   - task.focusMinutes, which is task-owned but has no session identity;
 *   - focusLog[date], which has day-level spans and may now carry task ids.
 *
 * A Do card must never infer that an aggregate day span belongs to a task.
 * This selector therefore accepts only explicit session rows carrying either
 * the Do record id or the task id.  Recurring tasks additionally need their
 * occurrence identity; the date key of focusLog is not enough to provide it.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECURRING_INSTANCE_RE = /^recurring-(.+)-(\d{4}-\d{2}-\d{2})$/;

function id(value) {
  return value == null || value === '' ? null : String(value);
}

function dateValue(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function recurringInfo(value) {
  const valueId = id(value);
  if (!valueId) return null;
  const match = RECURRING_INSTANCE_RE.exec(valueId);
  const occurrenceDate = dateValue(match?.[2]);
  return match && occurrenceDate
    ? { instanceId: valueId, templateId: match[1], occurrenceDate }
    : null;
}

function minuteValue(value, allowOverflow = false) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const maximum = allowOverflow ? 2880 : 1439;
    return value >= 0 && value <= maximum ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function timestampParts(value) {
  if (typeof value !== 'string') return null;
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return null;
  const year = stamp.getFullYear();
  const month = String(stamp.getMonth() + 1).padStart(2, '0');
  const day = String(stamp.getDate()).padStart(2, '0');
  return {
    stamp,
    minute: stamp.getHours() * 60 + stamp.getMinutes(),
    date: `${year}-${month}-${day}`,
  };
}

function timestampMinute(value) {
  return timestampParts(value)?.minute ?? null;
}

function timestampEndMinute(startedAt, endedAt, startMinute, endMinute) {
  if (endMinute != null) return endMinute;
  const end = timestampParts(endedAt);
  if (!end) return null;
  const start = timestampParts(startedAt);
  if (!start || startMinute == null || end.minute > startMinute) return end.minute;
  const elapsedMs = end.stamp.getTime() - start.stamp.getTime();
  if (!(elapsedMs > 0)) return end.minute;
  const dayCount = Math.max(1, Math.ceil(elapsedMs / (24 * 60 * 60 * 1000)));
  return end.minute + dayCount * 1440;
}

function explicitSession(raw, fallbackDate = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const taskId = id(raw.taskId ?? raw.task?.id ?? raw.task_id);
  const recordId = id(raw.recordId ?? raw.doId ?? raw.executionId ?? raw.record?.id);
  const hasInvalidDate = ['date', 'sessionDate', 'occurrenceDate']
    .some(field => raw[field] != null && !dateValue(raw[field]));
  if (hasInvalidDate && !recordId) return null;
  const rawInstanceId = id(raw.instanceId ?? raw.occurrenceId ?? raw.taskInstanceId);
  const taskInstance = recurringInfo(taskId);
  const instanceId = rawInstanceId || taskInstance?.instanceId || null;
  const explicitDate = dateValue(raw.date ?? raw.sessionDate);
  const occurrenceDate = dateValue(raw.occurrenceDate);
  const startTimestamp = timestampParts(raw.startedAt);
  const date = explicitDate || occurrenceDate || dateValue(fallbackDate) || startTimestamp?.date || null;
  const startMinute = minuteValue(raw.startMinute ?? raw.startTime ?? raw.start);
  const endMinute = minuteValue(raw.endMinute ?? raw.endTime ?? raw.end, true);
  const durationMinutes = Number.isFinite(raw.durationMinutes) ? raw.durationMinutes : null;
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
  const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : null;
  const timestampStart = startTimestamp?.minute ?? timestampMinute(startedAt);
  const timestampEnd = timestampEndMinute(startedAt, endedAt, timestampStart, endMinute);
  const resolvedStart = startMinute ?? timestampStart;
  const resolvedEnd = timestampEnd ?? timestampEndMinute(startedAt, endedAt, resolvedStart, endMinute);
  const taskMinutesValue = taskId == null ? null : raw.taskMinutes?.[taskId];
  const taskMinutes = Number.isFinite(taskMinutesValue) ? taskMinutesValue : null;

  // A row without an identity cannot be attributed to one Do.  Keep it out
  // of the candidate list so aggregate focusLog spans cannot leak through a
  // later, more permissive match.
  if (!taskId && !recordId) return null;
  if (resolvedStart == null || resolvedEnd == null || resolvedEnd <= resolvedStart) return null;
  if (startedAt && endedAt) {
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(endedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  }

  return {
    id: id(raw.id),
    taskId,
    recordId,
    instanceId,
    date,
    occurrenceDate: occurrenceDate || taskInstance?.occurrenceDate || null,
    startMinute: resolvedStart,
    endMinute: resolvedEnd,
    durationMinutes,
    taskMinutes,
  };
}

function explicitSessions(raw, fallbackDate = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const taskIds = Array.isArray(raw.taskIds) ? raw.taskIds : [];
  if (taskIds.length && raw.taskId == null && raw.recordId == null && raw.doId == null) {
    return taskIds
      .map((taskId) => explicitSession({ ...raw, taskId }, fallbackDate))
      .filter(Boolean);
  }
  const session = explicitSession(raw, fallbackDate);
  return session ? [session] : [];
}

function collectSessions(source, output = [], fallbackDate = null) {
  if (!source) return output;
  if (Array.isArray(source)) {
    for (const entry of source) output.push(...explicitSessions(entry, fallbackDate));
    return output;
  }
  if (typeof source !== 'object') return output;

  const ownSessions = explicitSessions(source, fallbackDate);
  if (ownSessions.length) {
    output.push(...ownSessions);
    return output;
  }

  for (const [key, value] of Object.entries(source)) {
    if (DATE_RE.test(key) && !dateValue(key)) continue;
    const date = dateValue(key) || fallbackDate;
    if (Array.isArray(value)) {
      collectSessions(value, output, date);
      continue;
    }
    if (!value || typeof value !== 'object') continue;

    // Support a date-indexed object without treating its numeric `sessions`
    // aggregate as a list.  `entries` is accepted for callers that use a
    // more descriptive name than `sessions`.
    if (Array.isArray(value.sessions)) collectSessions(value.sessions, output, date);
    if (Array.isArray(value.entries)) collectSessions(value.entries, output, date);
    if (Array.isArray(value.records)) collectSessions(value.records, output, date);
    if (Array.isArray(value.spans)) collectSessions(value.spans, output, date);
  }
  return output;
}

function occurrenceDateForTarget(record, task) {
  return [
    record?.planSnapshot?.date,
    record?.occurrenceDate,
    task?.date,
  ].map(dateValue).find(Boolean) || null;
}

function targetIdentity(record, task) {
  const recordId = id(record?.id);
  const taskValue = id(task?.id);
  const recordTaskId = id(record?.taskId);
  const taskInstance = recurringInfo(taskValue);
  const recordTaskInstance = recurringInfo(recordTaskId);
  const occurrenceDate = occurrenceDateForTarget(record, task)
    || taskInstance?.occurrenceDate
    || recordTaskInstance?.occurrenceDate
    || null;
  const recurring = Boolean(
    task?.recurringTemplateId != null
      || task?.isRecurring
      || record?.isRecurring
      || taskInstance
      || recordTaskInstance,
  );
  const instanceIds = new Set([
    task?.instanceId,
    task?.occurrenceId,
    record?.instanceId,
    record?.occurrenceId,
    taskInstance?.instanceId,
    recordTaskInstance?.instanceId,
  ].map(id).filter(Boolean));
  const templateIds = new Set([
    task?.recurringTemplateId,
    taskInstance?.templateId,
    recordTaskInstance?.templateId,
    recurring ? recordTaskId : null,
  ].map(id).filter(Boolean));
  const stableTaskIds = new Set();

  if (recurring) {
    if (occurrenceDate) {
      for (const templateId of templateIds) instanceIds.add(`recurring-${templateId}-${occurrenceDate}`);
    }
  } else {
    [taskValue, recordTaskId].map(id).filter(Boolean).forEach(value => stableTaskIds.add(value));
  }

  return {
    recordId,
    occurrenceDate,
    recurring,
    instanceIds,
    templateIds,
    stableTaskIds,
    hasTaskIdentity: recurring ? instanceIds.size > 0 || Boolean(occurrenceDate) : stableTaskIds.size > 0,
  };
}

function matchesTarget(session, target) {
  // An exact record identity is authoritative.  In particular, a session's
  // log date may be the day it started, while the Do record date is its
  // completion/occurrence date.
  if (session.recordId && target.recordId) return session.recordId === target.recordId;
  if (target.recordId && session.recordId) return false;

  if (!session.taskId) return false;
  if (target.recurring) {
    const sessionInstance = session.instanceId || recurringInfo(session.taskId)?.instanceId;
    if (target.instanceIds.has(session.taskId) || (sessionInstance && target.instanceIds.has(sessionInstance))) return true;

    // A bare recurring template id is only safe when the row itself carries
    // the occurrence identity.  A date-indexed focusLog key is deliberately
    // not accepted as a substitute for `occurrenceDate` or `instanceId`.
    if (!target.templateIds.has(session.taskId) || !session.occurrenceDate) return false;
    return Boolean(target.occurrenceDate) && session.occurrenceDate === target.occurrenceDate;
  }

  // Stable ordinary task ids are globally unique and can legitimately have
  // focus sessions recorded on a different calendar day.
  return target.stableTaskIds.has(session.taskId) && !recurringInfo(session.taskId);
}

function sessionKey(session) {
  return session.id
    ? `id:${session.id}|${session.taskId || ''}|${session.date || ''}`
    : [session.recordId, session.taskId, session.date, session.occurrenceDate, session.instanceId,
      session.startMinute, session.endMinute, session.startedAt, session.endedAt].join('|');
}

function sortSessions(a, b) {
  const aDate = a.date || '';
  const bDate = b.date || '';
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const aStart = a.startMinute ?? Number.POSITIVE_INFINITY;
  const bStart = b.startMinute ?? Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart - bStart;
  return String(a.startedAt || '').localeCompare(String(b.startedAt || ''));
}

/**
 * Return only focus sessions explicitly attributable to one Do occurrence.
 * `focusSessions` can be an array or a date-indexed object.  `focusLog` is
 * accepted for forward compatibility, but aggregate spans without task ids
 * are intentionally filtered out.
 */
export function selectDoFocusHistory({ record = null, task = null, focusSessions = null, focusLog = null } = {}) {
  const target = targetIdentity(record, task);
  if (!target.recordId && !target.hasTaskIdentity) return [];

  const candidates = [
    ...collectSessions(focusSessions),
    ...collectSessions(focusLog),
  ];
  const seen = new Set();
  return candidates
    .filter((session) => matchesTarget(session, target))
    .filter((session) => {
      const key = sessionKey(session);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(sortSessions);
}

export function selectDoFocusHistorySummary(options = {}) {
  const sessions = selectDoFocusHistory(options);
  const minutes = Number.isFinite(options.task?.focusMinutes) && options.task.focusMinutes > 0
    ? options.task.focusMinutes
    : null;
  return {
    sessions,
    legacyMinutes: minutes,
    precise: sessions.length > 0,
  };
}

export function formatFocusMinute(value) {
  if (!Number.isFinite(value)) return null;
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function focusSessionLabel(session, formatTime) {
  const format = typeof formatTime === 'function' ? formatTime : (value) => value;
  const start = formatFocusMinute(session?.startMinute);
  const end = formatFocusMinute(session?.endMinute);
  if (start && end) return `${format(start)}–${format(end)}`;
  if (start) return format(start);
  if (session?.startedAt || session?.endedAt) return [session.startedAt, session.endedAt].filter(Boolean).join('–');
  return 'Time unavailable';
}

export function focusSessionDuration(session) {
  if (Number.isFinite(session?.durationMinutes) && session.durationMinutes >= 0) return session.durationMinutes;
  if (Number.isFinite(session?.startMinute) && Number.isFinite(session?.endMinute)) {
    return session.endMinute - session.startMinute;
  }
  return null;
}
