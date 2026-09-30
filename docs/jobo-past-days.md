# JOBO slice 6: past days show what was done

Design note for slice 6 of #1726, agreed in review on #1881. Steps 1 to 3
of the build order are built (#1884, #1885, and MONTH after them); the
NOW-line split within today is still to come. Slice 7 (the Check and Carry
Forward) runs in parallel and does not depend on it.

## The rule

From #1726: *a date before today shows Do where any was recorded, and
otherwise the tasks as they stood, with completed ones as the de facto
record, so the year before the ledger existed does not go blank; today and
later show the plan.* And from #1623, the original framing: actual records
prominent in the past portion, leaving the future as planning space.

Made concrete, for a date before today:

1. **A task with timed Do on that date shows its Do instead of its plan
   block.** Each timed Do slice on the date is drawn at its actual interval,
   in the task's colour, as a read-only card. Two sessions are two cards.
   The plan block for that task is not drawn.
2. **A task with no timed Do on that date shows as it stood.** Its block is
   drawn where it was, completed or not, exactly as today. This is the case
   for every day before the ledger existed, and for a task completed without
   times (an untimed completion changes nothing here; the task's own checked
   state already says it was done).
3. **Unlinked Do on that date are shown too**, as read-only cards in a
   neutral colour: work that was done without a plan. So is a Do whose task
   has since been deleted, under the title the record captured.
4. **Only measured facts leave JOBO.** The estimated completion block that
   JOBO draws for an untimed completion (#1860) is a guess shown to be
   corrected, and it stays inside JOBO. So do comparisons and labels
   ("Started late"): the other views show what happened, JOBO shows how it
   compared.

Today and later are unchanged. "Before today" is the viewer's civil date,
as everywhere else in the app.

**Gated by the JOBO flag.** With `joboEnabled` off, every view renders
exactly as it does now. The flag gates the interface, never the data, so
the ledger is already present on every device either way.

## Where the rule lives

Every view gets a day's tasks from `getTasksForDate` (`App.jsx`), but about
forty other consumers use it too (widgets, reminders, the frame nudge,
occupancy, SCHED, mobile, and JOBO's own day model), so the rule must not
go inside it. Instead:

- **A pure rule, `src/jobo/pastDay.js`.** `pastDayItems({ dateStr, dayTasks,
  index, resolveTask, isVisibleForUser })` returns the list a past day shows:
  the day's tasks with Do-covered plan blocks removed, plus task-shaped
  read-only items for each timed Do slice. No React, no storage, tested on
  its own. It reads the ledger through the same projection JOBO uses
  (`projectJoboRecords`, `timedSliceOnDate`, `buildJoboTaskResolver`), so a
  record means the same thing in every view.
- **A per-date index, built once.** MONTH asks for 42 days per render, so
  the ledger is projected once into `dateStr → timed slices` (memoized on
  `joboRecords`) rather than rebuilding JOBO's full day model per cell.
- **One accessor beside `getTasksForDate`.** `getDayDisplayForDate(date,
  applyTagFilter)` on the planner context: for a date before today with the
  flag on, it passes `getTasksForDate`'s result through the rule; otherwise
  it returns that result unchanged. It keeps the tag-filter argument, since
  views differ on it.
- **Adopted only where a view picks its day's tasks.** Each view already
  does this in one expression per column, so swapping the accessor there
  changes what a column shows without touching layout, overlap packing or
  cards:

  | View | Call site |
  |---|---|
  | DAY timeline | `DayView.jsx`, `DayViewColumn` |
  | MULTI timeline | `TimeGrid.jsx`, the per-date loop |
  | WEEK timeline | `WeekView.jsx`, `WeekViewColumn`, and its clipped-hour counts so they agree |
  | All-day rows | `DayViewAllDaySection.jsx`, and WEEK's and MULTI's rows in `CalendarHeader.jsx` |
  | MONTH cells | `MonthView.jsx`, `useMonthItemsForDate` |

## The Do card in other views

A timed Do item is task-shaped so the existing layout takes it: the task's
title and colour, `startTime` and `duration` from the actual interval, and
`joboDo: true` with the record id. It is **read-only**: no drag, resize,
checkbox or context-menu actions, the way imported calendar events already
are. Clicking it opens the JOBO view on that date, where the record can be
edited.

**It is drawn with a striped fill in the task's colour**, so it never
passes for a plan block, with a tooltip giving the recorded interval
("Recorded 09:30 to 10:15"). The same striped fill carries into JOBO's own
Do cards for recorded Do, so a recorded Do looks the same everywhere. JOBO's
estimates keep their dashed outline, which stays distinct from the stripes.

How each view draws it:

- **DAY and MULTI:** the full card, striped.
- **WEEK:** WEEK's compact chip, striped. Its click popover, which shows
  a plan card today, shows the Do instead: the recorded interval and
  progress, read-only.
- **MONTH:** the cell's bars follow the Do. A task done in three one-hour
  sessions is three striped bars at the recorded times, in its colour,
  and its plan bar is not drawn. The cell has no text and is one tap
  target, so a bar opens nothing of its own; the cell's spoken label counts
  recorded sessions apart from tasks ("1 task, 3 recorded sessions").

Slice 6 is read-only, as agreed with Lcub3d on #1726: past days show what
was done, and no actions are added to other views. Carry Forward stays in
the Check panel (slice 7).

## What stays as it is

- **JOBO's Plan side.** It is DAY's own column (`DayViewColumn`), so it
  would inherit the rule. JOBO passes a prop that keeps its Plan side on the
  plan, since its Do side already shows the Do.
- **SCHED, and MONTH's day sheet and docked panel**, which render SCHED.
  SCHED is an agenda of what is planned and due, with its own past-date
  handling; changing it would change the SCHED view too. Left for later.
- **Mobile.** Phone and portrait-tablet views are unchanged until slice 8.
  The phone renders the same `MonthView`, so MONTH's adoption is gated to
  the desktop layout.
- **MonthStats**, which reads the raw task lists, not a day's display.
- **Missed recurring occurrences.** Today, a past recurring occurrence that
  was never completed is not shown at all (`expandRecurringTasks.js`). The
  rule does not change that; a Do recorded against it still shows.
- **Multi-user.** The rule filters with `isVisibleForUser`, as JOBO does
  since #1877, so another member's Do never appear.

## Later refinement

Within today, split at the NOW line rather than at midnight: before now
shows Do, after now shows the plan. That is the original framing in #1623,
and it is where the rule earns most, but it changes today's views while
you are working in them, so it follows once the past-day version has been
lived with.

## Decisions

Settled in review on #1881:

1. **Per task.** Only the task that has Do loses its plan block; a planned
   task done without being recorded still shows as it stood.
2. **No plan outline** behind the Do in other views. The JOBO view is where
   plan and Do sit side by side.
3. **A striped fill in the task's colour** for recorded Do, in every view
   including JOBO (above). To be seen in the build and adjusted there.
4. **SCHED and MONTH's day sheet unchanged.** SCHED is an agenda and has no
   need for Do.
5. **Mobile unchanged** until slice 8.

## Build order

1. **The rule and the index**, with tests: task with timed Do, task without,
   untimed completion, unlinked Do, two sessions, a Do crossing midnight,
   another member's Do, a record for a deleted task, flag off. No UI change.
2. **DAY, MULTI and WEEK**, timed and all-day, with the striped read-only
   Do card, WEEK's popover, JOBO's opt-out, and the striped fill on JOBO's
   recorded Do.
3. **MONTH cells**, bars following the Do.
4. Later: the NOW-line split within today.
