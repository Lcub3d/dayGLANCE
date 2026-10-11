// Aspire is a notebook of independent entries. Text and ordering are separate
// registers so moving a row on one device never overwrites an edit on another.
// Deletion/restoration have their own retained stamps: a stale text edit cannot
// resurrect a deleted row. Only an explicit, newer restore can do that.
import { mergeRecordsById, mergeJoboCollections } from '../jobo/ledger.js';
import { createJoboStore } from '../jobo/store.js';
import { moveNotebookItems } from './notebookOrder.js';

export const ASPIRE_DB_NAME = 'dayglance-aspire';
export const ASPIRE_STORAGE_KEY = 'day-planner-aspire-entries';
const EPOCH = '1970-01-01T00:00:00.000Z';
const time = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const latest = (...values) => new Date(Math.max(0, ...values.map(time))).toISOString();
const contentStamp = (row) => row.contentUpdatedAt || row.updatedAt || EPOCH;
const orderStamp = (row) => row.orderUpdatedAt || row.updatedAt || EPOCH;
const pickRegister = (a, b, stamp, fields) => {
  const delta = time(stamp(a)) - time(stamp(b));
  if (delta) return delta > 0 ? a : b;
  const selected = (row) => Object.fromEntries(fields.map(key => [key, row[key] ?? null]));
  return canonical(selected(a)) <= canonical(selected(b)) ? a : b;
};

export function pickAspireEntry(a, b) {
  const content = pickRegister(a, b, contentStamp, ['text', 'kind', 'contentUpdatedAt']);
  const order = pickRegister(a, b, orderStamp, ['order', 'orderUpdatedAt']);
  const deletedAt = latest(a.deletedAt, b.deletedAt,
    a.deleted && !a.deletedAt ? contentStamp(a) : null,
    b.deleted && !b.deletedAt ? contentStamp(b) : null);
  const restoredAt = latest(a.restoredAt, b.restoredAt);
  const winner = canonical(a) <= canonical(b) ? a : b;
  return {
    ...winner,
    id: a.id,
    kind: content.kind,
    text: content.text,
    order: order.order,
    createdAt: new Date(Math.min(time(a.createdAt), time(b.createdAt))).toISOString(),
    contentUpdatedAt: contentStamp(content),
    orderUpdatedAt: orderStamp(order),
    updatedAt: latest(contentStamp(content), orderStamp(order), deletedAt, restoredAt),
    deleted: time(deletedAt) > 0 && time(deletedAt) >= time(restoredAt),
    ...(time(deletedAt) ? { deletedAt } : {}),
    ...(time(restoredAt) ? { restoredAt } : {}),
  };
}

export const mergeAspireEntries = (local, remote) => mergeRecordsById(local, remote, pickAspireEntry);
export const mergeAspireCollections = (local, remote) => mergeJoboCollections(local, remote, pickAspireEntry);
export const visibleAspireEntries = (records, kind) => (records || [])
  .filter(row => row && !row.deleted && (kind === undefined || row.kind === kind))
  .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id), 'en'));

