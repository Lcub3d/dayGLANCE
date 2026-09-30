# Check: the day's execution journal

Check opens behind its button in JOBO. It reads the committed day model; it
stores nothing and provides no completion, reassessment, scheduling or Carry
Forward action. The date-header statistics remain separate.

## Reading order and evidence

`components/jobo/checkJournal.js` is a presentation projection, not a second
execution model. It keeps the model's group keys, winners, visible tasks,
comparisons and latest attempt. One entry represents each Plan group that has
execution on the selected day, followed by unplanned Do. Entries in each section
are ordered by their first visible execution; sessions within an entry are
ordered by actual start (or the completion marker), with stable ID tie breaks.
It does not regroup recurring occurrences by task ID or list untouched plans.

Each entry shows its captured title in the current task colour, captured Plan
beside actual sessions, each session's own progress, and the existing
`ExecutionAxes.summaryRows`/`timingRows` labels. Multiple sessions retain the
model's latest-attempt assessment, not the most recently edited row or a
percentage inferred from elapsed time.

The existing model compares full groups. Sessions on other dates therefore
retain their dates and a short explanation; they are never presented as work
entirely within the selected day. Untimed completion shows its marker time,
not an invented start/duration. Inferred intervals remain labelled Estimated
and cannot produce a measured comparison. Loading, a failed ledger read, an
empty day, and malformed evidence remain distinct. Malformed evidence warns
that the journal is incomplete and suppresses full-group comparison conclusions.

## Notes reuse

The Notes link leaves Check for the linked task's native notes panel, then
returns to Check. `DoTaskNotes` is the unchanged native content/action wiring
extracted from `DoNotesPanel`, also still used by Do cards. Check's notes host
adds no parser, writer, AI operation or stored note. An explicit edit there uses
the app's existing task/wiki actions, just as it does from a Do card. Merely
opening the journal or notes does not write.

The destination resolves its task again from the current visible model. It
works without requiring an on-screen Plan card or a wide notes sidebar. Missing
or newly hidden tasks are not offered as editable stale copies. The journal
blocks planner shortcuts; the native notes content retains its own input keys.

## Statistics kept for later

As requested in #1882, `checkSummary.js` and its tests now live in `src/jobo/`
beside `dayStats.js` as a seed for a separate statistics view. Check does not
import or execute that seed. Native priorities are high (3), medium (2), low
(1), and none (0); missing/invalid priority remains unknown. No P1–P4 display
or new priority snapshot is introduced.

All new UI strings are translated under `jobo.check.*` in the ten shipped
bundles. Existing locale keys, `viewModel.js`, core, dayStats, ledger/store,
detector, sync, date-header statistics and the timeline are unchanged.
