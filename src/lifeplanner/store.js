import { defaultDocument, validateDocument } from './model.js';
export const STORAGE_KEY = 'day-planner-lifeplanner-v1';
export const BACKUP_FORMAT = 'dayglance-lifeplanner';
const MAX_BYTES = 1500000;

/** Bounded local prototype storage. Never falls back to empty and overwrites
 * damaged/newer data; a failed write leaves both the snapshot and draft intact.
 * Web Locks serialize participating tabs. Revision checks also protect forms.
 */
export function createPlannerStore({ storage, defaults = [], locks, target, now = () => new Date().toISOString() }) {
  let current = defaultDocument(defaults), raw = null, error = null, disposed = false;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const read = () => {
    try {
      const nextRaw = storage.getItem(STORAGE_KEY);
      if (nextRaw === raw && !error) return;
      const next = nextRaw === null ? defaultDocument(defaults) : validateDocument(JSON.parse(nextRaw));
      current = next; raw = nextRaw; error = null;
    } catch { error = 'storageRead'; }
  };
  read();
  const changed = event => {
    if (event.key === STORAGE_KEY || event.key === null) { read(); emit(); }
  };
  let queue = Promise.resolve();
  const store = {
    get: () => current,
    error: () => error,
    subscribe: fn => {
      if (!listeners.size) target?.addEventListener('storage', changed);
      listeners.add(fn);
      return () => { listeners.delete(fn); if (!listeners.size) target?.removeEventListener('storage', changed); };
    },
    async commit(transform, expectedRevision) {
      const operation = async () => {
        if (disposed) throw new Error('missing');
        const previous = current;
        read();
        if (error) { emit(); throw new Error(error); }
        if (expectedRevision != null && current.revision !== expectedRevision) { emit(); throw new Error('conflict'); }
        try {
          const next = validateDocument({ ...transform(current), revision: current.revision + 1, updatedAt: now() });
          const nextRaw = JSON.stringify(next);
          if (nextRaw.length * 2 > MAX_BYTES) throw new Error('size');
          storage.setItem(STORAGE_KEY, nextRaw);
          raw = nextRaw; current = next; error = null; emit();
          return next;
        } catch (err) {
          if (current !== previous) emit();
          throw err instanceof Error && ['title', 'conflict', 'missing', 'format', 'measure', 'horizon', 'number', 'duration', 'total', 'date', 'steps', 'size', 'limit'].includes(err.message) ? err : new Error('storageWrite');
        }
      };
      const run = () => locks ? locks.request(STORAGE_KEY, operation) : operation();
      const job = queue.then(run, run);
      queue = job.catch(() => {});
      return job;
    },
    backup() {
      if (error) throw new Error(error);
      return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: now(), document: current }, null, 2);
    },
    rawBackup: () => storage.getItem(STORAGE_KEY) || JSON.stringify(current),
    async restore(text, expectedRevision) {
      if (typeof text !== 'string' || text.length * 2 > MAX_BYTES) throw new Error('size');
      let incoming;
      try {
        const parsed = JSON.parse(text);
        if (parsed.format !== BACKUP_FORMAT || parsed.version !== 1) throw new Error('format');
        incoming = validateDocument(parsed.document);
      } catch { throw new Error('format'); }
      // Deliberately cannot silently replace unreadable data. Export the raw
      // document first; clearing damaged data is a separate user operation.
      return store.commit(() => incoming, expectedRevision);
    },
    dispose() { disposed = true; target?.removeEventListener('storage', changed); listeners.clear(); },
  };
  return store;
}
