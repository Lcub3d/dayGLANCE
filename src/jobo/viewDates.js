// Civil planner coordinates only. These are not timezone-adjusted instants.
export function validCivilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function civilDayMinute(date) {
  return validCivilDate(date) ? Date.parse(`${date}T00:00:00.000Z`) / 60000 : null;
}

export function clockMinute(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function civilCoordinate(date, time) {
  const day = civilDayMinute(date), minute = clockMinute(time);
  return day === null || minute === null ? null : day + minute;
}
