// Presentation-only calendar helpers. Date grids and clamped navigation use
// the same civil-day arithmetic as MONTH; Year 2 owns no records or storage.
import { monthGridDates, shiftDateByMonths, adjacentDay } from '../utils/monthGrid.js';
import { dayCellItemKind } from '../utils/monthCellLayout.js';

export const YEAR2_MIN = 1900;
export const YEAR2_MAX = 2200;

export function year2Months(year, weekStartDay = 0) {
  if (!Number.isInteger(year) || year < YEAR2_MIN || year > YEAR2_MAX) throw new RangeError('Invalid calendar year');
  const firstDay = Number.isInteger(weekStartDay) && weekStartDay >= 0 && weekStartDay <= 6 ? weekStartDay : 0;
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const grid = monthGridDates(year, month, firstDay);
    const cells = [...grid.cells];
    // Equal-height months, including February. Out-of-month cells are blanks,
    // not duplicate actionable dates from neighbouring months.
    while (cells.length < 42) {
      const last = cells[cells.length - 1];
      const { dateStr } = adjacentDay(last.dateStr, 1);
      cells.push({ dateStr, day: Number(dateStr.slice(-2)), weekday: (last.weekday + 1) % 7, inMonth: false });
    }
    return { year, month, weekdays: grid.weekdays, cells };
  });
}

export function year2Range(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function shiftYear2Date(date, delta) {
  const year = Math.max(YEAR2_MIN, Math.min(YEAR2_MAX, date.getFullYear() + delta));
  return shiftDateByMonths(date, (year - date.getFullYear()) * 12);
}

export function year2Items(items = []) {
  const seen = new Set();
  return items.filter(item => {
    if (!item || item.deleted || item.isExample) return false;
    const key = `${dayCellItemKind(item)}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const allDay = Number(!!b.isAllDay) - Number(!!a.isAllDay);
    if (allDay) return allDay;
    const at = a.startTime || '', bt = b.startTime || '';
    return at < bt ? -1 : at > bt ? 1 : String(a.id).localeCompare(String(b.id));
  });
}
