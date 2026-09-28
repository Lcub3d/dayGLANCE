// Label identity is independent of its display name and of task-title syntax.
// Legacy hashtags and Todoist's already-stored source labels are read through
// aliases; nothing rewrites titles, completion stamps or upstream source data.
import { extractTags, stripWikilinks } from '../utils/taskUtils.js';
export const labelKey = name => String(name).normalize('NFC').trim().toLowerCase();
export const labelId = name => `jobu-label:${encodeURIComponent(labelKey(name))}`;
export const labelTaskId = task => String(task._jobuLabelId ?? task.recurringTemplateId ?? task.id);
export const labelTaskEntity = task => `jobu-labels:${encodeURIComponent(labelTaskId(task))}`;
export const LABEL_COLORS = ['charcoal', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'magenta'];
export function validLabelName(name) {
  return typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 128 && !/[\u0000-\u001f\u007f]/.test(name);
}
export function sourceLabels(task) {
  return [...new Set([
    ...extractTags(stripWikilinks(String(task.title || ''))),
    ...(Array.isArray(task.todoist?.labels) ? task.todoist.labels.filter(validLabelName) : []),
  ].map(name => name.normalize('NFC')))];
}
export function validateOrganizerValue(kind, value) {
  if (kind === 'label') {
    if (!value || value.version !== 1 || !validLabelName(value.name) || typeof value.id !== 'string' || !value.id.startsWith('jobu-label:') || !LABEL_COLORS.includes(value.color) || typeof value.isFavorite !== 'boolean' || !Array.isArray(value.aliases) || value.aliases.length > 300 || !value.aliases.every(validLabelName)) throw Error('format');
  }
  if (kind === 'taskMeta' && value?.labels !== undefined) {
    const ids = value.labels;
    if (!ids || !Array.isArray(ids.add) || !Array.isArray(ids.remove) || ids.add.length + ids.remove.length > 1000 || ![...ids.add, ...ids.remove].every(id => typeof id === 'string' && id.startsWith('jobu-label:')) || new Set(ids.add).size !== ids.add.length || new Set(ids.remove).size !== ids.remove.length || ids.add.some(id => ids.remove.includes(id))) throw Error('format');
  }
}
export function buildLabelIndex(heads = new Map(), tasks = []) {
  const definitions = new Map(), aliases = new Map(), conflicts = [];
  // Deterministic order even when revisions arrived in a different sync order.
  for (const row of [...heads.values()].filter(row => row.kind === 'label').sort((a, b) => a.entityId < b.entityId ? -1 : 1)) {
    const value = row.value;
    if (!value?.name) continue;
    const def = { ...value, head: row.id, deleted: row.deleted, stored: true };
    definitions.set(row.entityId, def);
    for (const alias of [value.name, ...value.aliases]) {
      const key = labelKey(alias), prior = aliases.get(key);
      if (!prior) aliases.set(key, row.entityId);
      else if (prior !== row.entityId && !conflicts.includes(key)) conflicts.push(key);
    }
  }
  const resolve = name => aliases.get(labelKey(name)) || labelId(name);
  for (const task of tasks) for (const name of sourceLabels(task)) {
    const id = resolve(name);
    if (!definitions.has(id)) definitions.set(id, { id, name, color: 'charcoal', isFavorite: false, aliases: [name], head: null, stored: false, deleted: false });
  }
  const labelsFor = task => {
    const names = sourceLabels(task), base = names.map(resolve);
    const fallback = new Map(names.map(name => [resolve(name), { id: resolve(name), name, aliases: [name], color: 'charcoal', isFavorite: false, stored: false, deleted: false, head: null }]));
    const overlay = heads.get(labelTaskEntity(task));
    const edits = overlay && !overlay.deleted ? overlay.value?.labels : null;
    return [...new Set([...base, ...(edits?.add || [])])].filter(id => !(edits?.remove || []).includes(id)).map(id => definitions.get(id) || fallback.get(id)).filter(label => label && !label.deleted);
  };
  return { definitions, conflicts, resolve, labelsFor, namesFor: task => labelsFor(task).map(label => label.name) };
}
