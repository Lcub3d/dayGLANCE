# JOBO: Skip this occurrence

Design note for a follow-up to #1726, agreed with Lcub3d there on 2026-10-11.
Today the Check lists a recurring occurrence that was planned and never
started under **Not started**, with nothing to offer ("Repeats: the next
occurrence carries it on"). This adds one action for it, **Skip this
occurrence**, and the bookkeeping that keeps a skip visible instead of making
it vanish from the numbers.

## What was agreed

From Lcub3d on #1726:

- **The occurrence is the unit**, not the series.
- **No synthetic Do.** Skipping records no work and touches no Do record.
- **Skip resolves the occurrence** without completing it and without changing
  the series' future.
- **It stays visible.** A skipped occurrence is its own category, never
  removed in a way that improves a rate.
- **The denominator is explicit.** Skipping must not lift a completion rate by
  taking the occurrence out of the count.
- **Missed past occurrences stay uncounted** until there is evidence captured
  at the time. The current rule is not evidence: a pattern edit rewrites every
  date, past ones included. This note does not change that.

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

## What it stores

An occurrence exception already exists for this kind of resolution, but with
another meaning. `exceptions[date].skipped: true` today means **moved**:
Postpone, and changing one occurrence's date, write it and create a one-off
task on the new day. Every consumer hides a `skipped` occurrence: the
recurrence engine (`packages/agenda-core`), so the timeline, widgets, the
overdue lists, MCP and the Obsidian agenda; and the Check statistics, which
leave it out entirely (`checkStatistics.js`).

Skip writes the same flag plus a marker that says it was skipped, not moved:

```js
exceptions[date] = { ...exceptions[date], skipped: true, skipReason: 'skipped' }
```

- **Every existing consumer is already right.** The occurrence leaves the
  plan, is never overdue, and the series is untouched. Nothing outside JOBO
  needs to know about the marker.
- **Absent means moved.** Every `skipped` exception written so far, and every
  one Postpone or a date change writes from now on, has no `skipReason`, so
  no migration is needed and a move keeps its meaning.
- **Other fields of the exception stay.** An occurrence whose time was edited
  and then skipped keeps the edit, so the Check can still say when it was
  planned.

It is a change to a recurring template, so it goes through the app's own
setter with `pushUndo`, stamps the template's `lastModified`, and syncs as the
template does. Templates sync by whole-row last-writer-wins with
`completedDates` merged per date (`applyRemoteRecurring`, `mergeSync.js`), so
a skip behaves under concurrent edits exactly as "delete this occurrence"
does today. Not changed here.

## The Check

- **Not started:** a recurring occurrence offers **Skip this occurrence**.
- **After the click:** the row stays as the confirmation, "Skipped · Undo",
  while it is the latest step, as Continue, Move and Delete do.
- **A Skipped group,** below Not started, lists the day's skipped
  occurrences. The engine hides them, so the day model no longer contains
  them: the group reads them from the templates (`skipReason === 'skipped'`
  on that date, visible to the current user). This is what keeps a skip
  visible after the Check is closed and reopened, or on another device.
- **Restore** on each Skipped row puts the occurrence back. It removes
  `skipped` and `skipReason` and leaves the rest of the exception; if nothing
  else is left, the date's exception is removed, so the template is as it
  was before the skip. The occurrence then returns to Not started.

## Statistics: the denominator

Lcub3d's point: Skipped must not lift a rate silently. The rule:

| Figure | A skipped occurrence |
|---|---|
| **Scheduled tasks** (completed / all) | Stays in **all**, not completed. It was planned and not done. |
| **Planned** minutes | Included. |
| **No Do recorded** | Not counted there. It is resolved, so it has a count of its own. |
| **Skipped** | Counted. New figure. |
| **Plan vs actual** (late starts, ran long, within plan, compared) | Left out. With no Do there is nothing to compare, as for any task without Do. |
| **Execution** | Unaffected. No Do record exists. |

So the completion rate of a day with a skipped occurrence is exactly the rate
of the same day with the occurrence missed: skipping changes *why* the rate is
what it is, never the rate.

Where it shows:

- **The day figures in the date row:** the Scheduled tasks tooltip gains
  "Skipped: N".
- **JOBO statistics, Overview:** the detail line under the tiles gains
  "Skipped: N", beside Planned, Without times and Estimated.
- **Week, Month and All time:** a past date's skipped occurrence is evidence
  captured at the time, so the reader counts it on that date. Today the
  past-date branch of `buildStatisticsReports` drops every `skipped` exception; it
  keeps dropping moves and counts skips.

Skip adds a category and changes no existing figure's definition, so there is
no old-versus-new boundary to explain.

## Other views

A skipped occurrence leaves the timeline in every view, JOBO's own Plan side
included, as a moved one does today. The Check and the statistics are where
it stays visible. A Do recorded against the occurrence before it was skipped
cannot happen through Skip (Not started means nothing was recorded); one added
afterwards shows on the Do side as any Do does.

## What stays as it is

- **The ledger, core and the detector.** No Do record is written, edited or
  deleted.
- **No new task field.** The marker lives inside an occurrence exception on
  the template, which every tier already carries whole.
- **Missed past occurrences** stay uncounted, and all-day occurrences on past
  days keep offering nothing.
- **Postpone and date changes** keep writing a move.
- **Skip is not offered elsewhere** (a timeline card's menu, MCP, intents).
  The Check is where a planned occurrence is reviewed; other entry points can
  follow if asked for.

## Decisions to confirm

1. **Today only.** Skip on today's Check, not on past days' all-day
   occurrences. Proposed: today only.
2. **The marker's name.** `skipReason: 'skipped'`, absent meaning moved.
3. **Hidden from the timeline.** Proposed: yes, as a move is, so no consumer
   outside JOBO changes. The alternative, a greyed occurrence on the timeline,
   would touch the engine shared with the Obsidian plugin.
4. **Restore at any time** from the Skipped group, rather than Undo only while
   it is the latest step. Proposed: both, since a skip found wrong the next
   morning should not need the series editor.
5. **Where Skipped shows in the statistics.** Proposed: the Overview detail
   line and the Scheduled tasks tooltip, not a fifth tile.

## Build order

1. **Pure helpers** for the exception: skip, restore, and "skipped, not
   moved", with tests, including that restore returns the template to exactly
   its state before the skip.
2. **The Check:** the action in `notStartedAction` for today's recurring
   occurrences, the Skip and Restore task actions (through `pushUndo`), the
   Skipped group read from the templates, the strings in all 10 locales.
3. **Statistics:** the Skipped count, kept in the Scheduled tasks
   denominator and out of No Do recorded and the comparisons, for today's
   model and the past-date reader. The test that matters: a day's completion
   rate is the same with the occurrence skipped as with it missed. Mutation
   check it.
4. **The guide:** `docs/jobo-guide.md` gains Skip in the Check's table and the
   statistics section.
