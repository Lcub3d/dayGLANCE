import { completionMoment } from '../../jobo/completionMarker.js';
import { civilCoordinate, civilDayMinute } from '../../jobo/viewDates.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';

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

/** Group only this day's executions, using the day model's existing anchors. */
export function buildCheckJournal(model, date) {
  if (!model) return [];
  const plans = new Map();
  for (const item of model.plans || []) {
    const key = item.groupKey || item.id;
    if (!plans.has(key)) plans.set(key, item);
  }
  const entries = new Map();
  for (const item of [...(model.timedRecords || []), ...(model.untimedRecords || [])]) {
    if (!item.record) continue;
    const key = item.groupKey || item.id;
    if (!entries.has(key)) {
      const planItem = plans.get(key);
      const anchor = planItem || item;
      entries.set(key, {
        ...anchor, id: key,
        title: planItem?.task?.title || item.record.title,
        plan: anchor.plan || item.record.planSnapshot,
        // Keep the full group so sessions agree with the existing comparison.
        sessions: (anchor.attempts?.length ? anchor.attempts : [item.record]).slice().sort(compareAttempts),
        visible: [],
      });
    }
    entries.get(key).visible.push(item);
  }
  const day = civilDayMinute(date);
  return [...entries.values()].map(entry => {
    const known = entry.visible.map(item => {
      // The model already clips timed intervals and projects completion points.
      // A manual save timestamp (or Plan time) is not an execution timestamp.
      if (item.record.timing !== 'timed' && item.record.source !== 'completion') return null;
      return day != null && Number.isFinite(item.startMinute) ? day + item.startMinute : null;
    }).filter(value => value != null);
    return { ...entry, order: known.length ? Math.min(...known) : Infinity };
  }).sort((a, b) => a.order - b.order || compareId(a.id, b.id));
}

/** Format a civil date with the same locale helper as the other day headings. */
export function journalDate(date, language, referenceDate = date) {
  // Treat a stored civil date like the app's other date headings, not UTC
  // midnight. Keep the year when a related session crosses a year boundary.
  return formatLocalizedDate(new Date(`${date}T12:00:00`), {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(date.slice(0, 4) !== referenceDate.slice(0, 4) ? { year: 'numeric' } : {}),
  }, language);
}

/** Render a full civil interval, not the slice clipped for a calendar column. */
export function journalRange(startDate, startTime, endDate, endTime, date, formatTime, language) {
  const start = `${startDate !== date ? `${journalDate(startDate, language, date)} ` : ''}${formatTime(startTime)}`;
  const end = `${endDate !== date || endDate !== startDate ? `${journalDate(endDate, language, date)} ` : ''}${formatTime(endTime)}`;
  return `${start}–${end}`;
}

export function journalPlanRange(plan, date, formatTime, language) {
  if (!plan) return null;
  const start = civilCoordinate(plan.date, plan.startTime);
  if (start == null || !Number.isFinite(plan.duration) || plan.duration <= 0) return null;
  const end = new Date((start + plan.duration) * 60000).toISOString();
  return journalRange(plan.date, plan.startTime, end.slice(0, 10), end.slice(11, 16), date, formatTime, language);
}
