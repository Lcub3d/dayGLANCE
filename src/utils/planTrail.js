// The stops a task made between where it was first planned and where it sits
// now.
//
// `originalPlan` records the beginning and the task itself carries the end, so
// the history popover could say "planned for Monday 9am, now Friday 2pm" and
// nothing about the three moves in between. That is the question this answers:
// a task that slid Monday → Wednesday → Thursday → Friday is a different story
// from one moved once, and the two looked identical.
//
// WHAT GOES IN IT
// The same moves `deferrals` counts: a schedule change made after the task had
// already come due (utils/deferrals.js). Planning moves are left out for the
// reason they are left out of the count — dragging tomorrow's work around the
// timeline says something about how you plan, not about this task — and because
// a trail that grew on every drag would be mostly noise and would not fit in
// its cap.
//
// So the trail is the detail behind the count, not a second, competing number.
//
// BOUNDED, AND HONEST ABOUT IT
// Only the most recent TRAIL_CAP stops are kept. A task that slipped thirty
// times would otherwise carry thirty records forever, on every device, through
// every sync. The count keeps rising after the trail stops growing, which is
// exactly why `deferrals` is not derived from `trail.length`: the number stays
// true while the detail is necessarily partial, and the panel can say "showing
// the last 6 of 30" because it has both.

import { isDeferral } from './deferrals.js';

// Six stops plus the baseline and the current plan is eight lines — about as
// much as the popover holds before it stops being glanceable.
export const TRAIL_CAP = 6;

const key = (entry) => `${entry.at}|${entry.date}|${entry.startTime}`;

/** The schedule a task moved TO, and when the move was observed. */
const stopAt = (task, now) => ({
  at: now.getTime(),
  date: task.date,
  startTime: task.startTime,
});

const clean = (trail) => (Array.isArray(trail) ? trail : [])
  .filter((e) => e && e.date && e.startTime && Number.isFinite(Number(e.at)));

/**
 * Merge two trails. A union rather than a carry-forward or a last-writer-wins:
 * two devices can each have watched different slips, and either one dropping
 * the other's would lose history nothing can reconstruct.
 *
 * Union is the same family of rule as the count's max — order-independent,
 * idempotent, and safe to apply twice — which is what lets both survive a merge
 * without the two devices agreeing on anything first. Sorted by when the move
 * happened and trimmed to the most recent, so a merge cannot grow past the cap.
 */
export function mergePlanTrail(a, b) {
  const seen = new Map();
  for (const entry of [...clean(a), ...clean(b)]) {
    if (!seen.has(key(entry))) seen.set(key(entry), entry);
  }
  if (seen.size === 0) return undefined;
  const merged = [...seen.values()]
    .sort((x, y) => Number(x.at) - Number(y.at))
    .slice(-TRAIL_CAP);
  return merged;
}

/**
 * Return `currentTasks` with a stop appended for any task the edit since
 * `prevTasks` pushed back after it came due.
 *
 * Returns `currentTasks` ITSELF when nothing moved, so the persist pass can tell
 * by identity whether to write the result back into React state. That contract
 * is not decoration: `originalPlan` shipped once writing only to localStorage,
 * where the sync layer could not see it, and the next apply wrote state back
 * over it.
 */
export function stampPlanTrail(currentTasks, prevTasks, now = new Date(), todayStr) {
  const today = todayStr ?? [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const prevMap = new Map((prevTasks || []).map((t) => [String(t.id), t]));
  let changed = false;
  const out = currentTasks.map((task) => {
    const prevTask = prevMap.get(String(task.id));
    if (!isDeferral(prevTask, task, now, today)) return task;
    changed = true;
    return {
      ...task,
      planTrail: [...clean(task.planTrail), stopAt(task, now)].slice(-TRAIL_CAP),
    };
  });
  return changed ? out : currentTasks;
}

/**
 * Do two trails hold the same stops in the same order?
 *
 * The merge is a pure function that always returns a fresh array, so identity
 * says nothing about whether anything actually changed. Every caller needs to
 * know that — to skip a re-render, to decide whether a sync tier has to write
 * back — so the comparison lives here rather than being re-derived at each one.
 */
export function sameTrail(a, b) {
  const left = clean(a);
  const right = clean(b);
  return left.length === right.length && left.every((e, i) => key(e) === key(right[i]));
}

/**
 * Copy computed trails back onto the in-memory tasks, merging rather than
 * replacing.
 *
 * The persist pass works on a filtered array whose result cannot be written back
 * wholesale, so this enriches in place — the shape applyBaselines and
 * applyDeferrals use, with the union rule.
 */
export function applyPlanTrail(all, computed) {
  const byId = new Map(
    (computed || []).filter((t) => t && t.planTrail).map((t) => [String(t.id), t.planTrail]),
  );
  const list = all || [];
  let changed = false;
  const out = list.map((task) => {
    if (!task) return task;
    const incoming = byId.get(String(task.id));
    if (!incoming) return task;
    const merged = mergePlanTrail(task.planTrail, incoming);
    if (sameTrail(merged, task.planTrail)) return task;
    changed = true;
    return { ...task, planTrail: merged };
  });
  return changed ? out : list;
}

/**
 * The stops to show BETWEEN the baseline and the current plan.
 *
 * The last stop is normally where the task sits now, and the panel already ends
 * with that line under its own heading — repeating it would read as one move too
 * many. It is only dropped when it actually matches: a planning move made after
 * the final slip leaves the task somewhere the trail never recorded, and then
 * every stop really is intermediate.
 */
export function intermediatePlans(task) {
  const trail = clean(task?.planTrail);
  if (trail.length === 0) return [];
  const last = trail[trail.length - 1];
  const atCurrent = last.date === task.date && last.startTime === task.startTime;
  return atCurrent ? trail.slice(0, -1) : trail;
}

/**
 * How many slips happened before the ones the trail still holds.
 *
 * Measured against the count, which is uncapped, rather than against the trail,
 * which is not — that is the whole reason both exist. Every RECORDED stop is on
 * screen somewhere (the last one as "now scheduled", the rest as intermediates),
 * so the gap is the count minus the trail's length, not minus the intermediates.
 *
 * Never negative: a union can briefly leave the trail longer than a count that
 * has not merged yet.
 */
export function hiddenStops(task) {
  return Math.max(0, (Number(task?.deferrals) || 0) - clean(task?.planTrail).length);
}
