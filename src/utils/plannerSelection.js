// The Project Planner's task selection while its notes sidebar is open.
// Pure: which task the arrow keys land on.
//
// `lists` is the visible columns in screen order, each `{ column, ids }`
// with its tasks' ids top to bottom ('scheduled', then 'unscheduled'; a
// hidden column is left out). Up and Down move within a column and stop at
// its ends; Left and Right move to the neighbouring column at the same row,
// or its last task when it is shorter. With nothing selected, any arrow
// lands on the first task of the first column that has one.

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export const isSelectionKey = (key) => ARROWS.has(key);

/** The id the key selects, or `selectedId` when it goes nowhere. */
export function moveSelection(lists, selectedId, key) {
  const columns = (lists || []).filter((list) => list.ids.length > 0);
  if (!isSelectionKey(key) || columns.length === 0) return selectedId ?? null;
  const at = columns.findIndex((list) => list.ids.includes(selectedId));
  if (at === -1) return columns[0].ids[0];
  const { ids } = columns[at];
  const row = ids.indexOf(selectedId);
  if (key === 'ArrowUp') return ids[Math.max(0, row - 1)];
  if (key === 'ArrowDown') return ids[Math.min(ids.length - 1, row + 1)];
  const next = columns[at + (key === 'ArrowRight' ? 1 : -1)];
  return next ? next.ids[Math.min(row, next.ids.length - 1)] : selectedId;
}
