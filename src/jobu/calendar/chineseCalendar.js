import { Solar } from 'lunar-javascript';

// Civil labels in the Chinese calendar (UTC+08), NOT instants in the device's
// timezone. fromYmd avoids Date/Intl timezone shifts and works offline.
export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2100;
const cache = new Map();
const LUNAR_FESTIVALS = Object.freeze({
  '1-1': '春节', '1-15': '元宵节', '2-2': '龙抬头', '5-5': '端午节',
  '7-7': '七夕', '8-15': '中秋节', '9-9': '重阳节', '12-8': '腊八节',
});
const SOLAR_FESTIVALS = Object.freeze({ '1-1': '元旦', '5-1': '劳动节', '10-1': '国庆节' });

export function civilParts(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function chineseCalendarYear(year) {
  if (!Number.isInteger(year) || year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null;
  if (cache.has(year)) return cache.get(year);
  const result = {};
  for (let month = 1; month <= 12; month++) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const solar = Solar.fromYmd(year, month, day), lunar = solar.getLunar();
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const festivals = [];
      // A leap lunar month does not repeat the regular month's festivals.
      const festival = lunar.getMonth() > 0 && LUNAR_FESTIVALS[`${lunar.getMonth()}-${lunar.getDay()}`];
      if (festival) festivals.push(festival);
      if (lunar.getFestivals().includes('除夕')) festivals.push('除夕');
      if (SOLAR_FESTIVALS[`${month}-${day}`]) festivals.push(SOLAR_FESTIVALS[`${month}-${day}`]);
      const term = lunar.getJieQi();
      if (term === '清明') festivals.push('清明节');
      const lunarMonth = `${lunar.getMonthInChinese()}月`, lunarDay = lunar.getDayInChinese();
      result[date] = Object.freeze({ date, lunarYear: lunar.getYear(), lunarMonth, lunarDay,
        lunarMonthNumber: lunar.getMonth(), lunarDayNumber: lunar.getDay(),
        lunarText: `${lunar.getYear()}年${lunarMonth}${lunarDay}`, term,
        festivals: Object.freeze(festivals), isLeapMonth: lunar.getMonth() < 0 });
    }
  }
  Object.freeze(result);
  // Bounded derived cache; no task state or persistent store is involved.
  if (cache.size >= 3) cache.delete(cache.keys().next().value);
  cache.set(year, result);
  return result;
}

export function chineseDateMeta(date) {
  const parts = civilParts(date);
  return parts ? chineseCalendarYear(parts.year)?.[date] ?? null : null;
}

export function dateAnnotation(meta, options) {
  if (!meta) return null;
  if (options.festivals && meta.festivals.length) return { text: meta.festivals[0], kind: 'festival' };
  if (options.terms && meta.term) return { text: meta.term, kind: 'term' };
  if (options.lunar) return { text: meta.lunarDayNumber === 1 ? meta.lunarMonth : meta.lunarDay, kind: 'lunar' };
  return null;
}

// Preserve simultaneous events in tooltip/detail instead of losing the second
// event when the small day cell has room for only one calendrical line.
export function calendarDescription(meta, options) {
  if (!meta) return '';
  return [...new Set([
    ...(options.lunar ? [meta.lunarText] : []),
    ...(options.festivals ? meta.festivals : []),
    ...(options.terms && meta.term ? [meta.term] : []),
  ])].join(' · ');
}
