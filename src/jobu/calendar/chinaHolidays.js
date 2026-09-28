import { civilParts } from './chineseCalendar.js';

// Official national day-off / makeup-workday arrangements, not a payroll
// classification of statutory-holiday entitlement. Weekends in a holiday span
// are included. Regional / employer-specific schedules are deliberately absent.
export const CHINA_HOLIDAY_SCHEDULES = Object.freeze({
  2025: Object.freeze({
    published: '2024-11-12', notice: '国办发明电〔2024〕12号',
    source: 'https://www.gov.cn/zhengce/content/202411/content_6986382.htm',
    mirror: 'https://www.kashi.gov.cn/ksdqxzgs/c115966/202411/e116097ae08f4324ae5802863f2a96ba.shtml',
    breaks: [
      ['元旦', '01-01', '01-01', []],
      ['春节', '01-28', '02-04', ['01-26', '02-08']],
      ['清明节', '04-04', '04-06', []],
      ['劳动节', '05-01', '05-05', ['04-27']],
      ['端午节', '05-31', '06-02', []],
      ['国庆节 / 中秋节', '10-01', '10-08', ['09-28', '10-11']],
    ],
  }),
  2026: Object.freeze({
    published: '2025-11-04', notice: '国办发明电〔2025〕7号',
    source: 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm',
    mirror: 'https://www.bjdch.gov.cn/zwgk/hygq/202601/t20260123_4459144.html',
    breaks: [
      ['元旦', '01-01', '01-03', ['01-04']],
      ['春节', '02-15', '02-23', ['02-14', '02-28']],
      ['清明节', '04-04', '04-06', []],
      ['劳动节', '05-01', '05-05', ['05-09']],
      ['端午节', '06-19', '06-21', []],
      ['中秋节', '09-25', '09-27', []],
      ['国庆节', '10-01', '10-07', ['09-20', '10-10']],
    ],
  }),
});

export function chinaHolidaySchedule(year) {
  const data = CHINA_HOLIDAY_SCHEDULES[year];
  if (!data) return null;
  return { ...data, year, breaks: data.breaks.map(([name, start, end, workdays]) => ({
    name, start: `${year}-${start}`, end: `${year}-${end}`,
    workdays: workdays.map(day => `${year}-${day}`),
    days: Math.round((Date.parse(`${year}-${end}T12:00:00Z`) - Date.parse(`${year}-${start}T12:00:00Z`)) / 86400000) + 1,
  })) };
}

export function chinaHoliday(date) {
  const parts = civilParts(date);
  const schedule = parts && chinaHolidaySchedule(parts.year);
  if (!schedule) return null; // Unknown year MUST NOT be predicted from festivals.
  for (const holiday of schedule.breaks) {
    if (holiday.workdays.includes(date)) return { ...holiday, type: 'work', source: schedule.source };
    if (date >= holiday.start && date <= holiday.end) return { ...holiday, type: 'rest', source: schedule.source };
  }
  return null;
}
