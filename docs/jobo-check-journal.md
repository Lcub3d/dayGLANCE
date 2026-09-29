# JOBO Check: read-only journal

First pass of slice 7 from [the agreed scope](https://github.com/krelltunez/dayGLANCE/issues/1726#issuecomment-5883674297).

## Reading the day

The Check button in JOBO opens a modal journal of the selected day, independent of the optional notes sidebar. It shows the entire day even when the timeline is trimmed to START/END. Entries follow their displayed execution time; equal times have a deterministic ID tie-break. Each row retains its own captured title, Final Plan and progress, with the actual interval or a labelled untimed timestamp. A manual row's creation timestamp is not labelled a task completion.

Timed records crossing midnight show their full interval and the measured minutes belonging to the selected day separately. Untimed completions and plan-duration estimates never acquire a measured duration here. Their marker date/time uses the existing completion projection, leaving the record ID, date and stamp unchanged.

Each row can disclose its complete execution group: all attempts, including other days, their progress, measured session count, unmeasured attempt count and the existing timing/metric presentation. Group comparisons are labelled separately from the individual row. An earlier Partial stays Partial even if another attempt completed the task. Unlinked records remain independent; title tags are preserved without new tag grouping semantics.

Task notes are an explicitly current, read-only disclosure, not a saved historical note. Formatting uses the app's existing formatter; linked Obsidian notes use its existing navigation callback. No inline notes editor or autosave is mounted. If the source task is missing, the Do remains visible and the notes link is unavailable.

## Ownership and boundaries

`JoboView` passes its existing `buildJoboDayModel` result to the panel. `checkJournal.js` only orders this projection and labels measured/unmeasured evidence. It neither selects merge winners nor redefines execution groups or timing comparisons.

- `viewModel.js`, core, ledger/store, detector, sync and task handlers are unchanged.
- The panel receives no write callbacks and never reads the working set, raw storage or pending rows.
- The normal JOBO feature gate owns the entry point. No Check action is added to other views.
- Loaded-empty, loading, failed read and invalid-record states remain distinct. Missing Do is not proof of no work.
- All new strings are under `jobo.check.*`, in all ten shipped locales.
- Carry Forward, successors, tag aggregation, user-written reflection and mobile are deferred. No persisted Check state is introduced.

## Verification

The regression suites use the real day model and core record constructor. They cover chronological ordering, complete groups versus daily slices, mixed timed/untimed evidence, inferred time, midnight boundaries, UTC marker projection, recurring identities, household visibility, orphan history, capture-once fields, tombstones and invalid rows. Rendering tests exercise the real panel with an inline portal and check its read-only controls, native formatting, escaping and localized text.

Manual/browser acceptance:

1. Open Check on a selected date; inspect chronology and a cross-midnight record. Toggle the timeline's START/END filter and confirm the journal still covers the full day.
2. Expand a mixed execution group. Confirm untimed work has no measured duration and earlier sessions retain their progress.
3. Open task notes; check formatting and Obsidian navigation without editing or saving either notes or Do.
4. Receive an edit or deletion while the panel is open. Confirm it follows committed state, including empty/error transitions.
5. Test Escape, backdrop dismissal, Tab/Shift+Tab focus containment and focus restoration. Date and undo shortcuts must not affect the view behind the panel.
6. Check narrow/wide layouts and light/dark themes in English, Chinese and German. Read-only ledgers can still open the journal.

Browser fixtures use synthetic task data; live accounts, real multi-device sync and physical devices require separate acceptance. The first pass does not claim those tests.
