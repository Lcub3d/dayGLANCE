# Year 2: tiled annual calendar

A fork-local view for `product/jobu`. The original Year heatmap remains unchanged.
Open **Year 2 / 年2** from the desktop view switcher, press **8**, or use
`?view=year2&date=2026-09-16`. The header arrows move a year; Today returns to today.

## Visual reference

TriliumNext/Trilium's calendar registers `multiMonthYear` in:
https://github.com/TriliumNext/Trilium/blob/main/apps/client/src/widgets/collections/calendar/index.tsx

The reference is the arrangement of twelve month calendars and date drill-down,
not Trilium's source code, theme, note model or FullCalendar dependency. Year 2 is
implemented with dayGLANCE's existing React, calendar arithmetic and theme.

## Behaviour and boundaries

- Twelve equal-height month tiles; three, two or one columns according to available
  calendar width. Week order and names follow the existing locale/week-start settings.
- Today, the selected day, weekend shading, native task colours, two item-title
  previews, overflow counts and existing daily-note markers.
- Reuses `useMonthItemsForDate`: ordinary/recurring tasks, imported events,
  routines and deadlines retain the existing Month view's inclusion/filter rules.
- A date opens the existing `MonthDaySheet` / scoped SCHED agenda, including items
  beyond the preview limit. A month title opens the existing Month view unless it
  is hidden on this device. No second detail editor or task writer is introduced.
- Focused day: arrows move one day/week, Home/End move within its week,
  PageUp/PageDown move a month (Shift: year), Enter/Space open the agenda.
  Outside a day cell, the application's year arrows and view shortcuts still work.
- Publishes the full year's range through the existing `monthViewRange` seam,
  so recurring occurrences are expanded for every month, then clears it on exit.
- Electron can fetch the full year in one native calendar query. On Android/iOS,
  the existing bridge uses bounded per-day queries, so device calendar events stay
  around the selected date instead of silently truncating a full-year request.
  This limitation is shown in the view; local tasks/recurrences cover the full year.
- No new persisted collection, sync schema, dependency, default view or phone-mode
  entry. Existing view visibility/default preferences also apply to Year 2.

## Validation

Pure calendar tests cover leap/century years, all seven week starts, unique dates,
year bounds, clamped Feb 29 navigation, deduplication and the fetch range.
Rendering tests exercise native contexts, notes, overflow, accessible cells and
hidden Month behaviour; shared view/translation tests include the new mode.

Browser review uses the actual production app and isolated synthetic data:

```sh
npm run build
python -m http.server 4173 --directory dist
# In another terminal, with Python Playwright installed:
python scripts/year2-browser-review.py
```

The product base `8bc1b96d` already has failing full-suite assertions in
`src/locales.test.js` (Focus/shared translation gaps) and scenario 13 of
`src/sync/joboRecordsSync.test.js` (timed versus untimed completion). Compare a
baseline run on the same environment; do not suppress those tests or describe
an unchanged failing baseline as a fully green suite.
