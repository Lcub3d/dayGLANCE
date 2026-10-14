// Frame Nudge planning: whether the "what should I do now?" suggestion can run,
// and which tasks it may offer. Pure, so the AI button and the request agree on
// one rule. Every refusal carries a reason: a nudge that silently does nothing
// is indistinguishable from a broken one.

export const FRAME_NUDGE_MIN_FRAME_MINUTES = 30; // frame must have MORE than this left
export const FRAME_NUDGE_MIN_FREE_MINUTES = 15;  // free slot must be at least this long
export const FRAME_NUDGE_MAX_CANDIDATES = 20;

const toMinutes = (time) => {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * @param {object} input
 * @param {number} input.nowMin           minutes since midnight
 * @param {Array}  input.frames           today's frame instances ({ start, end, ... })
 * @param {number} input.gapMinutes       free minutes until the next scheduled task
 * @param {Array}  input.inboxTasks       eligible inbox tasks (already filtered for visibility)
 * @param {Array}  input.todayTasks       today's tasks, any state
 * @returns {{ status: 'ok', frame, effectiveMinutes, candidates }
 *         | { status: 'no-frame' | 'frame-ending' | 'no-free-time' | 'no-fit', frame?, effectiveMinutes? }}
 */
export function planFrameNudge({ nowMin, frames, gapMinutes, inboxTasks, todayTasks }) {
  const frame = [...(frames || [])]
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .find(f => nowMin >= toMinutes(f.start) && nowMin < toMinutes(f.end));
  if (!frame) return { status: 'no-frame' };

  const minutesRemaining = toMinutes(frame.end) - nowMin;
  if (minutesRemaining <= FRAME_NUDGE_MIN_FRAME_MINUTES) return { status: 'frame-ending', frame };

  // Effective free time = gap to the next scheduled task or end of frame,
  // whichever is sooner, so a back-to-back calendar is not nudged.
  const effectiveMinutes = Math.min(minutesRemaining, gapMinutes);
  if (effectiveMinutes < FRAME_NUDGE_MIN_FREE_MINUTES) return { status: 'no-free-time', frame, effectiveMinutes };

  // Today's tasks are candidates only once their slot has passed: a task
  // scheduled now or later is already planned.
  const pastToday = (todayTasks || []).filter(t => {
    if (t.completed || t.imported || t.isExample) return false;
    if (t.startTime && toMinutes(t.startTime) + (t.duration || 30) > nowMin) return false;
    return true;
  });
  // A task with no duration always fits: we don't know how long it takes.
  const candidates = [
    ...(inboxTasks || []).map(t => ({ task: t, isInbox: true })),
    ...pastToday.map(t => ({ task: t, isInbox: false })),
  ]
    .filter(({ task }) => !task.duration || task.duration <= effectiveMinutes)
    .slice(0, FRAME_NUDGE_MAX_CANDIDATES);

  if (candidates.length === 0) return { status: 'no-fit', frame, effectiveMinutes };
  return { status: 'ok', frame, effectiveMinutes, candidates };
}

/**
 * Resolve the AI's answer against the candidates it was offered. Returns null
 * when the answer names no task, names one that was not offered, or names one
 * that does not fit the slot.
 */
export function resolveFrameNudgeAnswer(result, candidates, effectiveMinutes) {
  if (!result || result.taskId === undefined || result.taskId === null || result.taskId === '') return null;
  const matched = candidates.find(c => String(c.id) === String(result.taskId));
  if (!matched) return null;
  if (matched.duration && matched.duration > effectiveMinutes) return null;
  return {
    taskId: matched.id,
    taskTitle: matched.title,
    reason: typeof result.reason === 'string' ? result.reason : '',
    isInbox: matched.isInbox,
  };
}
