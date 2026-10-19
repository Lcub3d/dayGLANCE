// Writes from the GLANCElauncher (docs/launcher-integration.md). The launcher's
// LauncherIntentReceiver queues {action, payload, clientId}; the Android
// bridge hook drains the queue here. Every write carries a client-generated
// id: a write the launcher re-sends (it keeps a durable outbox until the
// snapshot shows the id) is acknowledged from the ledger and never applied
// twice, CREATE stamps the id on the task it made, and the ledger rides the
// launcher snapshot so the launcher can see what has landed.
//
// The id travels BESIDE the payload, not inside it: the intents package's
// payload schemas are strict and shared with Tasker, so an extra field there
// would be rejected. COMPLETE from the launcher names the task by id, where
// the automation action matches by title; a title payload still works.
//
// The second cut adds the dial's gestures, launcher-only actions with no
// automation counterpart: MOVE (a date and an optional time; an Inbox task
// is scheduled, a block moved, an all-day task postponed), RESIZE, UNCOMPLETE
// and TOGGLE_ROUTINE. They reuse the MCP write model's pure mutations
// (utils/taskMutations.js), so a recurring occurrence, a calendar event or a
// routine block is refused with the same words the MCP tools use.
//
// A write that FAILS for good (an unknown id, a read-only block, a routine in
// the way) is recorded in the ledger too, with its error: the launcher
// retires an outbox entry when the snapshot shows its id, so recording the
// failure makes the optimistic change on the launcher revert on the next
// snapshot instead of when the entry expires a day later.

import { ACTIONS } from '@glance-apps/intents';
import { handleIntent } from './handleIntent.js';
import { applyMoveBlock, applyResizeBlock, applyScheduleTask, applySetCompletion, parseRecurringInstanceId } from '../utils/taskMutations.js';
import { dateToString } from '../utils/taskUtils.js';
import { nativeRecordLauncherRefresh } from '../native.js';
import { REFRESH_OUTCOMES } from '../utils/launcherHeartbeat.js';

export const LAUNCHER_LEDGER_KEY = 'day-planner-launcher-handled';
export const LAUNCHER_LEDGER_LIMIT = 500;

/** The launcher-only actions, with no automation counterpart. */
export const LAUNCHER_ONLY = Object.freeze({
  UNCOMPLETE: 'uncomplete',
  MOVE: 'move',
  RESIZE: 'resize',
  TOGGLE_ROUTINE: 'toggle_routine',
  REFRESH: 'refresh',
});

export const LAUNCHER_ACTIONS = {
  'com.dayglance.app.launcher.CREATE': ACTIONS.CREATE,
  'com.dayglance.app.launcher.COMPLETE': ACTIONS.COMPLETE,
  'com.dayglance.app.launcher.UNCOMPLETE': LAUNCHER_ONLY.UNCOMPLETE,
  'com.dayglance.app.launcher.MOVE': LAUNCHER_ONLY.MOVE,
  'com.dayglance.app.launcher.RESIZE': LAUNCHER_ONLY.RESIZE,
  'com.dayglance.app.launcher.TOGGLE_ROUTINE': LAUNCHER_ONLY.TOGGLE_ROUTINE,
  'com.dayglance.app.launcher.REFRESH': LAUNCHER_ONLY.REFRESH,
};

// REFRESH is not a write and is not in the ledger: the native receiver dedupes
// it against its own refresh log, and this set catches a re-delivery within one
// JS session before the log has the outcome.
const recentRefreshIds = [];
const REFRESH_MEMORY = 20;

const ok = (extra = {}) => ({ success: true, error: '', ...extra });
const fail = (error) => ({ success: false, error });

