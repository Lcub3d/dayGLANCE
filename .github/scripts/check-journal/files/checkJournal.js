import { completionMoment } from '../../jobo/completionMarker.js';
import { civilCoordinate, civilDayMinute } from '../../jobo/viewDates.js';

const compareId = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

// Civil coordinates for ordering, not elapsed-time calculations. A completion
// stamp is a point, never an invented execution interval. Other untimed work
// has no known execution time and sorts after the timed entries.
export function journalMoment(record) {
  if (record?.timing === 'timed') return { date: record.date, time: record.startTime };
  return record?.source === 'completion' ? completionMoment(record.createdAt) : null;
}

const coordinate = record => {
  const moment = journalMoment(record);
  return moment ? civilCoordinate(moment.date, moment.time) : null;
};
const compareAttempts = (a, b) => (coordinate(a) ?? Infinity) - (coordinate(b) ?? Infinity)
  || compareId(a.id, b.id);

/**
 * Presentation only: use the committed day model's grouping, task resolution,
 * comparisons and latest progress. Do not re-group by task ID, reclassify time,
 * or consume the timeline's display-only completion estimates.
 *
 * A Plan group is one entry with its sessions. Unplanned groups follow the
 * same model identity (unlinked Do are already independent). The union is
 * ordered by its first execution on this day, with an off-day group's Plan
 * time as fallback. Sessions from other days retain their full dates so the
 * history and comparison cannot silently disagree.
 */
export function buildCheckJournal(model, date) {
  if (!model) return [];
  const entries = new Map();
  for (const item of model.plans || []) {
    if (!item.attempts?.length) continue; // A journal is not an unchecked task list.
    const key = item.groupKey || item.id;
    if (entries.has(key)) continue; // A renamed live Plan may repeat its capture.
    entries.set(key, { ...item, id: key, title: item.task?.title || item.attempts[0]?.title || '', sessions: item.attempts.slice().sort(compareAttempts), visible: [] });
  }
  for (const item of [...(model.timedRecords || []), ...(model.untimedRecords || [])]) {
    if (!item.record) continue;
    const key = item.groupKey || item.id;
    if (!entries.has(key)) {
      entries.set(key, {
        ...item, id: key, title: item.record.title, plan: item.record.planSnapshot,
        sessions: (item.attempts?.length ? item.attempts : [item.record]).slice().sort(compareAttempts),
        visible: [],
      });
    }
    entries.get(key).visible.push(item);
  }
  const day = civilDayMinute(date);
  return [...entries.values()].map(entry => {
    const known = entry.visible.map(item => {
      // Timed slices are clipped by the model; recurring Z markers were also
      // projected there. A manual untimed row's creation stamp is not work time.
      if (item.record.timing !== 'timed' && item.record.source !== 'completion') return null;
      return day != null && Number.isFinite(item.startMinute) ? day + item.startMinute : null;
    }).filter(value => value != null);
    const start = known.length ? Math.min(...known)
      : entry.plan ? civilCoordinate(entry.plan.date, entry.plan.startTime) : null;
    return {
      ...entry, order: start ?? Infinity,
      hasOtherDays: entry.sessions.some(record => {
        const moment = journalMoment(record);
        return (moment && moment.date !== date) || (record.timing === 'timed' && record.endDate !== date);
      }),
    };
  }).sort((a, b) => a.order - b.order || compareId(a.id, b.id));
}

/** Render a full civil interval, not the slice clipped for a calendar column. */
export function journalRange(startDate, startTime, endDate, endTime, date, formatTime) {
  const start = `${startDate !== date ? `${startDate} ` : ''}${formatTime(startTime)}`;
  const end = `${endDate !== date || endDate !== startDate ? `${endDate} ` : ''}${formatTime(endTime)}`;
  return `${start}–${end}`;
}

export function journalPlanRange(plan, date, formatTime) {
  if (!plan) return null;
  const start = civilCoordinate(plan.date, plan.startTime);
  if (start == null || !Number.isFinite(plan.duration) || plan.duration <= 0) return null;
  const end = new Date((start + plan.duration) * 60000).toISOString();
  return journalRange(plan.date, plan.startTime, end.slice(0, 10), end.slice(11, 16), date, formatTime);
}
