// Jobu's personal-product data. Immutable revisions retain both sides of a
// concurrent text edit; materialization picks one, backup retains every version.
import { validateOrganizerValue } from './labels.js';
import { createJoboStore } from '../jobo/store.js';
import { LIFE_NODE_KINDS, LIFE_NODE_SCHEMA, validateLifeValue } from '../lifeplanner/entities.js';
import { NETWORK_KINDS, validateNetworkValue } from '../lifeplanner/supportNetwork.js';
export const JOBU_DB = 'jobu-personal-v1';
export const JOBU_KEY = 'jobu-personal-records-v1';
export const KINDS = ['lifeWish', 'lifeMotto', 'lifeOrder', 'dayTemplate', 'day', 'filter', 'label', 'taskMeta', 'doNote', ...NETWORK_KINDS, ...LIFE_NODE_KINDS];
export const stable = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
};
function assertJSON(value, seen = new Set(), depth = 0) {
  if (depth > 60) throw new Error('format');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('format');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('format');
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) assertJSON(item, seen, depth + 1);
  seen.delete(value);
}
export function validateJobuRecords(records) {
  if (!Array.isArray(records)) throw new Error('storageRead');
  for (const row of records) {
    if (!row || row.version !== 1 || typeof row.id !== 'string' || !row.id ||
      typeof row.entityId !== 'string' || !row.entityId || !KINDS.includes(row.kind) ||
      typeof row.deleted !== 'boolean' || typeof row.updatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.updatedAt) ||
      !Number.isFinite(Date.parse(row.updatedAt)) || !Object.hasOwn(row, 'value')) throw new Error('format');
    assertJSON(row);
    // Deleted label rows retain their validated aliases to reserve identity.
    if (!row.deleted || row.kind === 'label') validateOrganizerValue(row.kind, row.value);
    if (!row.deleted) { validateNetworkValue(row.kind, row.value); validateLifeValue(row.kind, row.value); }
    if (row.kind === 'label' && row.value?.id !== row.entityId) throw new Error('format');
    if (row.kind === 'lifeNode' && row.value?.id !== row.entityId) throw new Error('format');
    if ((row.entityId === LIFE_NODE_SCHEMA && row.kind !== 'lifeNodeSchema') || (row.kind === 'lifeNodeSchema' && (row.entityId !== LIFE_NODE_SCHEMA || row.deleted))) throw new Error('format');
    if (!row.deleted && (!row.value || typeof row.value !== 'object' || Array.isArray(row.value))) throw new Error('format');
    const text = JSON.stringify(row);
    if (!text || text.length > 2000000 || stable(JSON.parse(text)) !== stable(row)) throw new Error('format');
  }
  return records;
}
export function pickJobuRevision(a, b) {
  const delta = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  return delta !== 0 ? (delta > 0 ? a : b) : stable(a) >= stable(b) ? a : b;
}
export function mergeJobuRecords(a, b) {
  if (a === undefined && b === undefined) return undefined;
  validateJobuRecords(a ?? []); validateJobuRecords(b ?? []);
  const rows = new Map();
  for (const row of [...(a ?? []), ...(b ?? [])]) rows.set(row.id, rows.has(row.id) ? pickJobuRevision(rows.get(row.id), row) : row);
  return [...rows.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
export function materializeJobu(records = []) {
  validateJobuRecords(records);
  const map = new Map();
  for (const row of records) {
    const prior = map.get(row.entityId);
    if (!prior || pickJobuRevision(prior, row) === row) map.set(row.entityId, row);
  }
  return map;
}
export function jobuValues(records, kind) {
  return [...materializeJobu(records).values()].filter(row => row.kind === kind && !row.deleted);
}
export function createJobuData({ store = createJoboStore({ dbName: JOBU_DB, key: JOBU_KEY }), now = () => new Date().toISOString(), uuid = () => crypto.randomUUID(), channel = null } = {}) {
  let state = { records: undefined, loaded: false, writable: false, error: null };
  let queue = Promise.resolve(), disposed = false, held = [], retryTimer = null, delay = 1000;
  const listeners = new Set();
  const publish = patch => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const serialize = fn => { const job = queue.then(fn, fn); queue = job.catch(() => {}); return job; };
  const schedule = () => {
    if (disposed || retryTimer || !held.length) return;
    retryTimer = setTimeout(() => { retryTimer = null; api.load().catch(() => {}); }, delay);
    delay = Math.min(delay * 2, 30000);
  };
  const accept = records => { validateJobuRecords(records); publish({ records, loaded: true, error: null }); };
  async function flush() {
    while (held.length && !disposed) {
      const batch = held; held = [];
      let result;
      try { result = await store.update(current => mergeJobuRecords(current, batch)); }
      catch { result = { ok: false }; }
      if (!result.ok) { held = mergeJobuRecords(held, batch); publish({ error: 'storageWrite' }); schedule(); return false; }
      accept(result.value); delay = 1000;
    }
    return true;
  }
  const api = {
    get: () => state,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    load: () => serialize(async () => {
      const result = await store.read();
      if (!result.ok) { publish({ error: 'storageRead' }); schedule(); return { ok: false }; }
      try { validateJobuRecords(result.value ?? []); } catch { publish({ error: 'format' }); return { ok: false }; }
      const writable = await store.writable();
      publish({ records: result.value ?? [], loaded: true, writable, error: null });
      if (writable) await flush();
      return { ok: true };
    }),
    // A transform observes the latest committed collection INSIDE its atomic
    // transaction. It returns entity changes, never replacement records.
    transact: transform => serialize(async () => {
      if (!state.loaded || !state.writable || disposed) throw new Error('storageWrite');
      let output;
      const result = await store.update(raw => {
        const records = validateJobuRecords(raw ?? []);
        const changes = transform(records, materializeJobu(records));
        if (!Array.isArray(changes)) throw new Error('format');
        let epoch = records.reduce((max, row) => Math.max(max, Date.parse(row.updatedAt) + 1), Date.parse(now()));
        if (!Number.isFinite(epoch)) throw new Error('date');
        const incoming = changes.map(change => ({ version: 1, id: change.operationId || uuid(), entityId: change.entityId,
          kind: change.kind, value: structuredClone(change.value ?? null), deleted: !!change.deleted,
          updatedAt: new Date(epoch++).toISOString() }));
        output = mergeJobuRecords(records, incoming);
        return output;
      });
      if (!result.ok) { if (!['conflict', 'format', 'missing', 'networkBudget', 'networkCycle', 'networkComparison', 'lifeCycle', 'lifeLegacyRevision', 'loading'].includes(result.error)) publish({ error: 'storageWrite' }); throw new Error(result.error || 'storageWrite'); }
      accept(result.value); channel?.postMessage('changed'); return output;
    }),
    save: (entityId, kind, value, { expectedHead, operationId, deleted = false } = {}) => api.transact((records, map) => {
      if (operationId && records.some(row => row.id === operationId)) return [];
      if (expectedHead !== undefined && (map.get(entityId)?.id ?? null) !== expectedHead) throw new Error('conflict');
      return [{ entityId, kind, value, deleted, operationId }];
    }),
    applyRemote: incoming => {
      try { held = mergeJobuRecords(held, incoming); } catch (error) { publish({ error: 'format' }); return Promise.resolve({ ok: false, error: error.message }); }
      return serialize(async () => {
        if (!state.loaded || !state.writable) { schedule(); return { ok: false, pending: true }; }
        const ok = await flush(); if (ok) channel?.postMessage('changed'); return { ok };
      });
    },
    restore: incoming => serialize(async () => {
      validateJobuRecords(incoming);
      if (!state.loaded || !state.writable) throw new Error('storageWrite');
      // Import merges immutable revisions: no old device/backup can silently
      // delete later revisions. Exact destructive rewind is intentionally absent.
      const result = await store.update(current => mergeJobuRecords(current, incoming));
      if (!result.ok) throw new Error('storageWrite');
      accept(result.value); channel?.postMessage('changed'); return result;
    }),
    export: () => {
      if (!state.loaded || state.error) throw new Error('storageRead');
      return JSON.stringify({ format: 'jobu-personal', version: 1, exportedAt: now(), records: state.records }, null, 2);
    },
    connect: next => { channel?.close(); channel = next; if (channel) channel.onmessage = () => api.load(); },
    dispose: () => { disposed = true; clearTimeout(retryTimer); channel?.close(); listeners.clear(); },
  };
  if (channel) channel.onmessage = () => api.load();
  return api;
}
