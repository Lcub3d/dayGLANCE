import { defaultDocument, validateDocument } from '../lifeplanner/model.js';
import { STORAGE_KEY, BACKUP_FORMAT } from '../lifeplanner/store.js';
import { jobuValues, materializeJobu, stable } from './data.js';
const LIFE = new Set(['lifeWish', 'lifeMotto', 'lifeOrder']);
function documentFrom(records, defaults) {
  const order = jobuValues(records, 'lifeOrder')[0]?.value;
  if (!order) return defaults;
  const sorted = (kind, ids) => jobuValues(records, kind).sort((a,b) => {
    const rank = id => { const n = ids.indexOf(id); return n < 0 ? Number.MAX_SAFE_INTEGER : n; };
    return rank(a.value.id) - rank(b.value.id) || a.entityId.localeCompare(b.entityId, 'en');
  }).map(row => row.value);
  const doc = { version: 1, revision: records.filter(r => LIFE.has(r.kind)).length,
    updatedAt: records.filter(r => LIFE.has(r.kind)).map(r => r.updatedAt).sort().at(-1) || defaults.updatedAt,
    wishes: sorted('lifeWish', order.wishes), principles: sorted('lifeMotto', order.principles) };
  return validateDocument(doc);
}
function changesFor(before, after) {
  const map = doc => new Map([
    ...doc.wishes.map(w => [`lifeWish:${w.id}`, { kind: 'lifeWish', value: w }]),
    ...doc.principles.map(p => [`lifeMotto:${p.id}`, { kind: 'lifeMotto', value: p }]),
    ['lifeOrder', { kind: 'lifeOrder', value: { wishes: doc.wishes.map(w => w.id), principles: doc.principles.map(p => p.id) } }],
  ]);
  const a = map(before), b = map(after), changes = [];
  for (const [entityId, row] of b) if (stable(a.get(entityId)) !== stable(row)) changes.push({ entityId, ...row });
  for (const [entityId, row] of a) if (!b.has(entityId)) changes.push({ entityId, ...row, deleted: true });
  return changes;
}
export function createDurablePlannerStore(data, { defaults = [], storage = globalThis.localStorage } = {}) {
  const blank = defaultDocument(defaults); let cachedRecords, cached = blank, migrationError = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());
  const adapter = {
    get: () => {
      const records = data.get().records;
      if (records !== cachedRecords) {
        try { cached = documentFrom(records || [], blank); cachedRecords = records; } catch { migrationError = 'format'; }
      }
      return cached;
    },
    error: () => migrationError || (['storageRead','format'].includes(data.get().error) ? data.get().error : null) || (!data.get().loaded ? 'loading' : !data.get().writable ? 'readOnly' : null),
    subscribe: fn => { listeners.add(fn); const off = data.subscribe(fn); return () => { listeners.delete(fn); off(); }; },
    async load() {
      await data.load();
      if (!data.get().loaded || !data.get().writable || materializeJobu(data.get().records).has('lifeOrder')) return;
      let doc;
      try { const raw = storage?.getItem(STORAGE_KEY); doc = raw === null || raw === undefined ? blank : validateDocument(JSON.parse(raw)); }
      catch { migrationError = 'format'; notify(); return; }
      try {
        await data.transact((records, heads) => heads.has('lifeOrder') ? [] : [...changesFor({ wishes: [], principles: [] }, doc).filter(c => c.kind !== 'lifeOrder'), { entityId: 'lifeOrder', kind: 'lifeOrder', value: { wishes: doc.wishes.map(w => w.id), principles: doc.principles.map(p => p.id) } }]);
      migrationError = null; notify();
      } catch { migrationError = 'storageWrite'; notify(); }
      // Legacy data remains untouched: migration is not destructive.
    },
    async commit(transform, expectedRevision) {
      if (adapter.error()) throw new Error(adapter.error());
      await data.transact(records => {
        const before = documentFrom(records, blank);
        if (expectedRevision != null && before.revision !== expectedRevision) throw new Error('conflict');
        const after = validateDocument({ ...transform(structuredClone(before)), revision: before.revision + 1, updatedAt: new Date().toISOString() });
        return changesFor(before, after);
      });
      return adapter.get();
    },
    backup: () => JSON.stringify({ format: BACKUP_FORMAT, version: 1, document: adapter.get() }, null, 2),
    rawBackup: () => storage?.getItem(STORAGE_KEY) || adapter.backup(),
    restore: async (text, expectedRevision) => {
      let parsed; try { parsed = JSON.parse(text); if (parsed.format !== BACKUP_FORMAT || parsed.version !== 1) throw new Error(); validateDocument(parsed.document); } catch { throw new Error('format'); }
      return adapter.commit(() => parsed.document, expectedRevision);
    },
    dispose() {},
  };
  return adapter;
}
