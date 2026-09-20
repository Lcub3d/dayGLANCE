import { CATEGORY_IDS, createWish, MAX_WISHES, updateWish } from './model.js';

// Templates are a view, not stored wishes. Visiting the assistant must never
// create goals or count example copy as something the user has written.
export function notebookCategories(wishes) {
  return CATEGORY_IDS.map(id => ({ id, wishes: wishes.filter(wish => wish.category === id) }));
}

export function moveNotebookItem(items, id, targetId, after = false, expectedIds = items.map(item => item.id)) {
  const scope = new Set(expectedIds);
  const currentIds = items.filter(item => scope.has(item.id)).map(item => item.id);
  if (JSON.stringify(currentIds) !== JSON.stringify(expectedIds)) throw new Error('conflict');
  if (!scope.has(id) || !scope.has(targetId)) throw new Error('missing');
  if (id === targetId) return items;
  const item = items.find(entry => entry.id === id);
  if (!item || !items.some(entry => entry.id === targetId)) throw new Error('missing');
  const rest = items.filter(entry => entry.id !== id);
  const position = rest.findIndex(entry => entry.id === targetId) + Number(after);
  rest.splice(position, 0, item);
  return rest;
}

export function commitNotebookText(doc, draft) {
  const text = draft.text.trim();
  if (!text || text.length > 2000) throw new Error('title');
  const isWish = draft.kind === 'wish';
  if (!isWish && draft.kind !== 'principle') throw new Error('format');
  const collection = isWish ? 'wishes' : 'principles';
  const field = isWish ? 'title' : 'text';
  const live = doc[collection].find(item => item.id === draft.id);
  if (draft.isNew && !live) {
    if (doc[collection].length >= MAX_WISHES) throw new Error('limit');
    const item = isWish ? createWish(text, draft.category || 'other', draft.id) : { id: draft.id, text };
    return { ...doc, [collection]: [...doc[collection], item] };
  }
  if (!live) throw new Error('missing');
  // A retry of an already-persisted new row is idempotent; a conflicting
  // external edit is never overwritten by the input that happened to blur last.
  if (live[field] === text) return doc;
  if (live[field] !== draft.before) throw new Error('conflict');
  return isWish ? updateWish(doc, draft.id, { title: text }) : {
    ...doc, principles: doc.principles.map(item => item.id === draft.id ? { ...item, text } : item),
  };
}
