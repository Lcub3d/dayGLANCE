# JOBO checkbox: slice 4/5 handoff

These are the user's decisions following the pure-core review. They settle the
fork's product behavior; they do not claim upstream acceptance or amend the
merged [#1744 ledger design](jobo-ledger-persistence.md). Core remains pure.
This branch does not yet wire a completion detector, task hook or checkbox UI.

## Native completion and Plan completion

- Checking JOBO's checkbox must also complete the native task through its
  existing completion path. Slice 4 coordinates that path with the ledger write;
  the view must not install a second independent record writer. Capture the
  title, plan and occurrence identity before native completion can advance a
  recurring task. Reuse the same completion identity in the observer so it
  cannot record that same event twice.
- A native completion may append a Do only when a positive actual/retrospective
  execution interval is available. The Do record contains execution facts only;
  it does not carry progress/completion. A completion event with no actual
  interval updates native/Plan state but does not create a zero-minute Do.
- Plan owns the independent completion assessment:
  `started / partly / mostly / completed`. Native task completion and Plan
  completion may differ; changing Plan completion must not rewrite a Do record.
- Unchecking uses the existing native reopen path. It does not mutate the prior
  Do attempt. Any change from Plan `completed` to another completion assessment
  is a Plan-state decision, not a ledger-record transition.
- If work is added after an earlier completion, preserve the old Do attempt and
  append a later attempt separately. Do not treat every reopen as proof of
  additional work.

Slice 4 owns event identity, ordering, replay handling and coordinated writes.
A replay of the same completion ID must not append another Do. A later
completion after reopening uses a new attempt ID.

## Recorded time

- Sum the union of actual intervals: count overlaps once and exclude gaps.
  09:00–09:20 plus 09:40–10:00 is 40 minutes; 09:00–09:40 plus
  09:20–10:00 is 60 minutes. First start/last end still govern delay comparison.
- Two or more live attempts retain the Interrupted label, including adjacent or
  overlapping intervals. The label reflects the agreed interaction meaning.
- Every Do has a strictly positive execution interval. If completion is known
  but duration is not, do not invent an interval and do not create a placeholder
  Do. A positive unplanned Do may still use `planSnapshot: null` and be
  classified as Unplanned.
- With no recorded attempt, an elapsed current displayed plan may be Not
  Started even if the person is actually working. Once an attempt is recorded,
  judge timing from the execution record and completion from Plan state; do not
  reinterpret a past in-plan interval as delayed merely because current time advanced.

## Integration acceptance checks

Before calling the checkbox wired, verify that checking completes the native
task; when a positive execution interval exists it persists one Do and replay
creates no duplicate; when no interval exists it creates no fake Do; changing
Plan completion to `mostly` does not mutate historical Do records; unchecking
does not rewrite them; and a later recorded execution creates a new attempt. Verify native completion behavior,
recurring-task snapshot capture and ledger failure handling through their
existing paths. Pure-core tests alone do not establish these UI/storage effects.
