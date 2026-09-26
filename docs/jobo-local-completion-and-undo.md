# Local JOBO interaction experiment

This is an explicitly requested local experiment on `feat/jobo-view`, not a new upstream slice 2–4 contract. It changes the former UI rule that manual Do could not become Completed. No core or ledger implementation/schema changes are required by this experiment.

## Interaction

- Click empty Plan/Do time: open the corresponding existing editor.
- Drag a short distance without holding: create a blank 30-minute block. Hold for 350 ms and drag: select the interval, snapped to five minutes. An unnamed Do remains a local draft until named or linked to a Plan.
- New and copied Do records default to Completed. Saved records retain their current explicit progress. The single progress selector appears at the left of the Do title: full labels in wide cards; S/P/M/√ in narrow cards. Timing labels are computed from the record's captured Plan and follow its duration.
- The last Do on the execution timeline determines the native Plan checkbox. Order is execution date/start time, then end date/time, creation time and ID for stable ties. Updating an older row's metadata does not make it last. Moving or deleting a row recalculates the decision. Repeating tasks are grouped by captured occurrence, not execution date.
- Untimed records have no vertical timeline position. They participate only when that task/occurrence has no active Timed Do, ordered by creation time and ID. No task/occurrence association is guessed when identity is missing.
- Checking an unchecked Plan in JOBO ends its latest Do at the current local minute. A valid earlier start is retained. If there is no timed Do, or its start is not before now, the start is inferred as now minus the Plan duration (including across midnight). Existing record IDs are retained; a missing record receives a new manual ID. Details label inferred intervals and retain the exact completion instant in opaque `timingBasis` / `completedAt` fields. A held write disables repeat completion, and checkbox state changes only after canonical confirmation. Native completion outside this JOBO Plan control keeps its existing detector behavior.
- Native GTD frame instances, colours and availability are reused in both lanes. Labels open the native time-adjust dialog/context menu; the remaining background passes through timeline gestures. Native frame-edge dragging is not reproduced.

## Notes review and focus evidence

The Notes header's Check button temporarily reveals notes for live Plans that are incomplete, late to start/finish, or longer than their captured Plan. Current and historical captured groups retain their existing comparison semantics and recurring identity. Multiple problematic captures of the same task open one note. Check does not change completion or store a new day-level review record. Existing visible notes and explicit manual openings remain visible when Check is disabled; opening or editing an automatic note promotes it to manual. Closing one dismisses it for the current Check activation; toggling Check off/on recalculates candidates. Notes remain in final Plan order.

Do cards show a focus-history clock when the linked task has focus evidence. New native focus-log spans retain explicit participant IDs (including full recurring instance IDs), per-task minutes and timestamps. The popup shows the session's wall-clock interval, which may include breaks/pauses; it is not proof of continuous work on one task. Multiple Do attempts for one task can show the same task history. Old date-level spans without participant identity are never attributed by date alone. A legacy task total can be displayed, but missing historical timestamps cannot be reconstructed. The existing device-local focus-log persistence is reused; these spans are not copied into the JOBO ledger and do not automatically create Do records.

Hover-only controls release their reserved title width while hidden. Keyboard focus reveals them, and touch keeps them available.

## Data ownership

`recordJobo` remains the sole Do writer. `useJoboViewWriter` wraps view commands to register one-record undo actions and apply native task completion only after the exact canonical version has persisted and is no longer pending. Core reassessment and `viewActions` retain their prior constraints; `viewProgress` is the explicit experimental adapter for manual Completed values.

This integration crosses the slice 5 view boundary: `useTaskActions` exposes an experimental native completion command, and `useJoboDetector` routes its completion edges. Opaque task extensions `joboCompletionLinks` and `joboUncompletionLinks` identify Do-origin checkbox changes. They suppress duplicate Untimed creation and prevent a Do-origin S/M change from being replaced by detector-generated Partial. A normal native uncheck targets the latest loaded Do for that same task instance when the completion was Do-origin; unrelated native completion behavior remains unchanged.

Task and ledger synchronization remain separate writes, not a distributed transaction. Local ordering and incoming task/Do order for known event markers have regression coverage; simultaneous edits on multiple devices and a device that has not yet received the latest Do are not claimed to be atomically resolved. Old clients without the adapter do not interpret the experiment's task metadata. This experiment should be reviewed separately before upstream adoption.

## Undo

Native snapshot actions and Do commands share chronological undo/redo ordering. A Do undo is a new validated version or tombstone, never restoration of a whole ledger or an old timestamp. Exact version checks include opaque fields; pending or newer foreign versions are not overwritten. Undo/redo restores only the checkbox transition owned by that command, respecting the current last Do. Native task transition IDs detect intervening ordinary task state changes.

The ledger's own held-write retry remains responsible for persistence. If a Do compensation is already canonical but its native checkbox side effect conflicts or fails, the Do compensation remains successful, the external task state is preserved, a separate notice is shown, and history continues. This is optimistic ownership checking, not cross-tab atomic compare-and-swap.

Notes trash clears and hides the note after success; pending independent-Do note deletion stays visible until canonical confirmation. A short-lived notes-column undo can restore and reopen it. Hidden notes are still mounted so closing the note is not deletion.
