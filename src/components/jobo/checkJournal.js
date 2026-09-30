// A reading order over the committed day model, not another execution model.
// Group identity, history, comparisons and latest progress all come from it.
import { completionMarker } from '../../jobo/completionMarker.js';
import { civilCoordinate } from '../../jobo/viewDates.js';

const byId = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

function executionStart(record) {
  if (record.timing === 'timed') return civilCoordinate(record.date, record.startTime);
  const marker = completionMarker(record);
  return marker ? civilCoordinate(marker.date, marker.time) : null;
}

/** Plan groups first, then unplanned Do, in time order within each section.
 * Only groups with execution on the selected day belong to this journal.
 * Show their complete sessions, dated when outside this day, because the
 * model's comparison and latest progress refer to that full history too.
 */
export function buildCheckJournal(model) {
  if (!model) return null;
  const groups = new Map();
  const plans = new Map();
  for (const item of model.plans) {
    // Prefer the frozen title/plan to a renamed current task with the same key.
    if (!plans.has(item.groupKey) || item.id.startsWith('captured::')) plans.set(item.groupKey, item);
  }
  for (const item of [...model.timedRecords, ...model.untimedRecords]) {
    const group = groups.get(item.groupKey);
    if (group) group.startMinute = Math.min(group.startMinute, item.startMinute);
    else groups.set(item.groupKey, { item, startMinute: item.startMinute });
  }
  const entries = [...groups].map(([key, { item, startMinute }]) => {
    // The model already resolved winners, tombstones and visibility. Do not
    // re-read the ledger or regroup by task id (recurrences share that id).
    const attempts = [...item.attempts].sort((a, b) =>
      (executionStart(a) ?? Infinity) - (executionStart(b) ?? Infinity) || byId(a.id, b.id));
    const planItem = plans.get(key);
    const firstCaptured = item.attempts.at(-1) || item.record;
    return {
      key, startMinute, attempts,
      title: planItem?.task?.title ?? firstCaptured.title,
      plan: item.record.planSnapshot,
      sourceTask: item.sourceTask,
      notesRecord: item.record,
      comparison: item.comparison,
      comparisonMeta: item.comparisonMeta,
      labels: item.labels,
      latestAttempt: item.latestAttempt,
    };
  }).sort((a, b) => a.startMinute - b.startMinute || byId(a.key, b.key));
  return {
    planned: entries.filter(entry => entry.plan !== null),
    unplanned: entries.filter(entry => entry.plan === null),
    invalidRecordCount: model.invalidRecordCount,
  };
}

/** Civil coordinates, like the planner; adding a duration must not apply DST. */
export function checkPlanEnd(plan) {
  const start = civilCoordinate(plan?.date, plan?.startTime);
  if (start === null || !Number.isFinite(plan?.duration) || plan.duration <= 0) return null;
  const instant = new Date((start + plan.duration) * 60000);
  if (!Number.isFinite(instant.getTime())) return null;
  const end = instant.toISOString();
  return { date: end.slice(0, 10), time: end.slice(11, 16) };
}
