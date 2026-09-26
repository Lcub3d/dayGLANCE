import { nativeDoCompletionState } from './completionBridge.js';

// Aggregate by native task/recurring instance, never by the Do's display date.
// Different captured plans can still represent the same task instance.
export function latestDoForTask(ctx, record) {
  const state = nativeDoCompletionState(ctx, record);
  if (!state) return null;
  const rows = (ctx.records || []).filter(row => !row.deleted
    && nativeDoCompletionState(ctx, row)?.id === state.id);
  const timed = rows.filter(row => row.timing === 'timed');
  // Untimed rows have no timeline position. Only when no timed rows remain,
  // use the latest created Untimed row. updatedAt never changes that order.
  const candidates = timed.length ? timed : rows;
  const order = row => timed.length
    ? `${row.date}T${row.startTime}|${row.endDate}T${row.endTime}|${row.createdAt}|${row.id}`
    : `${row.createdAt}|${row.id}`;
  return candidates.reduce((last, row) => !last || order(row) > order(last) ? row : last, null);
}
