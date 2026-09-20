// Device-local presentation choices, not tasks, projects, or journal records.
// The existing Jobo key remains the single source for Settings and this chooser.
export const PLANNING_KEYS = Object.freeze({
  joboEnabled: 'day-planner-jobo-enabled',
  lifeplannerEnabled: 'day-planner-lifeplanner-enabled',
});
export const LIFE_DOCUMENT_KEY = 'day-planner-lifeplanner-v1';

export function readPlanningPreferences(storage) {
  try {
    const jobo = storage.getItem(PLANNING_KEYS.joboEnabled);
    const life = storage.getItem(PLANNING_KEYS.lifeplannerEnabled);
    // Never hide an existing prototype document on its first upgrade. An
    // explicit OFF wins, including after a reload; reading never writes data.
    return {
      joboEnabled: jobo?.trim() === 'true',
      lifeplannerEnabled: life === null ? storage.getItem(LIFE_DOCUMENT_KEY) !== null : life.trim() === 'true',
      error: null,
    };
  } catch {
    return { joboEnabled: false, lifeplannerEnabled: false, error: 'read' };
  }
}

export function createPlanningPreferences({ storage, target } = {}) {
  let snapshot = readPlanningPreferences(storage);
  const listeners = new Set();
  const publish = next => {
    if (Object.keys(next).every(key => next[key] === snapshot[key])) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const refresh = () => publish(readPlanningPreferences(storage));
  const onStorage = event => {
    if (event.key === null || Object.values(PLANNING_KEYS).includes(event.key) || event.key === LIFE_DOCUMENT_KEY) refresh();
  };
  return {
    get: () => snapshot,
    subscribe(listener) {
      if (!listeners.size) target?.addEventListener('storage', onStorage);
      listeners.add(listener);
      refresh();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) target?.removeEventListener('storage', onStorage);
      };
    },
    set(name, value) {
      if (!Object.hasOwn(PLANNING_KEYS, name)) throw new Error('Unknown planning preference');
      const current = readPlanningPreferences(storage);
      const next = typeof value === 'function' ? value(current[name]) : value;
      if (typeof next !== 'boolean') throw new TypeError('Planning preferences must be boolean');
      try {
        // Publish only after a durable write. A quota/privacy error leaves
        // the switch at its previous value and exposes a retryable error.
        storage.setItem(PLANNING_KEYS[name], JSON.stringify(next));
        publish({ ...current, [name]: next, error: null });
        return true;
      } catch {
        publish({ ...snapshot, error: 'save' });
        return false;
      }
    },
  };
}
