# JOBO Slice 5 acceptance

Scope follows #1726's review of #1840: shared-axis Plan/Do, the day model,
manual Do creation, editing existing Do and the native Plan checkbox.
The full interaction reference is preserved at
`Lcub3d/dayGLANCE:reference/jobo-full-20260927` (`5918cef`).

The view reads committed `joboRecords` only and writes through `recordJobo`.
It does not use the detector's working set. Pending indicators are UI receipts,
not a retry queue; a held write is not yet durable. A closed editor does not
cancel an already accepted ledger write. Storage-outage restart limitations
remain those documented by the ledger.

## Checks with isolated synthetic data

- Plan and Do share an hour axis; short intervals retain an exact proportional
  marker separate from the interaction target. Cross-midnight Do is clipped.
- Native checkbox uses `toggleComplete`, leaving Slice 4 to create Untimed
  completion evidence. No view infers measured minutes from a plan duration.
- Manual Do allocates its id when the editor opens, before the first write;
  a refused-write retry uses that same id. Do progress never changes a task.
- Untimed correction keeps id, captured title/plan, source and original stamps.
  Invalid intervals, stale versions and tombstones do not produce stale writes.
- Held saves remain pending until committed; a superseding remote version is
  a conflict, not an invitation to restamp and defeat the winner.
- Loading, read errors, read-only devices and invalid evidence remain distinct.
  No Do recorded is not proof that the native task never ran.
- Task notes are optional and read-only in this slice. Narrow widths hide them.
- Timing details retain separate start, finish and duration comparisons, and
  distinguish the whole group from a measured subset and individual attempts.

Day tiles/Check belong to Slice 7. Independent Do notes need separate design.
Plan creation/copy/drag/resize, hover connections and daily-note placement are
not in this PR. Shared planner handlers, core, ledger, detector, sync and native
platform code are unchanged. #1829 already resolved pending completion/uncheck;
the same-key re-completion case is a separate issue, not a view workaround.
