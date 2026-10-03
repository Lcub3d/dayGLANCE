# JOBO Statistics scope proposal

This is the fork's Statistics proposal for slice 7b, following the review of
upstream #1882. Check remains the execution journal. Statistics opens from the
date header and does not add task actions, reflection storage or tag grouping.

## Date ranges

- Day uses the selected header's actual day model, including its current clock
  and Not started rules.
- Week uses the existing week strip's strict or rolling mode and configured
  first weekday. Month uses the selected calendar month.
- All time ends today. It uses saved task dates, original and captured plan
  dates, occupied execution dates, completion marker dates, and saved recurring
  completions or exceptions. A midnight interval endpoint is not occupied;
  an endpoint after midnight is. Household visibility applies before evidence
  dates are collected. Orphan Do history stays independent of a deleted task.
- Untouched historical recurring occurrences are not reconstructed as facts.
  Saved completions, exceptions and Do-backed occurrences can be materialized
  for Statistics independently of App's current navigation window. Current and
  future Week/Month occurrences retain the app's ordinary recurrence rules.

## Counting across days

Recorded time is measured interval union clipped to each included civil date.
These day coverages can be added. Overlapping records do not inflate coverage.
`planDuration` intervals remain estimates, contribute no measured time, and are
counted once per winning record across the range. Untimed work contributes a
completion point on the same civil date used by the day model, never a duration.

Plan comparisons belong to their captured Final Plan's date. The full execution
group is compared even when sessions extend outside the selected range. A Plan
group therefore contributes once to a Week/Month/All time comparison rather
than once for each date it touched. Inside/outside-plan time and longest span
also use those full executions, as the panel's scope text explains.

Task completion and priorities use current native task state,
not an immutable historical task inventory. Ordinary calendar events, archived
tasks and synthetic identity-only occurrences are excluded from these native
task populations; imported task calendars remain included. Their independent Do
history is not removed. Completed Inbox/project work stays separate from the
timed-plan denominator. Moving or deleting a task can change its historical
native count without changing the captured execution history.

"No Do recorded" counts current timed plans whose planned end has passed and
which have no Do associated with that plan. Task completion and work recorded
for a different plan do not change this evidence metric. It differs from the
Check's list of tasks needing a next step, which also covers all-day tasks.

Attempt/progress/context/single/split/gap diagnostics are not summed across
days: the same attempt or group can appear on several dates. They remain Day
diagnostics. Priority coverages can overlap and are not additive shares of the
total. Any invalid ledger evidence preserves basic task counts while making
exact time and comparison metrics unavailable.

## Read-model preparation

`buildStatisticsReports` prepares the requested range as one batch. It supplies
native saved recurring instances for all those dates, then reuses
`createJoboDayModelReader` from the existing day model. Winning records, task
resolution, grouping and complete comparisons are prepared independently of
date slicing. Only requested dates are indexed, with an ordinary lazy read for
a date outside the index. A new batch is built when committed inputs change.

The existing `buildJoboDayModel` API is retained as a one-day wrapper with the
same rules. This pure preparation extraction is the only shared-model change;
core, detector, ledger, storage, sync and write paths are unchanged.