// Pure operation planner, called INSIDE the store's atomic update. Guards are
// against its latest rows, never the render which opened an editor or drag.
export function applyAspireOperation(current, op, { now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
  if (current !== undefined && !Array.isArray(current)) throw new Error('invalidStorage');
  const rows = mergeAspireEntries(current, []);
  const stamp = () => new Date(Math.max(time(now()), ...rows.map(row => time(row.updatedAt)), 0) + 1).toISOString();
  if (op?.type === 'add') {
    if (!['wish', 'motto'].includes(op.kind) || typeof op.text !== 'string') throw new Error('invalidEntry');
    const at = stamp();
    const entry = { id: id(), kind: op.kind, text: op.text, order: Math.max(0, ...visibleAspireEntries(rows, op.kind).map(row => Number(row.order) || 0)) + 1,
      createdAt: at, updatedAt: at, contentUpdatedAt: at, orderUpdatedAt: at, deleted: false };
    return { records: mergeAspireEntries(rows, [entry]), entry };
  }
  if (op?.type === 'reorder') {
    const group = visibleAspireEntries(rows, op.kind);
    const before = group.map(row => row.id);
    if (!['wish', 'motto'].includes(op.kind) || !Array.isArray(op.ids) || !Array.isArray(op.expectedIds)
      || JSON.stringify(before) !== JSON.stringify(op.expectedIds)
      || op.ids.length !== before.length || new Set(op.ids).size !== before.length
      || op.ids.some(value => !before.includes(value))) throw new Error('conflict');
    if (JSON.stringify(before) === JSON.stringify(op.ids)) return { records: rows };
    // Reuse the notebook's guarded block-move helper to realize the new order.
    let ordered = group;
    for (let i = 0; i < op.ids.length; i += 1) {
      if (ordered[i].id !== op.ids[i]) ordered = moveNotebookItems(ordered, [op.ids[i]], ordered[i].id, false, ordered.map(row => row.id));
    }
    const at = stamp();
    const changes = ordered.map((row, index) => ({ ...row, order: index + 1, orderUpdatedAt: at, updatedAt: at }));
    return { records: mergeAspireEntries(rows, changes) };
  }
  const entry = rows.find(row => row.id === op?.id);
  if (!entry) throw new Error('missing');
  if (op.expectedContentUpdatedAt !== contentStamp(entry)) throw new Error('conflict');
  if (op.type === 'restore' ? !entry.deleted : entry.deleted) throw new Error('conflict');
  if (op.type === 'edit' && typeof op.text !== 'string') throw new Error('invalidEntry');
  if (!['edit', 'delete', 'restore'].includes(op.type)) throw new Error('invalidOperation');
  if (op.type === 'edit' && op.text === entry.text) return { records: rows, entry };
  const at = stamp();
  const next = { ...entry, contentUpdatedAt: at, updatedAt: at,
    ...(op.type === 'edit' ? { text: op.text } : op.type === 'delete' ? { deleted: true, deletedAt: at } : { deleted: false, restoredAt: at }) };
  return { records: mergeAspireEntries(rows, [next]), entry: next };
}

export const createAspireStore = (options = {}) => createJoboStore({ ...options, dbName: ASPIRE_DB_NAME, key: ASPIRE_STORAGE_KEY });

// The same strict store used by the ledger, with serialized operations and
// guarded local mutations. A failed local save stays in the editor; remote
// applies are held and retried until durable. Unloaded never means empty.
export function createAspireNotebook({ store = createAspireStore(), now, id, retryMs = 2000 } = {}) {
  let state = { records: undefined, loaded: false, writable: undefined, error: null };
  let held = [];
  let tail = Promise.resolve();
  let retry = null;
  const listeners = new Set();
  const publish = patch => {
    if (patch.records !== undefined && canonical(patch.records) === canonical(state.records)) patch.records = state.records;
    if (Object.entries(patch).every(([key, value]) => state[key] === value)) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const serial = work => { const result = tail.then(work); tail = result.catch(() => {}); return result; };
  const schedule = () => {
    if (retry !== null || !held.length) return;
    retry = setTimeout(() => { retry = null; serial(flush); }, retryMs);
    retry?.unref?.();
  };
  const checkedUpdate = async (fn) => {
    try { return await store.update(fn); }
    catch (error) { return { ok: false, error: error.message || 'storageWrite' }; }
  };
  async function flush() {
    if (!state.loaded) return { ok: true, held: true };
    // Draining is part of the acknowledgement: an apply can arrive during
    // any awaited write, including a restore's final durability barrier.
    while (held.length) {
      const batch = held;
      held = [];
      if (!state.writable) {
        publish({ records: mergeAspireEntries(state.records, batch) });
        continue;
      }
      const result = await checkedUpdate(current => {
        if (current !== undefined && !Array.isArray(current)) throw new Error('invalidStorage');
        return mergeAspireEntries(current, batch);
      });
      if (!result.ok) {
        held = mergeAspireEntries(held, batch);
        publish({ error: result.error });
        schedule();
        return result;
      }
      publish({ records: result.value, error: null });
    }
    return { ok: true, written: !!state.writable };
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load: () => serial(async () => {
      const [result, writable] = await Promise.all([store.read(), store.writable()]);
      if (!result.ok || (result.value !== undefined && !Array.isArray(result.value))) {
        publish({ records: undefined, loaded: false, writable, error: result.error || 'invalidStorage' });
        return state;
      }
      publish({ records: mergeAspireEntries(result.value, []), loaded: true, writable, error: null });
      await flush();
      return state;
    }),
    commit: op => serial(async () => {
      if (!state.loaded) return { ok: false, error: 'notLoaded' };
      if (!state.writable) return { ok: false, error: 'readOnly' };
      const incoming = held;
      let planned;
      const result = await checkedUpdate(current => {
        if (current !== undefined && !Array.isArray(current)) throw new Error('invalidStorage');
        planned = applyAspireOperation(mergeAspireEntries(current, incoming), op, { now, id });
        return planned.records;
      });
      if (!result.ok) { publish({ error: result.error }); return result; }
      // Remote applies may have arrived while the write was in flight. Keep
      // them queued; removing by id here would lose a newer version of a row.
      publish({ records: result.value, error: null });
      if (held.length) await flush();
      return { ok: true, entry: planned.entry };
    }),
    applyRemote: records => {
      if (!Array.isArray(records)) return Promise.resolve({ ok: false, error: 'notAList' });
      held = mergeAspireEntries(held, records);
      if (!state.loaded) return Promise.resolve({ ok: true, held: true });
      return serial(flush);
    },
    restore: records => serial(async () => {
      if (!Array.isArray(records)) return { ok: false, error: 'notAList' };
      if (!(await store.writable())) return { ok: false, error: 'readOnly' };
      // Replacing the snapshot supersedes only data already held when this
      // restore starts. Remote batches arriving during its write must survive.
      const previousHeld = held;
      held = [];
      const result = await checkedUpdate(() => mergeAspireEntries([], records));
      if (!result.ok) {
        held = mergeAspireEntries(previousHeld, held);
        publish({ error: result.error });
        schedule();
        return result;
      }
      publish({ records: result.value, loaded: true, writable: true, error: null });
      const flushed = await flush();
      // Restore callers reload on success. A late remote batch must be durable
      // too, or that reload would lose the retry queue we have accepted.
      return flushed.ok ? result : flushed;
    }),
    dispose() { if (retry !== null) clearTimeout(retry); retry = null; },
  };
}
