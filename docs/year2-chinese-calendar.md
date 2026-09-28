# Year 2: optional Chinese calendar layers

Fork-local follow-up to #29, based on `product/jobu` at `51513fbbc548a541529bd0aed308921875359b6c`.

## Presentation

The Gregorian date stays primary. One subdued line shows a festival, solar term,
lunar month name (on its first day) or lunar day, in that priority order.
Coincident events remain in the accessible label, tooltip and native day sheet.
Day-off / makeup-workday badges are independent of festivals. Native task colours,
titles, overflow, daily-note marks, Month drill-down and original Year remain.

**Overview** uses compact month tiles and native task-colour dots; **Agenda**
shows task titles. Both open the same native agenda, not a new date editor.
Choosing Mainland China adds a restrained holiday strip that moves focus to the
start date within this year. Today, selected date, weekends, festivals and work
adjustments have separate visual treatments. Layout wraps by available width.

Lunar dates, solar terms and festival names are individually switchable. Chinese
UI defaults enable those cultural labels; the holiday jurisdiction defaults to
**None**, regardless of language/location. Chinese calendrical names intentionally
remain Chinese (with `lang=zh-Hans`); controls and schedule status are translated
in all shipped locale bundles. No location permission or network query is used.

## Calculation and sources

`lunar-javascript` 1.7.7 (MIT, exact dependency) supplies conversion and solar
terms. Only calendrical APIs are consumed; no astrology / almanac judgements are
shown. The Year 2 component is lazy-loaded, keeping the engine outside the initial
application chunk. The PWA precache limit is unchanged; the resulting lazy chunk
is included for offline use after the app finishes caching.

Pass a **civil Gregorian YYYY-MM-DD** into `Solar.fromYmd`, never convert a task
instant to a different device timezone. Chinese calendrical dates use UTC+08
conventions. The view supports these labels for **1900–2100**; outside that range
it keeps Gregorian dates/tasks and states the calendar-layer limit. Leap months
must not repeat ordinary lunar festivals; New Year's Eve can be lunar day 29 or
30. Cache is derived, bounded to three years and never written to the task store.

Reference conversion tables (selected fixtures and all 2026 solar-term dates):
- Hong Kong Observatory, 2026: https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2026e.txt
- Hong Kong Observatory, 2025: https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2025e.txt
- Engine: https://github.com/6tail/lunar-javascript (MIT licence retained in the package)

Official Mainland China **day-off and makeup-workday arrangements**, separately
bundled for 2025 and 2026:
- 2025, State Council notice 国办发明电〔2024〕12号, published 2024-11-12:
  https://www.gov.cn/zhengce/content/202411/content_6986382.htm
  Government republication: https://www.kashi.gov.cn/ksdqxzgs/c115966/202411/e116097ae08f4324ae5802863f2a96ba.shtml
- 2026, State Council notice 国办发明电〔2025〕7号, published 2025-11-04:
  https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
  Government republication: https://www.bjdch.gov.cn/zwgk/hygq/202601/t20260123_4459144.html

The data module retains the publication date, notice number, canonical URL and
republication URL. It does not use the engine's built-in holiday adjustments.
A day-off span includes weekends / adjusted rest days; it is **not a payroll
classification of statutory holidays**. Hong Kong, Macao, Taiwan, local and
employer-specific calendars are not represented by this option.

An unbundled year says **not included**, not "not announced" or "no holidays".
No makeup day or rest day is extrapolated. Future updates add a sourced year to
`chinaHolidays.js` plus exact date/count regression fixtures; no runtime API.

## Persistence and boundaries

Only display choices use `day-planner-year2-calendar`, a device preference key.
The existing `collectDeviceSettings` / `applyDeviceSettings` backup and the native
reset mechanism already cover this prefix. No task fields, ledger records, sync
protocol or duplicate calendar events are introduced. Read errors / unknown
preference versions fail closed and do not overwrite the stored value; failed
writes leave the previously saved controls selected. Reset is explicit. Storage
and same-window notifications keep the displayed preference current.

The native MonthDaySheet gains one optional `headerExtra` slot; Month callers
without it behave unchanged. No holiday logic or database access is put there.

## Reproduce

`npm ci` followed by `npm test`, `npm run lint`, `npm run build`, and
`npm run build:android`. Use the original `scripts/year2-browser-review.py` and
`scripts/year2-calendar-review.py` against a production preview on port 4173.
Playwright and its Chromium install are review tooling, not runtime dependencies.
Both browser scripts use synthetic fixtures and no live external integrations.
