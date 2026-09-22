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
- A new completion appends one Do execution attempt. The Do record contains
  execution facts only; it does not carry progress/completion.
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
- An unplanned completion with unknown duration may use equal start/end
  coordinates only when `source === 'completion'` and `planSnapshot === null`.
  It contributes zero recorded minutes and counts as a recorded attempt. Do not
  present that zero as measured time or classify it as Not Started. It provides
  no timing bounds: only positive intervals can produce Within Plan, Delayed
  or Overrun. A known absent timed plan can still produce Unplanned. No new
  persisted field is required.
- With no recorded attempt, an elapsed current displayed plan may be Not
  Started even if the person is actually working. Once an attempt is recorded,
  judge timing from the execution record and completion from Plan state; do not
  reinterpret a past in-plan interval as delayed merely because current time advanced.

## Integration acceptance checks

Before calling the checkbox wired, verify that checking completes the native
task and persists one Do; replay creates no duplicate; changing Plan completion
to `mostly` does not mutate that Do; unchecking does not rewrite historical Do
records; and a later check creates a new attempt. Verify native completion behavior,
recurring-task snapshot capture and ledger failure handling through their
existing paths. Pure-core tests alone do not establish these UI/storage effects.
