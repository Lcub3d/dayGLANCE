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

import { ACTIONS } from '@glance-apps/intents';
import { handleIntent } from './handleIntent.js';

export const LAUNCHER_LEDGER_KEY = 'day-planner-launcher-handled';
export const LAUNCHER_LEDGER_LIMIT = 500;

export const LAUNCHER_ACTIONS = {
  'com.dayglance.app.launcher.CREATE': ACTIONS.CREATE,
  'com.dayglance.app.launcher.COMPLETE': ACTIONS.COMPLETE,
};

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

function completeById(taskId, completedAt, { tasks = [], unscheduledTasks = [], setTasks, setUnscheduledTasks }) {
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

  const ledger = io.ledger ?? readLauncherLedger();
  const persist = io.persist ?? (next => writeLauncherLedger(next));
  const prior = findHandled(ledger, clientId);
  if (prior) return ok({ task_id: prior.taskId ?? undefined, deduped: true });

  let result;
  if (mapped === ACTIONS.CREATE) {
    result = await handleIntent(ACTIONS.CREATE, payload, context);
    if (result.success && result.task_id) stampClientId(result.task_id, clientId, context);
  } else if (payload.task_id) {
    const { task_id: taskId, completed_at: completedAt } = payload;
    result = completeById(String(taskId), completedAt, context);
  } else {
    result = await handleIntent(ACTIONS.COMPLETE, payload, context);
  }

  if (result.success) {
    persist(recordHandled(ledger, { clientId, action: mapped, taskId: result.task_id ?? null, at: new Date().toISOString() }));
  }
  return result;
}
