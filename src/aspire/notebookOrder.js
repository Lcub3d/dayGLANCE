// Pure array-order helpers for the Aspire notebook.
// expectedIds is the captured order of the group being reordered. Passing it
// rejects a removed or reordered group member while retaining unrelated rows
// and the latest item content. Without it, the current order is used.
// Selected items move as one block in their current order, with object
// identities preserved. These helpers do not persist or synchronize the result.

export function moveNotebookItems(items, movingIds, targetId, after = false, expectedIds = items.map(item => item.id)) {
  const scope = new Set(expectedIds);
  const currentIds = items.filter(item => scope.has(item.id)).map(item => item.id);
  if (JSON.stringify(currentIds) !== JSON.stringify(expectedIds)) throw new Error('conflict');
  const ids = [...new Set(movingIds || [])].filter(id => scope.has(id));
  if (!ids.length || ids.length !== (movingIds || []).length || !scope.has(targetId)) throw new Error('missing');
  if (ids.includes(targetId)) return items;
  const selected = new Set(ids);
  const moving = items.filter(entry => selected.has(entry.id));
  if (moving.length !== ids.length || !items.some(entry => entry.id === targetId)) throw new Error('missing');
  const rest = items.filter(entry => !selected.has(entry.id));
  const position = rest.findIndex(entry => entry.id === targetId) + Number(after);
  rest.splice(position, 0, ...moving);
  return rest;
}

export function moveNotebookItem(items, id, targetId, after = false, expectedIds = items.map(item => item.id)) {
  return moveNotebookItems(items, [id], targetId, after, expectedIds);
}