export function readLauncherLedger(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(LAUNCHER_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLauncherLedger(ledger, storage = globalThis.localStorage) {
  try { storage?.setItem(LAUNCHER_LEDGER_KEY, JSON.stringify(ledger)); } catch { /* storage unavailable */ }
}

export const findHandled = (ledger, clientId) => ledger.find(h => h.clientId === clientId) || null;

/** The ledger with one more entry, newest last, bounded so it stays small. */
export function recordHandled(ledger, entry) {
  const next = ledger.filter(h => h.clientId !== entry.clientId);
  next.push(entry);
  return next.length > LAUNCHER_LEDGER_LIMIT ? next.slice(next.length - LAUNCHER_LEDGER_LIMIT) : next;
}

function stampClientId(taskId, clientId, { setTasks, setUnscheduledTasks }) {
  // The task handleCreate just added is not in the context's (pre-create)
  // lists, so both setters get the stamp; it only touches the matching id.
  const stamp = prev => prev.map(t => (t.id === taskId ? { ...t, clientId } : t));
  if (setTasks) setTasks(stamp);
  if (setUnscheduledTasks) setUnscheduledTasks(stamp);
}

function completeById(taskId, completedAt, context) {
  if (parseRecurringInstanceId(taskId)) return setCompletion(taskId, true, context);
  const { tasks = [], unscheduledTasks = [], setTasks, setUnscheduledTasks } = context;
  const inTasks = tasks.find(t => t.id === taskId);
  const inInbox = inTasks ? null : unscheduledTasks.find(t => t.id === taskId);
  const target = inTasks || inInbox;
  if (!target) return fail('no such task');
  if (target.completed) return ok({ task_id: taskId, warning: 'already completed' });
  const patch = { completed: true, completedAt: completedAt || new Date().toISOString() };
  const apply = prev => prev.map(t => (t.id === taskId ? { ...t, ...patch } : t));
  if (inTasks && setTasks) setTasks(apply);
  else if (inInbox && setUnscheduledTasks) setUnscheduledTasks(apply);
  return ok({ task_id: taskId });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The mutations' state: the task slices plus the routine slices their guards read. */
function mutationState(context) {
  const { tasks = [], unscheduledTasks = [], recurringTasks = [], todayRoutines = [], routinesDate, routineCompletions = {}, routinesEnabled } = context;
  const todayDate = dateToString(new Date());
  return {
    tasks, unscheduledTasks, recurringTasks,
    routines: todayRoutines, routinesDate: routinesDate ?? todayDate, routineCompletions, routinesEnabled: routinesEnabled ?? todayRoutines.length > 0, todayDate,
  };
}

const mutationError = (r) => fail(r.error?.message || String(r.error || 'write failed'));

function setCompletion(taskId, completed, context) {
  const r = applySetCompletion(mutationState(context), { taskId, completed, nowIso: new Date().toISOString() });
  if (!r.ok) return mutationError(r);
  if (!r.replayed) {
    if (r.recurringTasks && context.setRecurringTasks) context.setRecurringTasks(() => r.recurringTasks);
    if (r.tasks && context.setTasks) context.setTasks(() => r.tasks);
    if (r.unscheduledTasks && context.setUnscheduledTasks) context.setUnscheduledTasks(() => r.unscheduledTasks);
  }
  return ok({ task_id: taskId, ...(r.replayed ? { warning: completed ? 'already completed' : 'not completed' } : {}) });
}

/**
 * MOVE {task_id, date, start?}. An Inbox task needs a time and is scheduled
 * (the app's own schedule path: priority and deadline are inbox-only and are
 * dropped). A scheduled block moves to the date, and to the time when one is
 * given; without one an all-day task stays all-day on the new date and a
 * timed one keeps its time (dayGLANCE's postpone).
 */
function moveTask(payload, context) {
  const taskId = String(payload.task_id ?? '');
  const date = payload.date;
  const start = payload.start ?? null;
  if (!taskId) return fail('task_id required');
  if (typeof date !== 'string' || !DATE_RE.test(date)) return fail('date must be YYYY-MM-DD');
  if (start !== null && (typeof start !== 'string' || !TIME_RE.test(start))) return fail('start must be HH:MM');
  const state = mutationState(context);
  const nowIso = new Date().toISOString();
  const inbox = state.unscheduledTasks.find(t => t.id === taskId);
  if (inbox) {
    if (!start) return fail('an Inbox task needs a start time to be scheduled');
    const r = applyScheduleTask(state, { taskId, date, startTime: start, nowIso });
    if (!r.ok) return mutationError(r);
    if (!r.replayed) {
      context.setUnscheduledTasks?.(() => r.unscheduledTasks);
      context.setTasks?.(() => r.tasks);
    }
    return ok({ task_id: taskId });
  }
  const task = state.tasks.find(t => t.id === taskId);
  const keepAllDay = !start && !!task?.isAllDay;
  const r = applyMoveBlock(state, { blockId: taskId, date, startTime: start ?? task?.startTime ?? '00:00', nowIso });
  if (!r.ok) return mutationError(r);
  let tasks = r.tasks;
  if (keepAllDay) tasks = tasks.map(t => (t.id === taskId ? { ...t, isAllDay: true, startTime: '00:00' } : t));
  context.setTasks?.(() => tasks);
  return ok({ task_id: taskId });
}

/** RESIZE {task_id, duration}: the block's new length in minutes, five at least. */
function resizeTask(payload, context) {
  const taskId = String(payload.task_id ?? '');
  const duration = Number(payload.duration);
  if (!taskId) return fail('task_id required');
  if (!Number.isInteger(duration) || duration < 5) return fail('duration must be a whole number of minutes, at least 5');
  const r = applyResizeBlock(mutationState(context), { blockId: taskId, durationMinutes: duration, nowIso: new Date().toISOString() });
  if (!r.ok) return mutationError(r);
  context.setTasks?.(() => r.tasks);
  return ok({ task_id: taskId });
}

/**
 * TOGGLE_ROUTINE {routine_id, date?}. Routine completions are kept for today
 * only (useRoutines), so a date other than today is refused rather than
 * recorded against the wrong day.
 */
function toggleRoutine(payload, context) {
  const routineId = String(payload.routine_id ?? '');
  if (!routineId) return fail('routine_id required');
  const today = dateToString(new Date());
  if (payload.date != null && payload.date !== today) return fail(`routine completions are kept for today (${today}) only`);
  const { todayRoutines = [], routineCompletions = {}, toggleRoutineCompletion } = context;
  if (!todayRoutines.some(r => r.id === routineId)) return fail('no such routine today');
  if (typeof toggleRoutineCompletion !== 'function') return fail('routines are not available');
  toggleRoutineCompletion(routineId);
  return ok({ routine_id: routineId, completed: !routineCompletions[routineId] });
}

/**
 * REFRESH: run every configured sync tier to completion, re-push the snapshot
 * and the heartbeat, and record how it went in the native refresh log. The
 * launcher reads the outcome (and `syncedAt`) from the next meta row.
 */
async function refresh(clientId, context) {
  if (recentRefreshIds.includes(clientId)) return ok({ deduped: true });
  recentRefreshIds.push(clientId);
  if (recentRefreshIds.length > REFRESH_MEMORY) recentRefreshIds.shift();
  const record = context.recordLauncherRefresh ?? nativeRecordLauncherRefresh;
  const started = Date.now();
  if (typeof context.runSyncCycle !== 'function') {
    record({ clientId, outcome: REFRESH_OUTCOMES.FAILED, reason: 'no sync cycle available', durationMs: 0 });
    return fail('no sync cycle available');
  }
  try {
    await context.runSyncCycle();
    context.touchLauncherHeartbeat?.();
    const durationMs = Date.now() - started;
    record({ clientId, outcome: REFRESH_OUTCOMES.RAN, durationMs });
    return ok({ durationMs });
  } catch (err) {
    const reason = err?.message || String(err);
    context.touchLauncherHeartbeat?.();
    record({ clientId, outcome: REFRESH_OUTCOMES.FAILED, reason, durationMs: Date.now() - started });
    return fail(reason);
  }
}

/**
 * Handle one launcher write.
 *
 * @param {{action: string, payload?: object, clientId?: string}} intent
 * @param {object} context  the handleIntent context (tasks, unscheduledTasks, setters, ...)
 * @param {object} [io]     { ledger, persist }: the ledger to consult and the writer to record with
 * @returns {Promise<object>} { success, task_id?, error, deduped? }
 */
export async function handleLauncherIntent(intent, context = {}, io = {}) {
  const { action, payload = {}, clientId } = intent || {};
  const mapped = LAUNCHER_ACTIONS[action];
  if (!mapped) return fail(`Unknown launcher action: ${action}`);
  if (typeof clientId !== 'string' || !clientId) return fail('clientId required');
  if (mapped === LAUNCHER_ONLY.REFRESH) return refresh(clientId, context);

  const ledger = io.ledger ?? readLauncherLedger();
  const persist = io.persist ?? (next => writeLauncherLedger(next));
  const prior = findHandled(ledger, clientId);
  if (prior) {
    return prior.error
      ? { success: false, error: prior.error, deduped: true }
      : ok({ task_id: prior.taskId ?? undefined, deduped: true });
  }

  let result;
  switch (mapped) {
    case ACTIONS.CREATE:
      result = await handleIntent(ACTIONS.CREATE, payload, context);
      if (result.success && result.task_id) stampClientId(result.task_id, clientId, context);
      break;
    case ACTIONS.COMPLETE:
      result = payload.task_id
        ? completeById(String(payload.task_id), payload.completed_at, context)
        : await handleIntent(ACTIONS.COMPLETE, payload, context);
      break;
    case LAUNCHER_ONLY.UNCOMPLETE:
      result = payload.task_id ? setCompletion(String(payload.task_id), false, context) : fail('task_id required');
      break;
    case LAUNCHER_ONLY.MOVE:
      result = moveTask(payload, context);
      break;
    case LAUNCHER_ONLY.RESIZE:
      result = resizeTask(payload, context);
      break;
    case LAUNCHER_ONLY.TOGGLE_ROUTINE:
      result = toggleRoutine(payload, context);
      break;
    default:
      result = fail(`Unknown launcher action: ${action}`);
  }

  // A success is recorded so a re-sent write is acknowledged, never applied
  // twice. A failure is recorded too, with its error, so the launcher sees the
  // id in the next snapshot and lets its optimistic change go (see the header);
  // the CREATE path is the exception, since a failed create may be a transient
  // validation of a payload the launcher can correct and re-send.
  if (result.success) {
    persist(recordHandled(ledger, { clientId, action: mapped, taskId: result.task_id ?? result.routine_id ?? null, at: new Date().toISOString() }));
  } else if (mapped !== ACTIONS.CREATE) {
    persist(recordHandled(ledger, { clientId, action: mapped, taskId: null, at: new Date().toISOString(), error: result.error }));
  }
  return result;
}
