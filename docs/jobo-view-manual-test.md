# JOBO view acceptance checklist

This checklist describes the reviewed contract-aligned view, replacing the earlier
fork-only completion experiment. Use isolated synthetic data, never the production
profile or a personal Todoist/Obsidian account. Start with `npm run dev -- --port 5199`
and open `?view=jobo&date=YYYY-MM-DD` after enabling JOBO in Experimental settings.
The existing upstream desktop-width gate still applies.

## Day header

- The five flat stat tiles sit between the selected date and JOBO display controls.
  Light/dark mode and narrower desktop layouts must keep numbers readable; overflow
  scrolls rather than silently hiding a comparison dimension.
- Each tile opens definitions/details. Escape and the Close button close it and
  restore focus. The modal's keyboard focus stays within its controls.
- Two 40/30-minute Do intervals overlapping by 10 show 60 measured minutes.
  Cross-midnight coverage is clipped. Plan budgets are separate, not inferred work.
- Untimed-only shows unavailable measured minutes. Mixed evidence keeps known
  minutes but excludes the incomplete group from all three comparison denominators.
- A group can be late-starting, late-finishing and longer simultaneously.
  Do progress must not change the native completion numerator.
- Zoom, collapsed history, visible notes and unsaved drag previews do not change
  committed header figures. Loading/errors must not appear as an empty ledger.

## Native Plan and Do editing

- Plan creation/edit/move/resize uses native task handlers. Captured historical
  Plans have no native completion, editing or drag action.
- Completing a native Plan produces the existing Slice 4 Untimed, completed Do;
  no view-inferred actual interval is created. Check the completion stamp's date.
- A manual Plan-to-Do drag or independent Do starts as `started`, not completed;
  copying a completion record produces a new manual, started attempt.
- Untimed correction retains id, title, captured plan, source and creation stamp.
  Invalid/reversed intervals are rejected. A late remote edit is not overwritten.
- Progress changes affect only this attempt. Manual editing cannot promote a
  non-completed attempt to completed. A focused Do cannot undo a native task.
- Native reopen retains the attempt as partial; later completion creates another
  attempt. See the two separately documented upstream race/identity limitations.
- Deleting a Do creates a tombstone, not a native task deletion.

## History and notes

- Rename/reschedule/delete a native task: its original captured title and plan stay
  readable. Selecting an old Do reveals the correct capture, not today's schedule.
- Repeat the same test with two recurring occurrences; groups and notes must not
  cross occurrence dates. Synthesized historical occurrences stay read-only.
- Linked task notes use native notes. Independent Do notes use the documented
  opaque field. Hide is not Clear; a remote edit must not erase a local draft.
- Short cards keep a proportional exact-interval marker; larger label hit targets
  must not be mistaken for the real duration. Hover/keyboard selection shows links.

## Save failures and availability

- Refused writes keep the editor/draft and report the refusal. Held writes display
  pending, never success before durability, while the canonical ledger retries.
- A newer remote winner is kept and reported as a conflict; do not restamp a stale
  edit merely to make it win. Read-only mode disables edits but permits inspection.
- With a failed ledger read, no measured/comparison claims or fake empty data appear.

## Evidence

Automated unit/render/integration tests, lint and build are run separately from
browser operations. Browser CI artifacts identify the exact source, viewport,
synthetic fixtures and observed results. A prior prototype's manual test results
are not carried forward as evidence for this revision. No hardware or personal
cloud-sync validation is implied.
