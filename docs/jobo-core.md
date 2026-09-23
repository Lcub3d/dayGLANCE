# JOBO pure core (slice 2)

Implements the record-facing part of #1726 while proposing one explicit Slice 2
contract refinement relative to the merged
[jobo-ledger-persistence.md](jobo-ledger-persistence.md) design (#1744):
Do records would no longer carry progress, and completion would belong to Plan
if this proposal is accepted. #1744 remains the current upstream persistence
contract while that ownership question is under review.

This module does not import React, storage, a task store or a sync engine.
It does not obtain the current time or generate IDs. No app surface imports it
until the later slices are wired, so the feature-off experience is unchanged.

The completion-ownership behavior described below is a fork-local proposal,
not a claim that the merged persistence design or upstream implementation has
already changed. Slice 4 completion detection and JOBO checkbox behavior remain
outside this Slice 2 document.

## API

| Export | Contract |
| --- | --- |
| `createDoRecord(input)` | Returns a full, defensively copied record; invalid input throws `TypeError`. Only `deleted` defaults to `false`. |
| `validateDoRecord(record)` | Returns `{ ok, errors }`, with no repair, clock lookup or migration. |
| `updateDoRecord(record, patch, updatedAt)` | Patches only interval fields, never captured identity/title/plan/source/creation/observation data. |
| `tombstoneDoRecord(record, updatedAt)` | Returns a retained `deleted: true` version; repeat deletion is a no-op. |
| `completeDoAttempt(records, input)` | Pure ensure-present by caller-supplied completion ID; otherwise appends one execution attempt. |
| `doDurationMinutes(record)` | Civil-clock minutes for Timed Do; returns `null` for Untimed Do. |
| `setPlanCompletionStatus(plan, completionStatus)` | Pure Plan-occurrence reassessment. Requires stable Plan `id`; any valid status may replace any other, and `null` clears it. |
| `comparePlanAnchors(originalPlan, finalPlan)` | Returns raw Original → Final schedule deltas: start shift, finish shift, duration difference and duration ratio. |
| `compareExecutionToPlan(plan, records, options)` | Canonical timing/completion comparison; duration uses overlap-deduplicated measured time. |
| `classifyAgainstPlan(plan, records, options)` | Legacy vocabulary adapter over `compareExecutionToPlan()`; contains no separate business rules. |
| `migrateLegacyDoRecord(record)` | Explicitly strips legacy Do `progress` and returns a separate `legacyCompletionStatus` for Plan migration. |
| `pickJoboRecord(a, b)` | Returns one whole original operand: newer `updatedAt`, lower `observedAt`, then recursively canonical JSON. Schema migration is outside the merge rule. |

A record has `id`, `taskId`, `timing`, `date`, `startTime`, `endDate`,
`endTime`, `title`, `planSnapshot`, `source`, `createdAt`, `updatedAt`,
`observedAt`, and `deleted`.

`timing` is explicit: `timed` or `untimed`.
- Timed Do requires a positive real interval.
- Untimed Do means execution happened but duration was not measured; it keeps
  `date` and uses explicit `null` for `startTime`, `endDate`, and `endTime`.

In this proposed ownership model, a `progress` field is invalid because completion would belong to Plan rather than Do. `taskId`
allows a native numeric/string ID or explicit `null`; `planSnapshot` is a
captured timed plan or explicit `null` when there was no timed plan at capture.
Do not use `null` to fill unavailable historical data.
Orphan IDs survive.
JSON extension fields are copied and preserved by edits and by the picker.

`DO_SOURCES` contains `completion`, `manual`, `focus`; accepting `focus`
is not focus-session integration. Under the proposed ownership refinement,
Plan completion is a separate dimension (`started / partly / mostly / completed`)
described in [jobo-core-theory.md](jobo-core-theory.md), and is not serialized
on Do records.

Dates must be real Gregorian `YYYY-MM-DD` values and measured times must be
`HH:MM`. Use next-day `endDate` plus `00:00`, not `24:00`.

Do never uses zero minutes as a sentinel:
- Timed Do must have a strictly positive interval.
- Untimed Do explicitly stores unknown duration by null interval coordinates.

Core does not infer an actual start or a default duration. Under the proposed
ownership refinement, Plan completion is a separate ordinal assessment
(`started / partly / mostly / completed`) with canonical order exported by
`COMPLETION_STATUS_ORDER`; reassessment is allowed in either direction through
`setPlanCompletionStatus()`. ISO timestamps require an explicit
zone/offset. Inputs are not normalized into invented historical values.
A local edit/deletion needs a supplied timestamp strictly newer than the
previous version; a no-op keeps the original object and version. Clock skew
must be handled by the caller, not by silently substituting this device's now.
`observedAt` need not follow the source-event timestamp because clocks can differ.

## Direct connection to draft #1762

At `2097d0179fa2e00aea13f575b13f8c5b9b6cae19`, its existing injection signatures
already accept these functions without a wrapper:

```js
import { createDoRecord, pickJoboRecord } from './core.js';
import { createLedger } from './ledger.js';

const ledger = createLedger({ store, pick: pickJoboRecord });
await ledger.load();
const record = createDoRecord(recordInput); // caller supplies all historical data
const result = await ledger.commit([record]); // commit takes an ARRAY
```

The React hook accepts `useJoboLedger({ pickRecord: pickJoboRecord })`.
Its `recordJobo` and `applyRemoteJobo` also take arrays. This PR does not copy
or modify #1762's controller, store or hook, and does not install a second writer.

The picker intentionally accepts opaque/minimal transport rows, including
legacy timestamp-less rows, rather than running full new-record validation.
For `updatedAt` and `observedAt`, the picker accepts valid ISO strings with an
explicit timezone/offset, plus finite numeric epoch milliseconds within the
JavaScript `Date` range (with its millisecond truncation). Missing, invalid or
offsetless timestamps rank at epoch zero; numeric strings, booleans and objects
are not coerced into dates. These ranks are independent of the device timezone.
This compatibility rule neither repairs nor rewrites the original fields;
new-record construction still requires valid ISO timestamps with an explicit
timezone/offset. The picker accepts a missing operand, requires matching IDs
(string identity, like the controller), and returns an existing operand without
changing timestamps or dropping fields.
Legacy rows are normalized at the migration/import boundary before they enter
canonical merge. `pickJoboRecord()` is deliberately schema-agnostic: after an
exact `updatedAt` + `observedAt` tie it recursively sorts every object's keys,
retains array order, and uses code-unit comparison rather than locale-dependent
collation. It does NOT use `JSON.stringify(row, Object.keys(row).sort())`,
whose replacer whitelist can omit `planSnapshot.duration` and other nested-only keys.

`completeDoAttempt` is a pure ensure-present operation, not a completion observer.
Slice 4 supplies a NEW key for a later completion, including a new per-occurrence
stamp for recurring work. A replay returns the existing collection unchanged, even
when its row is edited/deleted. Under the proposed completion-ownership refinement,
reopening a native task does not mutate the prior Do; any completion reassessment
would live on Plan state. That ownership rule is not yet an upstream contract.

The writer still owns checking this against current committed state; calling the
constructor alone is not an atomic ensure-present guarantee. Native completion,
remote-apply detection, legacy ID selection, retry orchestration, and JOBO checkbox
behavior remain outside this Slice 2 core.

## Classification choices and limits

`compareExecutionToPlan()` is the single timing rules engine.
`classifyAgainstPlan()` is a thin legacy-label adapter over it.

Pass one explicit plan anchor and a caller-selected array of distinct attempts:

```js
const planChange = comparePlanAnchors(originalPlan, attempt.planSnapshot);
classifyAgainstPlan(originalPlan, selectedAttempts);
classifyAgainstPlan(attempt.planSnapshot, [attempt], {
  knownUnplanned: attempt.planSnapshot === null,
});
classifyAgainstPlan(originalPlan, [], {
  displayedPlan: currentPlan,
  now: { date: '2026-09-19', time: '16:00' },
});
```

Timing and Plan completion are independent. Delayed means first actual start after
anchor start OR last actual end after anchor end. Overrun means the union of
recorded intervals is longer than the anchor duration. With neither, Within Plan
applies where the actual timing is comparable. Overlaps count once and gaps do
not count: 09:00–09:20 plus 09:40–10:00 is 40 minutes, while 09:00–09:40 plus
09:20–10:00 is 60 minutes. First start and last end bound the schedule comparison;
their difference is not the recorded work duration.

Untimed Do is a real execution record, not a zero-duration placeholder. It
suppresses Not Started because execution evidence exists, but contributes no
measured minutes and supplies no interval bounds. If any live Do is Untimed, the
overall Plan-vs-Do timing comparison is non-comparable; measured diagnostics for
Timed Do remain available. A known absent timed plan can still yield Unplanned.

Two or more live records still yield Interrupted independently, even when
adjacent or overlapping. This is the agreed interaction/segmentation cue, not
proof of a real-world interruption. Two identical one-hour records therefore
yield 60 recorded minutes and Interrupted, not an automatic Overrun. Interval
union applies only to the caller-selected attempts; it does not infer a global
daily total or merge distinct record identities.

Not Started is derived only when no live attempt exists, the CURRENT displayed
Plan has wholly elapsed, and the Plan has no explicit completion assessment.
With no supplied `now`, it is not derived. Deleted rows are excluded from
analysis but never removed from a collection. Duplicate IDs must be merged first,
not silently double-counted.
Here Not Started means that the user has not recorded an attempt; it is not
live activity detection. A five-minute recorded attempt may remain Within Plan
after the plan ends; passage of time alone does not make the historical interval
delayed. Plan completion is assessed separately. When comparing Original Plan after a
reschedule, pass the current plan as `displayedPlan` for this no-attempt check.

Persisted `planSnapshot: null` means that the attempt had no timed plan at capture.
When comparing that attempt with its captured Final Plan, pass
`knownUnplanned: true` as in the example above to obtain Unplanned.

The generic `classifyAgainstPlan(null, records)` call is different: its null
argument means no comparison anchor was supplied. For example, Original Plan
history may be unavailable even though an attempt has a valid Final Plan snapshot.
Without explicit `knownUnplanned: true`, that result is `comparable: false` with
no Within Plan/Delayed/Overrun or Unplanned label. The caller must select the
anchor and distinguish missing comparison history from a known absent timed
plan; it must not encode unknown history as a persisted null snapshot. This
clarification adds no field or new unknown state to the agreed record.

Under the proposed completion-ownership refinement, Plan completion belongs to
an identified Plan instance. A non-null `completionStatus` requires a stable
Plan `id`; it is read from the Plan,
not passed as a comparison option. `setPlanCompletionStatus()` is deliberately
a reassessment function rather than a monotonic state machine: `completed` may
be reassessed to `partly`, and any assessment may be cleared. The classifier
does not return per-Do progress, choose a latest attempt from sync-array order,
aggregate a completion percentage, or change native task completion.

Original Plan and Final Plan are first-class analytical anchors. Use
`comparePlanAnchors(originalPlan, finalPlan)` for the raw planning-change
metrics:

- `startShiftMinutes = final start - original start`
- `finishShiftMinutes = final finish - original finish`
- `durationDifferenceMinutes = final duration - original duration`
- `durationRatio = final duration / original duration`

Positive values mean the Final Plan moved later or became longer; negative
values mean earlier or shorter. Core reports these facts only and does not infer
why the plan changed.

Provisional-plan history stays on the task under the already-settled dayGLANCE
model: `deferrals` is the monotonic count, and `planTrail` keeps the bounded
recent stops. Both record only qualifying moves made after the task had already
come due; ordinary planning churn while the task is still in the future is not
counted. Slice 2 does not add another revision counter, does not mutate these
task fields, and does not duplicate their merge semantics inside JOBO.

Do not compare a group of attempts with different snapshots to an implicitly
selected last snapshot. Select a common anchor explicitly, or compare each
attempt with its own snapshot.

Intervals use CIVIL planner coordinates, independent of the machine's timezone.
This is an explicit implementation choice for the contract's date/time fields,
not a claim of measured UTC duration across DST folds/gaps or timezone travel.
Those cannot be reconstructed from these fields alone. No timezone field,
remaining-effort estimate, invented measured duration, or live-task lookup is
added here.

## Validation and handoff

`npm test -- src/jobo/core.test.js` runs the standalone Vitest suite.
The suite covers construction, immutable snapshots, edits/tombstones, ordinary
and recurring re-complete identity, civil midnight/leap/year boundaries, both plan
anchors, independent labels, unknown plans, late duplicates, nested-key ties,
picker commutativity/associativity/idempotence, and legacy timestamp ranks in
independent UTC and Asia/Shanghai processes.

Current validation is performed by the repository's real Vitest/ESLint/build
workflow. Native checkbox integration and the slice-3 persistence wiring remain
separate integration work.

The earlier core baseline was separately audited against the real controller
and store from a pinned #1762 revision, including save, hydration, remote apply,
re-complete, two writers and readonly fallback. That historical audit
does not establish integration coverage for these new behavioral rules. The
remaining native-completion and checkbox integration acceptance checks belong to later slices.
