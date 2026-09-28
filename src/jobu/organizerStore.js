import { materializeJobu } from './data.js';
import { buildLabelIndex, labelId, labelKey, labelTaskId, labelTaskEntity, validLabelName, validateOrganizerValue } from './labels.js';

const checkHead = (heads, id, expected) => {
  if (expected === undefined || (heads.get(id)?.id ?? null) !== expected) throw Error('conflict');
};
export function savePersonalFilter(data, value, { entityId = `filter:${crypto.randomUUID()}`, expectedHead = null, deleted = false } = {}) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.query !== 'string' || !value.query.trim() || value.query.length > 2000) throw Error('filter');
  return data.transact((_records, heads) => {
    checkHead(heads, entityId, expectedHead);
    const previous = heads.get(entityId);
    if (previous && previous.kind !== 'filter') throw Error('format');
    return [{ entityId, kind: 'filter', value: { ...previous?.value, ...value, id: previous?.value?.id || entityId, name: value.name.trim() }, deleted }];
  });
}
export function saveLabel(data, input, { expectedHead = null, deleted = false, sourceNames = [] } = {}) {
  const name = String(input.name || '').normalize('NFC').trim(), id = input.id || labelId(name);
  if (!validLabelName(name)) throw Error('labelName');
  return data.transact((_records, heads) => {
    checkHead(heads, id, expectedHead);
    const old = heads.get(id);
    if (old && old.kind !== 'label') throw Error('format');
    const aliases = [...new Set([...(old?.value.aliases || []), ...(input.aliases || []), ...(old?.value.name ? [old.value.name] : []), name])];
    // Renames retain aliases for memberships, not query aliases. Tombstones
    // reserve identity, so restoring a label cannot steal another one's tasks.
    for (const row of heads.values()) if (row.kind === 'label' && row.entityId !== id) {
      const claimed = new Set([row.value.name, ...row.value.aliases].map(labelKey));
      if (aliases.some(alias => claimed.has(labelKey(alias)))) throw Error('labelDuplicate');
    }
    const owned = new Set([...(old?.value.aliases || input.aliases || []), old?.value.name || ''].filter(Boolean).map(labelKey));
    if (!deleted && sourceNames.some(source => labelKey(source) === labelKey(name) && labelId(source) !== id && !owned.has(labelKey(source)))) throw Error('labelDuplicate');
    const value = { version: 1, id, name, aliases, color: input.color || 'charcoal', isFavorite: !!input.isFavorite };
    validateOrganizerValue('label', value);
    return [{ entityId: id, kind: 'label', value, deleted }];
  });
}
export function setTaskLabel(data, task, label, enabled, expectedHead) {
  const entityId = labelTaskEntity(task);
  return data.transact((_records, heads) => {
    checkHead(heads, entityId, expectedHead);
    const labelRow = heads.get(label.id);
    if ((labelRow?.id ?? null) !== label.head || labelRow?.deleted) throw Error('conflict');
    if (!labelRow) for (const row of heads.values()) if (row.kind === 'label' && [row.value.name, ...row.value.aliases].some(name => labelKey(name) === labelKey(label.name))) throw Error('conflict');
    const previous = heads.get(entityId);
    if (previous && previous.kind !== 'taskMeta') throw Error('format');
    const value = { ...(previous?.deleted ? {} : previous?.value), taskId: labelTaskId(task) };
    const add = new Set(value.labels?.add || []), remove = new Set(value.labels?.remove || []);
    if (enabled) { add.add(label.id); remove.delete(label.id); } else { add.delete(label.id); remove.add(label.id); }
    value.labels = { add: [...add].sort(), remove: [...remove].sort() };
    validateOrganizerValue('taskMeta', value);
    // Persist a discovered native/source label at the same time as the first
    // assignment. Never depend on a derived catalog surviving a reload.
    const changes = labelRow ? [] : [{ entityId: label.id, kind: 'label', value: { version: 1, id: label.id, name: label.name, aliases: label.aliases, color: label.color, isFavorite: label.isFavorite } }];
    return [...changes, { entityId, kind: 'taskMeta', value }];
  });
}
export function organizerState(records, tasks) {
  const heads = materializeJobu(records || []);
  return { heads, labels: buildLabelIndex(heads, tasks), filters: [...heads.values()].filter(r => r.kind === 'filter' && !r.deleted).sort((a, b) => Number(!!b.value.isFavorite) - Number(!!a.value.isFavorite) || (a.value.order || 0) - (b.value.order || 0) || a.entityId.localeCompare(b.entityId)) };
}
