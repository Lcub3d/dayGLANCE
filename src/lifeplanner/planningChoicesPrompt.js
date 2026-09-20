// Device-local guide cadence only. Never reads or writes tasks or planner data.
export const PLANNING_PROMPT_KEY = 'day-planner-planning-choices-cadence-v1';
export const PLANNING_PROMPT_DISMISSED_KEY = 'day-planner-planning-choices-dismissed-date';
const MILESTONES = new Set([1, 2, 4, 7, 15]);
const EMPTY = { version: 1, lastVisit: null, days: 0, mondays: 0, sundays: 0 };
const increment = count => Math.min(16, count + 1);

export function localPromptDate(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Invalid date');
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readCadence(storage) {
  const raw = storage.getItem(PLANNING_PROMPT_KEY);
  if (raw === null) return { ...EMPTY };
  const state = JSON.parse(raw);
  if (!state || state.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(state.lastVisit) ||
      !['days', 'mondays', 'sundays'].every(key => Number.isInteger(state[key]) && state[key] >= 0 && state[key] <= 16) ||
      state.days < 1 || state.mondays > state.days || state.sundays > state.days) throw new Error('Invalid cadence');
  return state;
}

export function registerPlanningChoicesVisit(storage, now = new Date()) {
  try {
    const today = localPromptDate(now);
    const state = readCadence(storage);
    // A clock/timezone rollback cannot count the same historical day again.
    if (state.lastVisit && today < state.lastVisit) return false;
    let next = state;
    if (state.lastVisit !== today) {
      next = {
        version: 1, lastVisit: today, days: increment(state.days),
        mondays: now.getDay() === 1 ? increment(state.mondays) : state.mondays,
        sundays: now.getDay() === 0 ? increment(state.sundays) : state.sundays,
      };
      // Same-day callers write the same state; no history array grows forever.
      storage.setItem(PLANNING_PROMPT_KEY, JSON.stringify(next));
    }
    if (storage.getItem(PLANNING_PROMPT_DISMISSED_KEY) === today) return false;
    return MILESTONES.has(next.days) ||
      (now.getDay() === 1 && MILESTONES.has(next.mondays)) ||
      (now.getDay() === 0 && MILESTONES.has(next.sundays)) || now.getDate() === 1;
  } catch {
    // Blocked, invalid or future-version storage must never trigger a prompt loop.
    return false;
  }
}

export function dismissPlanningChoicesForToday(storage, now = new Date()) {
  try {
    // Separate from counters so another tab registering a visit cannot undo it.
    storage.setItem(PLANNING_PROMPT_DISMISSED_KEY, localPromptDate(now));
    return true;
  } catch {
    return false;
  }
}
