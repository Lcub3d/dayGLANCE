// JOBO on the phone (slice 8, docs/jobo-mobile.md): the rules behind the two
// lanes, kept pure. One side is wide with full cards, the other a narrow lane
// of bars; Plan stays on the left and Do on the right, and a swap changes
// their widths, never their order.

/** The narrow lane's width, and the phone timeline's hour gutter (MOBILE_HOUR_GUTTER_W). */
export const NARROW_LANE_PX = 44;
export const HOUR_GUTTER_PX = 48;
/** The divider between the sides: a blue line, wider than the hour lines. */
export const DIVIDER_PX = 2;
/** The swap's slide, in ms; instant with reduced motion. */
export const SWAP_MS = 250;

/**
 * Which side opens wide: Plan for today and later, where the day is still to
 * be planned; Do for past days, where what happened is the question.
 */
export const planWideByDefault = (date, today) => !(date < today);

/**
 * Whether Plan is the wide side on `date`. A swap holds while you stay on
 * its date; on any other date the default stands again.
 *
 * @param {{ date: string, planWide: boolean } | null} swap the last swap
 */
export function planIsWide(swap, date, today) {
  return swap && swap.date === date ? swap.planWide : planWideByDefault(date, today);
}

/** The swap state after one swap on `date`. */
export const swapped = (swap, date, today) => ({ date, planWide: !planIsWide(swap, date, today) });

/**
 * The two sides' widths for a view `total` px wide: the wide side takes all
 * but the hour gutter, the divider and the narrow lane. Never negative on a
 * tiny screen.
 */
export function laneWidths(total, planWide) {
  const wide = Math.max(0, Math.round(total) - HOUR_GUTTER_PX - DIVIDER_PX - NARROW_LANE_PX);
  return {
    wide,
    plan: planWide ? wide : NARROW_LANE_PX,
    do: planWide ? NARROW_LANE_PX : wide,
  };
}

/**
 * A Do item as a bar in the narrow lane: its interval at `hourHeight` px an
 * hour, at least 3px tall so a short attempt or a completion moment still
 * shows, in its overlap column. The colour is its task's; unlinked work is
 * grey, as on the Do cards.
 */
export function doBar(item, hourHeight) {
  const top = item.startMinute * hourHeight / 60;
  const height = Math.max(3, (item.endMinute - item.startMinute) * hourHeight / 60 - 1);
  return {
    top,
    height,
    leftPct: item.leftPct ?? 0,
    widthPct: item.widthPct ?? 100,
    color: item.task?.color || item.sourceTask?.color || 'bg-gray-500',
    taskId: item.sourceTask?.id ?? null,
  };
}

/** The task a tap in a lane landed on, from the bar under it (`data-jobo-bar-task`), or null. */
export function tappedTaskId(target) {
  const bar = target?.closest?.('[data-jobo-bar-task]');
  const id = bar?.getAttribute('data-jobo-bar-task');
  return id ? id : null;
}
