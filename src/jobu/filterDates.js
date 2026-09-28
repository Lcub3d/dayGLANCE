import { dayKey, validDay } from './year.js';

export const validClock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function shiftDay(day, offset) {
  if (!validDay(day) || !Number.isInteger(offset) || Math.abs(offset) > 36600) throw Error('filterDate');
  const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + offset);
  return dayKey(date);
}
function localStamp(day, time) {
  const value = new Date(`${day}T${time}:00`);
  // Do not normalize nonexistent civil times during a DST jump.
  return dayKey(value) === day && `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}` === time ? value.getTime() : null;
}
export function readDate(value, time = null) {
  if (typeof value !== 'string') return null;
  if (validDay(value)) return { day: value, time: validClock(time) ? time : null, instant: validClock(time) ? localStamp(value, time) : null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) || !validDay(value.slice(0, 10)) || !validClock(value.slice(11, 16))) return null;
  const date = new Date(value);
  if (!Number.isFinite(+date)) return null;
  return { day: dayKey(date), time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, instant: +date };
}
// A floating source clock with an explicit IANA zone must not be interpreted
// in the observing device's zone. Ambiguous/nonexistent source clocks are not
// invented; date/time predicates fail closed while the raw value stays intact.
function sourceDate(due) {
  const raw = due?.datetime || due?.date;
  if (typeof raw !== 'string' || !due?.timezone || !raw.includes('T') || /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return readDate(raw);
  if (!validDay(raw.slice(0, 10)) || !validClock(raw.slice(11, 16))) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: due.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = instant => Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const civil = Date.parse(`${raw.slice(0, 16)}:00Z`), offsets = new Set();
    for (const delta of [-86400000, 0, 86400000]) {
      const sample = civil + delta, p = parts(sample);
      offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - sample);
    }
    const candidates = [...offsets].map(offset => civil - offset).filter(instant => {
      const p = parts(instant); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === raw.slice(0, 16);
    });
    return candidates.length === 1 ? readDate(new Date(candidates[0]).toISOString()) : null;
  } catch { return null; }
}
export function rawTaskDate(task, mode = 'date') {
  if (mode === 'deadline') return typeof task.deadline === 'object' ? task.deadline?.date : task.deadline;
  return task.todoist && Object.hasOwn(task.todoist, 'due') ? task.todoist.due?.datetime || task.todoist.due?.date : task.date;
}
export function hasTaskDate(task, mode = 'date') { const value = rawTaskDate(task, mode); return value !== null && value !== undefined && value !== ''; }
// Source due fields and local time blocks are deliberately independent.
export function taskDate(task, mode = 'due') {
  const scheduled = task.todoist && Object.hasOwn(task.todoist, 'due') ? sourceDate(task.todoist.due) : readDate(task.date, task.isAllDay ? null : task.startTime);
  const deadline = readDate(rawTaskDate(task, 'deadline'));
  if (mode === 'date') return scheduled;
  if (mode === 'deadline') return deadline;
  return hasTaskDate(task) ? scheduled : deadline;
}
const dayWords = { today: 0, 今天: 0, 今日: 0, tomorrow: 1, 明天: 1, yesterday: -1, 昨天: -1, 后天: 2 };
const weekDays = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
export function parseFilterDate(text, { now = new Date(), today = dayKey(now) } = {}) {
  const q = text.toLowerCase().trim();
  if (!validDay(today) || !Number.isFinite(+now)) throw Error('filterDate');
  if (Object.hasOwn(dayWords, q)) return { day: shiftDay(today, dayWords[q]), time: null, instant: null };
  if (validDay(q)) return readDate(q);
  const relative = /^(?:in\s+)?([+-]?\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|分钟|小时|days?|天)$/.exec(q);
  if (relative) {
    const n = Number(relative[1]), unit = relative[2];
    if (!Number.isFinite(n) || Math.abs(n) > 36600) throw Error('filterDate');
    if (/^(day|天)/.test(unit)) return readDate(shiftDay(today, n));
    const date = new Date(+now + n * (/^(h|小时)/.test(unit) ? 3600000 : 60000));
    return { day: dayKey(date), time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, instant: +date };
  }
  if (Object.hasOwn(weekDays, q)) {
    const dow = new Date(`${today}T12:00:00`).getDay();
    return readDate(shiftDay(today, (weekDays[q] - dow + 7) % 7));
  }
  // Explicit clocks, not a permissive Date.parse of arbitrary prose.
  const clock = /^(today|tomorrow|yesterday|今天|明天|昨天|\d{4}-\d{2}-\d{2})(?:\s+at\s+|\s+|t)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(q);
  if (clock) {
    const day = parseFilterDate(clock[1], { now, today }).day;
    let h = Number(clock[2]); const m = Number(clock[3] || 0);
    if (clock[4]) { if (h < 1 || h > 12) throw Error('filterDate'); h = h % 12 + (clock[4] === 'pm' ? 12 : 0); }
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (!validClock(time)) throw Error('filterDate');
    const instant = localStamp(day, time);
    if (instant === null) throw Error('filterDate');
    return { day, time, instant };
  }
  throw Error('filterDate');
}
export function compareDate(value, target, operator) {
  if (!value) return false;
  if (operator === 'on') return value.day === target.day;
  // A date-only task is not an invented midnight appointment. It participates
  // on earlier/later days, but never in an hour window within its undated time.
  if (target.time && value.day === target.day && !value.time) return false;
  const a = target.time && value.time ? value.instant : value.day;
  const b = target.time && value.time ? target.instant : target.day;
  if (a === null || b === null) return false;
  return operator === 'before' ? a < b : a > b;
}
