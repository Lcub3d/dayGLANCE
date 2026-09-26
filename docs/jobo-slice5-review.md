# JOBO view review and daily-summary proposal

Reviewed source: fork PR #18 at `f99f462064eb66a956de286f455ce146b2beecec`.
Contract baseline: upstream `49b0a4b42c87a0be62970723c8bc869954bb4cd2`,
#1726, #1744, #1788, #1762 and #1794.
The experimental source is preserved on `review/jobo-slice5-20260927`.

## Boundary decisions

This revision consumes, rather than changes, the merged core, ledger, store,
detector and ledger hook. The speculative task completion fields, bidirectional
completion bridge, inferred actual interval on native completion, focus-log
writes, special task/Do undo transaction and automatic Check note filter are
removed from the proposed upstream change. The original experiments remain in
Git history, not in the active runtime.

- Native Plan completion uses the existing native task action. Slice 4 observes
  that event and creates its canonical Untimed completion attempt.
- A manual/copy Do starts as `started`. Reassessment uses core's three permitted
  values. Keeping an existing `completed` attempt is allowed; a Do edit never
  completes, reopens or reschedules its source task.
- Correcting an Untimed record updates the same id. No view estimates a measured
  interval from the task's planned duration on completion.
- All writes use `recordJobo`. The view stores only transient pending receipts,
  not a competing ledger or retry queue. `held: true` means pending, not durable.
  Another winning version is reported instead of restamping to defeat it.
- Core record shape, capture-once fields, deterministic merge, tombstones,
  backups and both sync transports are unchanged.
- Native Plan gestures use native handlers. Do changes are not included in
  native task undo; a focused Do does not undo an unrelated task.
- Independent Do notes are an explicitly proposed opaque string extension,
  described in `jobo-do-notes.md`. They use whole-record merge and the sole writer.
  Existing linked task notes remain task-owned. No reflection store is added.
- Focus history is a read-only projection. It does not create execution evidence;
  legacy totals without task/session coordinates are labelled as unavailable
  task-specific history, not reconstructed.

## Review fixes

The view keeps immutable captured titles after native renaming, isolates recurring
occurrences, refuses native actions on synthesized historical occurrences and
resolves duplicate/tombstone versions before projecting records. Invalid records
are visible as a warning and cannot turn into confident absence/comparison claims.
Recurring lookup expands only referenced dates per template, not every historical
date against every template. Civil dates are calendar-validated. Same-time ordering
uses a locale-independent id tie-break. Focus timestamp dates use their source
prefix rather than the observer's timezone.

UI fixes retain independent start, finish and duration axes; avoid displaying the
same active/recorded value twice; retain zero gap/overlap diagnostics; distinguish
partial measurement and estimated legacy intervals; preserve current drafts on
write errors; keep short records' exact interval in a proportional side track;
and reveal the selected execution group's captured Plan even when history is
collapsed. Selection does not rewrite history.

## Daily header: two populations, never an efficiency score

The five MonthStats-style tiles are native timed-task completion, measured Do
coverage, late starts, late finishes and longer durations. They are read-only
projections of the selected civil day, not a new persistence field.

1. **Native completion:** current, visible-user, completable timed tasks dated
   this day. All-day tasks, historical snapshot cards and external calendar-only
   events are excluded. Native `completed` is authoritative; per-attempt progress
   is never averaged or converted into task completion.
2. **Planned budget:** sum of those current timed task durations clipped to the
   day. Overlapping plans remain two budgets; this is not available wall-clock time.
3. **Measured time:** committed timed Do intervals intersecting this day, unioned
   across records. 40 + 30 minutes with 10 overlapping gives 60, not 70. A midnight
   crossing contributes only the selected day's portion. Untimed records and
   old `timingBasis: 'planDuration'` estimates contribute no fabricated minutes.
   With no measured interval the value is unavailable, not zero actual effort.
4. **Comparison population:** distinct captured-Plan groups dated this day, using
   their complete attempt groups even if execution happened later. Only groups
   whose intervals are fully measured qualify. Start, finish and duration are
   three independent distributions with the same explicit eligible denominator.
   Mixed/Untimed groups are excluded, not assumed on plan. Invalid rows withhold
   aggregate comparison claims while known measured coverage remains labelled.
5. **Details:** definitions, unmeasured/estimated counts, overlap deduction, records
   without a timed plan, multiple-record groups, signed per-group offsets and
   per-attempt progress distribution. Multiple records are not proof of interruption.

The header uses the same unfiltered-by-tags day population as the JOBO board,
respecting the native visible-user predicate. Zoom, hidden history, notes visibility,
unsaved gesture previews and pending writes never change its committed figures.
Native budget and measured coverage have different populations: they are not divided
into an invented efficiency, completion or progress ratio.

#1726 assigns the full day-level Check/Act workflow to Slice 7. This small read-only
header is an explicit scope proposal for review, not a claim that Slice 7 is settled.
There is no automatic note selection, causal diagnosis, score, Carry Forward or
successor generation in this change.

## Upstream issues reproduced separately

These are present on the pinned upstream baseline and deliberately not repaired
by changing Slice 3/4 underneath a view PR. Run
`TZ=UTC node scripts/repro-jobo-upstream.mjs` for synthetic, in-memory observations.
The script reports observations; it does not encode the defects as desired tests.

### A. Completion held for retry, then reopened before durability

Make the store refuse a completion write. The ledger holds it; its public committed
records remain empty. Immediately reopen the native task. The detector sees the
uncheck edge but cannot find the held record in the committed projection, so it
builds no reassessment. Recover storage and retry: the attempt lands as `completed`
although the source task is open; the expected history assessment is `partial`.
A separate fix needs coordinated access to ledger-owned pending mutation state or
a queued reassessment intent, without exposing pending rows as committed sync data.

### B. Re-completion within one timestamp second

Native `completionTimestamp` drops milliseconds. Complete at .100, reopen, then
complete at .900 within that second: both source stamps, and therefore both
completion ids, are equal. Ensure-present correctly refuses to create another
row, leaving one partial attempt rather than two attempts. Event identity/precision
needs a separate native/detector review; the view must not fabricate a random or
observer-clock completion id to hide it.

## Verification

The entire imported PR source was inspected by changed-file category, with data
contract, ownership, event flow, comparisons, gestures, notes and failure paths
reviewed in addition to running tests. Passing tests do not prove an absence of bugs.

The curated Linux/UTC run passes all 5,752 tests. Full lint and production build
pass. Removal of each of three guards (overlap deduction, invalid-record comparison
suppression, eligible comparison population) makes its regression test fail;
all guards are restored. Additional CI/browser evidence is recorded in the PR and
review workflow artifacts. Native Android/iOS hardware, personal sync accounts and
real multi-device browser convergence are not claimed as tested here.
