// Compare every selected block before deleting any of them. A stale multi-tab
// selection must never turn into a partial delete.
export function removeNotebookBlocks(items, expected) {
  const ids = new Set(expected.map(item => item.id));
  if (!ids.size || ids.size !== expected.length) throw new Error('missing');
  for (const item of expected) {
    if (JSON.stringify(items.find(live => live.id === item.id)) !== JSON.stringify(item)) throw new Error('conflict');
  }
  return items.filter(item => !ids.has(item.id));
}

export function restoreNotebookBlocks(items, entries, limit) {
  const ids = new Set(entries.map(entry => entry.item.id));
  if (ids.size !== entries.length || items.some(item => ids.has(item.id))) throw new Error('conflict');
  if (items.length + entries.length > limit) throw new Error('limit');
  const restored = [...items];
  for (const { item, index } of [...entries].sort((a, b) => a.index - b.index)) {
    restored.splice(Math.min(index, restored.length), 0, item);
  }
  return restored;
}
