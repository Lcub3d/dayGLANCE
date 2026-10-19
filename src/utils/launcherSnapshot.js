// The GLANCElauncher's snapshot of this app's data, served read-only by the
// Android LauncherProvider (dayglance-android/.../launcher/LauncherProvider.kt)
// and described in docs/launcher-integration.md. Built beside the widget
// snapshot (utils/widgetSnapshot.js) on the same trigger, but shaped for the
// launcher's models rather than for widgets: every row keeps its id and the
// fields the launcher's planning and dial need, and nothing is pre-rendered.
//
// Pure apart from the helpers it is handed: nothing here reads storage, the
// clock or the DOM. `now` is the instant the snapshot describes; the sun
// times come from the coordinates the dial already stores.

import { taskColorToHex } from './colorUtils.js';
import { deriveBlockEnergy } from './energyAxis.js';
import { getSunTimes } from './solar.js';
import { dateToString } from './taskUtils.js';

export const LAUNCHER_SNAPSHOT_VERSION = 1;

/** Frame instances are listed per day over this window around today. */
export const FRAME_WINDOW = { daysBefore: 7, daysAfter: 34 };

const timeToMinutes = (time) => {
  if (!time || typeof time !== 'string') return null;
  const [h, m] = time.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

const RECURRING_ID = /^recurring-(.+)-\d{4}-\d{2}-\d{2}$/;

function taskRow(t, source) {
  const isEvent = !!t.imported && !t.isTaskCalendar;
  const recurring = typeof t.id === 'string' ? RECURRING_ID.exec(t.id) : null;
  return {
    id: String(t.id),
    title: t.title || '',
    date: source === 'inbox' ? null : (t.date || null),
    startTime: !t.isAllDay && t.startTime ? t.startTime : null,
    duration: Number.isFinite(t.duration) ? t.duration : 0,
    isAllDay: !!t.isAllDay,
    completed: !!t.completed,
    completedAt: t.completedAt || null,
    colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
    priority: t.priority ?? 0,
    notes: t.notes || '',
    projectId: t.projectId || null,
    deadline: t.deadline || null,
    source: isEvent ? 'calendar' : 'dayglance',
    energy: deriveBlockEnergy(t),
    clientId: t.clientId || null,
    recurringId: recurring ? recurring[1] : null,
  };
}

const keep = (t, isVisibleForUser) => t && !t.archived && !t.isExample && isVisibleForUser(t);

/**
 * @param {object} input
 * @param {Date} input.now                 the instant described; its date is "today"
 * @param {string} input.todayStr          today's YYYY-MM-DD, as the app derives it
 * @param {Array} input.tasks              scheduled tasks
 * @param {Array} input.unscheduledTasks   the Inbox
 * @param {Array} input.expandedRecurringTasks  recurring occurrences over the app's expansion range
 * @param {Array} input.projects @param {Array} input.goals
 * @param {boolean} input.goalsProjectsEnabled
 * @param {Function} input.isVisibleForUser
 * @param {Array} input.todayRoutines @param {object} input.routineCompletions  id → the date completed
 * @param {boolean} input.routinesEnabled
 * @param {Function} input.frameInstancesForDate  (Date) → frame instances (utils/frameInstances.js)
 * @param {Function} input.getDayWindow    (dateStr) → { start, stop } as 'HH:MM' | null, or null
 * @param {?{lat:number, lon:number}} input.weatherCoords
 * @param {boolean} input.use24Hour
 * @param {string} input.timezone
 * @param {number} input.updatedAt         the push's own stamp (excluded from the fingerprint)
 * @param {Array} input.handledWrites      the launcher-write ledger (intents/launcherWrites.js)
 * @param {Function} [input.sunTimes]      (Date, lat, lon) → { sunriseMin, sunsetMin }; the real one by default
 */
export function buildLauncherSnapshot({
  now, todayStr,
  tasks = [], unscheduledTasks = [], expandedRecurringTasks = [],
  projects = [], goals = [], goalsProjectsEnabled = false, isVisibleForUser = () => true,
  todayRoutines = [], routineCompletions = {}, routinesEnabled = true,
  frameInstancesForDate = () => [], getDayWindow = () => null,
  weatherCoords = null, use24Hour = false, timezone, updatedAt,
  handledWrites = [],
  sunTimes = getSunTimes,
}) {
  const seen = new Set();
  const rows = [];
  const push = (t, source) => {
    if (!keep(t, isVisibleForUser)) return;
    const row = taskRow(t, source);
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };
  for (const t of tasks) push(t, 'scheduled');
  for (const t of unscheduledTasks) push(t, 'inbox');
  for (const t of expandedRecurringTasks) push(t, 'recurring');

  const goalRows = goalsProjectsEnabled
    ? goals.map(g => ({
      id: String(g.id), title: g.title || '', description: g.description || '',
      colorHex: taskColorToHex(g.color), targetDate: g.targetDate || null, status: g.status || 'active',
    }))
    : [];
  const projectRows = goalsProjectsEnabled
    ? projects.map(p => ({
      id: String(p.id), title: p.title || '', goalId: p.goalId || null,
      colorHex: taskColorToHex(p.color), description: p.description || '', status: p.status || 'active',
    }))
    : [];

  const routineRows = routinesEnabled
    ? todayRoutines.map(r => ({
      id: String(r.id), name: r.name || '',
      startTime: !r.isAllDay && r.startTime ? r.startTime : null,
      duration: Number.isFinite(r.duration) ? r.duration : null,
      isAllDay: !!r.isAllDay || !r.startTime,
      completed: routineCompletions[r.id] === todayStr,
    }))
    : [];

  const frameRows = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let d = -FRAME_WINDOW.daysBefore; d <= FRAME_WINDOW.daysAfter; d++) {
    const date = new Date(base);
    date.setDate(base.getDate() + d);
    const dateStr = dateToString(date);
    for (const f of frameInstancesForDate(date)) {
      frameRows.push({
        id: `${f.frameId}:${dateStr}`, frameId: String(f.frameId), date: dateStr,
        start: f.start, end: f.end, name: f.label || '', colorHex: taskColorToHex(f.color),
      });
    }
  }

  const window = getDayWindow(todayStr) || {};
  const sun = weatherCoords && Number.isFinite(weatherCoords.lat) && Number.isFinite(weatherCoords.lon)
    ? sunTimes(now, weatherCoords.lat, weatherCoords.lon)
    : null;
  const dayShape = {
    dayStartMin: timeToMinutes(window.start),
    dayStopMin: timeToMinutes(window.stop),
    sunriseMin: sun?.sunriseMin ?? null,
    sunsetMin: sun?.sunsetMin ?? null,
    use24HourClock: !!use24Hour,
  };

  return {
    version: LAUNCHER_SNAPSHOT_VERSION,
    updatedAt,
    timezone,
    today: todayStr,
    tasks: rows,
    goals: goalRows,
    projects: projectRows,
    routines: routineRows,
    frames: frameRows,
    dayShape,
    handledWrites: handledWrites.map(h => ({ clientId: h.clientId, taskId: h.taskId ?? null, action: h.action, at: h.at })),
  };
}

/** Content fingerprint: the snapshot minus its own stamp, so an unchanged day is not re-pushed. */
export function launcherSnapshotFingerprint(snapshot) {
  return JSON.stringify({ ...snapshot, updatedAt: 0 });
}
