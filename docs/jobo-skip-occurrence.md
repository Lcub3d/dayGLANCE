# JOBO: Skip this occurrence

Design note for a follow-up to #1726, agreed with Lcub3d there on 2026-10-11
and revised after their review of this note (#2057). Today the Check lists a
recurring occurrence that was planned and never started under **Not
started**, with nothing to offer ("Repeats: the next occurrence carries it
on"). This adds one action for it, **Skip this occurrence**, and the
bookkeeping that keeps a skip visible instead of making it vanish from the
numbers.

## What was agreed

From Lcub3d on #1726 and #2057:

- **The occurrence is the unit**, not the series.
- **No synthetic Do.** Skipping records no work and touches no Do record.
- **Skip resolves the occurrence** without completing it and without changing
  the series' future.
- **It stays visible.** A skipped occurrence is its own category, never
  removed in a way that improves a rate.
- **Active skips stay in JOBO's Scheduled denominator**, as planned and not
  done.
- **Missed past occurrences stay uncounted** until there is evidence captured
  at the time. The current rule is not evidence: a pattern edit rewrites every
  date, past ones included. This note does not change that.
- **A small occurrence-evidence record is enough**, not an event log.

## Where Skip is offered

On the Check's **Not started** group, on a recurring occurrence, **on today's
Check only**.

That is exactly the set the group already lists for a recurring task on
today: a timed occurrence whose planned time has ended with nothing recorded
(`comparison.notStarted`), not completed. All-day occurrences appear in Not
started only on past days, where the group reads them from the series' rule;
Skip is not offered there, since that would resolve an occurrence on evidence
the rule cannot give.

The summary line ("2 tasks from this day still need a next step") keeps
leaving recurring occurrences out. Skip is available, never asked for: the
next occurrence still carries the work on.

## What it stores: the occurrence's evidence

An occurrence exception already exists for this kind of resolution, but with
another meaning. `exceptions[date].skipped: true` today means **moved**:
Postpone, and changing one occurrence's date, write it and create a one-off
task on the new day. Every consumer hides a `skipped` occurrence: the
recurrence engine (`packages/agenda-core`), so the timeline, widgets, the
overdue lists, MCP and the Obsidian agenda; and the Check statistics, which
leave it out entirely (`checkStatistics.js`).

Skip writes the same flag plus a small evidence record of the occurrence as
it was planned when it was skipped:

```js
exceptions[date] = {
  ...exceptions[date],
  skipped: true,
  skip: {
    at: '2026-10-12T17:40:00+02:00',   // when it was skipped, own clock
    plan: { startTime: '09:00', duration: 30, isAllDay: false },
  },
}
```

- **The plan is frozen.** Without its own exception fields, an occurrence
  inherits its time and duration from the series, so a later series edit
  would quietly change what a past skip says was planned. `skip.plan` is what
  the occurrence showed at the moment of the skip, exception over template,
  and the Check and the statistics read the skip's plan from it. It never
  overrides anything the timeline shows.
- **Absent `skip` means moved.** Every `skipped` exception written so far,
  and every one Postpone or a date change writes from now on, has no `skip`,
  so no migration is needed and a move keeps its meaning.
- **Every existing consumer is already right.** The occurrence leaves the
  plan, is never overdue, and the series is untouched. Nothing outside JOBO
  reads `skip`.
- **Other fields of the exception stay**, and so does the exception's key:
  its presence marks a saved occurrence for the statistics history, the rule
  the series editor already follows (`recurringInstanceEdit.js`).

## Undo and Restore

Both are one targeted inverse, never a snapshot:

- **What they do:** remove `skipped` and `skip` from that date's exception,
  and nothing else. The exception's key stays, even if it is now empty, so
  the occurrence keeps its evidence (see the statistics below). Other fields,
  other dates, other series and every other list are untouched.
- **Only the skip they made:** each acts only while the date still carries a
  skip with the same `skip.at`. If the skip has gone (restored elsewhere,
  replaced by a move, lost to sync) the inverse does nothing and says so, as
  JOBO's Do undo does when a record changed meanwhile.
- **Undo** is the confirmation's "Skipped · Undo" in the Check and Ctrl/Cmd+Z.
  It is pushed as an action step (`pushUndoAction`, as JOBO's Do edits are),
  not with `pushUndo`: the snapshot step restores every task and every series
  as they were, which would also discard anything synced in between.
- **Restore** is the same inverse from the Skipped group, at any time.

After either, the occurrence is an ordinary occurrence again: on today, back
under Not started; on a past day, a planned occurrence with nothing recorded,
since its exception remains as evidence.

## The Check

- **Not started:** a recurring occurrence offers **Skip this occurrence**.
- **After the click:** the row stays as the confirmation, "Skipped · Undo",
  while it is the latest step, as Continue, Move and Delete do.
- **A Skipped group,** below Not started, lists the day's skipped
  occurrences with the plan from `skip.plan`. The engine hides them, so the
  day model no longer contains them: the group reads them from the templates
  (a `skip` on that date, visible to the current user). This keeps a skip
  visible after the Check is closed and reopened, or on another device.
- **Restore** on each Skipped row; see above.

## Work or completion after a skip

A Do is execution evidence, not completion by itself. So:

- **Skipped** means a `skip` on the date, the occurrence not completed, and no
  Do recorded against it. Only then is it counted and listed as Skipped.
- **A completion arriving later** (another device, a widget, MCP or an intent
  that targets the date) wins: the occurrence counts as completed, as any
  completed occurrence does, and leaves the Skipped group. The stored skip
  remains as history and is not removed automatically.
- **A Do arriving later** against the occurrence (its task and date, through
  its captured plan) means work happened: the occurrence counts as planned
  with Do, not completed, and leaves the Skipped group. It is not treated as a
  completion.

The occurrence stays hidden from the timeline in both cases, since the engine
hides any `skipped` date; the Do itself shows on the Do side as any Do does.
Restoring the skip brings the occurrence back.

## Sync: what is not guaranteed

Templates sync as whole rows, last writer wins, with only `completedDates`
merged per date (`applyRemoteRecurring`, `mergeSync.js`). A skip is an edit to
the template's exceptions, so:

- **A newer edit to the same series on another device wins whole**, and a
  skip made meanwhile is lost, or a restore undone. Completing *another*
  occurrence counts as such an edit: it stamps the template's `lastModified`.
- This is the existing behaviour of every occurrence exception ("delete this
  occurrence", moves, per-occurrence edits). Skip does not make it worse, and
  this note does not change it. Merging `exceptions` per date, as
  `completedDates` already is, would close the gap for all of them; that is a
  sync change of its own.
- The targeted inverse above means an Undo or Restore never resurrects data
  that sync has since changed; at worst it finds the skip gone and does
  nothing.

## Statistics: the denominator

Lcub3d's point: Skipped must not lift a rate silently. The rule, in JOBO's
statistics (the date-row figures and the statistics panel, every scope):

| Figure | An active skip |
|---|---|
| **Scheduled tasks** (completed / all) | Stays in **all**, not completed. It was planned and not done. |
| **Planned** minutes | Included, from `skip.plan`. |
| **No Do recorded** | Not counted there. It is resolved, so it has a count of its own. |
| **Skipped** | Counted. New figure. |
| **Plan vs actual** (late starts, ran long, within plan, compared) | Left out. With no Do there is nothing to compare, as for any task without Do. |
| **Execution** | Unaffected. No Do record exists. |

**What is guaranteed, and where.** A skip never raises a completion rate, in
JOBO's statistics or, per decision 5, in MONTH and the daily summary:

- **Today**, a skipped occurrence counts exactly as the same occurrence
  missed would: in the denominator, not completed.
- **On a past day**, an untouched missed occurrence leaves no evidence and is
  not counted at all, while a skip is evidence and stays in the denominator.
  So there a skip can lower a rate compared with simply missing it, never
  raise it. That follows from the agreed rule that missed past occurrences
  are not reconstructed.
- **After Restore**, the occurrence keeps its exception as evidence, so on a
  past day it counts as planned with nothing recorded, never vanishing.

**Outside JOBO.** MONTH's day statistics and the daily summary (`useStats`)
build occurrences with the recurrence engine, which hides `skipped` dates, so
a skip would leave their denominators and raise those rates, the effect
Lcub3d warned about. Settled (decision 5): they count an active skip too, as
planned and not completed, so a skip raises no completion rate anywhere in
the app. Only a date with `skip` is read differently; a move stays excluded
there, as now, since the one-off task that replaced it is counted instead.

Where Skipped shows in JOBO:

- **The day figures in the date row:** the Scheduled tasks tooltip gains
  "Skipped: N".
- **JOBO statistics, Overview:** the detail line under the tiles gains
  "Skipped: N", beside Planned, Without times and Estimated.
- **Week, Month and All time:** a past date's skip is evidence captured at the
  time, so the reader counts it on that date. Today the past-date branch of
  `buildStatisticsReports` drops every `skipped` exception; it keeps dropping
  moves and counts skips.

Skip adds a category and changes no existing figure's definition in JOBO, so
there is no old-versus-new boundary to explain there.

## Other views

A skipped occurrence leaves the timeline in every view, JOBO's own Plan side
included, as a moved one does today. The Check and the statistics are where
it stays visible.

## What stays as it is

- **The ledger, core and the detector.** No Do record is written, edited or
  deleted.
- **No new task field.** The evidence lives inside an occurrence exception on
  the template, which every tier already carries whole.
- **Missed past occurrences** stay uncounted, and all-day occurrences on past
  days keep offering nothing.
- **Postpone and date changes** keep writing a move.
- **Sync** is unchanged, with the limits above.
- **Skip is not offered elsewhere** (a timeline card's menu, MCP, intents).
  The Check is where a planned occurrence is reviewed; other entry points can
  follow if asked for.

## Decisions to confirm

1. **Today only.** Skip on today's Check, not on past days' all-day
   occurrences. Proposed: today only.
2. **The evidence record.** `skip: { at, plan }` beside `skipped: true`,
   absent `skip` meaning moved.
3. **Hidden from the timeline.** Proposed: yes, as a move is, so no consumer
   outside JOBO changes. The alternative, a greyed occurrence on the timeline,
   would touch the engine shared with the Obsidian plugin.
4. **Restore at any time** from the Skipped group, besides Undo while it is
   the latest step. Proposed: both, through the one targeted inverse.
5. **MONTH and the daily summary.** **Settled: they count an active skip
   too**, as planned and not completed, so no rate in the app rises. Chosen
   over scoping the guarantee to JOBO, which would have left those two
   screens disagreeing with JOBO's. It changes only how they read a date with
   `skip`, and leaves moves as they are.
6. **Where Skipped shows in JOBO's statistics.** Proposed: the Overview detail
   line and the Scheduled tasks tooltip, not a fifth tile.

## Build order

1. **Pure helpers** for the exception: skip (with the frozen plan), the
   targeted inverse, and "skipped, not moved", with tests: the inverse leaves
   the key and every other field; it does nothing when the skip has changed;
   a later completion or Do supersedes the skip for classification.
2. **The Check:** the action in `notStartedAction` for today's recurring
   occurrences, the Skip action and its `pushUndoAction` step, Restore, the
   Skipped group read from the templates, the strings in all 10 locales.
3. **Statistics:** the Skipped count, kept in the Scheduled tasks
   denominator and out of No Do recorded and the comparisons, for today's
   model and the past-date reader; and MONTH's day statistics and the daily
   summary (`useStats`), per decision 5. The tests that matter: today, a
   skipped occurrence gives the same rate as a missed one, in JOBO and in
   `useStats`; on a past day a skip never raises a rate; a series edit after
   the skip leaves its plan unchanged. Mutation check them.
4. **The guide:** `docs/jobo-guide.md` gains Skip in the Check's table and the
   statistics section.
