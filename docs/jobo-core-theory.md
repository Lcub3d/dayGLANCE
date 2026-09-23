
# JOBO theory-driven comparison model (Slice 2 follow-up)

This document is a fork-local refinement layered on the current Slice 2 core.
It proposes one explicit revision to the merged #1744 persistence contract:
Do records no longer carry progress/completion. Completion belongs to Plan.
It does not wire UI, storage, sync or task completion.

`classifyAgainstPlan()` remains only as a compatibility adapter. It delegates
all timing decisions to `compareExecutionToPlan()`; there is one rules engine,
not two. New Slice 2 consumers should use `compareExecutionToPlan()` directly.

## Why the old five labels are not canonical

The prototype vocabulary mixed several different concepts:

- `Within Plan` was an overall policy summary.
- `Delayed` combined start and finish deviation.
- `Overrun` could mean either a late finish or more work than estimated.
- `Interrupted` described segmentation but sounded causal.
- `Unplanned` described the existence of a plan, not timing.

The canonical model therefore uses independent dimensions rather than one
mutually-exclusive timing enum.

## Theory stack

1. **Feedback control** — Plan is a reference, Do is observed execution, and the difference is measured error. Do never rewrites Plan.
2. **Event-oriented history** — historical observations stay immutable; derived labels can be recomputed.
3. **Allen interval algebra** — the execution span and plan have one of thirteen structural interval relations.
4. **Scheduling / earliness-tardiness** — start and finish offsets are separate signed measurements.
5. **Estimation** — duration difference and duration ratio are both retained.
6. **Measurement theory** — time is ratio-scale data; Plan completion is ordinal and must not be inferred from time spent.
7. **Preemptive scheduling** — several Do records may form split sessions, with recorded effort, unique active time, elapsed span, overlap and gaps kept separate.
8. **Strong eventual consistency** remains the job of the existing `pickJoboRecord()` contract; this comparison layer never influences merge winner selection.

## Canonical dimensions

### Plan context

- `planned`
- `no_plan`
- `unknown`

`planSnapshot: null` can represent a known absent timed plan. Missing or unavailable historical information is not silently converted to `no_plan`.

### Start and finish timing

Each is independently:

- `early`
- `on_time`
- `late`

Raw signed offsets are always retained. `on_time` depends on an explicit non-negative tolerance policy; the default is exact comparison (`0` minutes), not a hidden product-wide grace period.

### Duration comparison

- `shorter`
- `on_estimate`
- `longer`

Duration comparison uses **overlap-deduplicated actual time**. Multiple Do
intervals may overlap, but the same wall-clock minute is counted once when
deciding `longer`.

For example, 09:00–09:40 plus 09:20–10:00 gives:

- `attemptMinutes = 80` — raw sum of attempt durations
- `recordedMinutes = 60` — canonical actual time
- `activeMinutes = 60` — union of wall-clock coverage
- `overlapMinutes = 20`
- `elapsedMinutes = 60`

The user-confirmed 40 + 30 with 10 minutes overlap therefore gives 60 actual
minutes, not 70.

### Execution pattern

- `single_session`
- `split_sessions`

`split_sessions` is deliberately neutral. It does not claim that a meeting, distraction or other external interruption caused the segmentation.

### Completion

Plan has a separate completion dimension:

- `started`
- `partly`
- `mostly`
- `completed`

This is an ordinal assessment owned by an identified Plan instance. A non-null
`completionStatus` therefore requires a stable Plan `id`; it is not accepted
as a free-standing comparison option. Plan revisions passed as `plan` and
`displayedPlan` must identify the same Plan when both expose ids.

`not_started` is deliberately **not** part of this four-level completion
dimension. It remains time-gated: no live Do exists, the current displayed Plan
has fully elapsed, and the Plan has no explicit completion assessment. This
prevents contradictory `Completed + Not Started` output.

Do records intentionally contain no progress/completion field. Legacy
prototype/#1744 rows use the explicit `migrateLegacyDoRecord()` boundary:
the record is returned without `progress`, while a separate
`legacyCompletionStatus` is returned for the caller to attach to the correct
identified Plan if appropriate. Migration happens **before merge**. The merge
rule stays schema-agnostic and does not know about `progress` or migration
versions.

The Plan-level completion dimension uses `partly` as its canonical value.

The completion scale is ordinal only. No numeric percentage is inferred. A task planned for 60 minutes may be marked `completed` after 10 minutes without becoming “16.7% complete.”

## Raw metrics

For a comparable planned execution:

- `startOffsetMinutes = actual first start - planned start`
- `finishOffsetMinutes = actual final finish - planned finish`
- `durationDifferenceMinutes = recordedMinutes - planned duration`
- `durationRatio = recordedMinutes / planned duration`
- `planOverlapMinutes = unique active minutes inside the plan interval`

For the execution itself, regardless of plan availability:

- `attemptMinutes` — raw sum of positive attempt durations
- `recordedMinutes` — overlap-deduplicated actual time
- `activeMinutes` — same union of wall-clock intervals as `recordedMinutes`
- `elapsedMinutes` — first start to last finish
- `gapMinutes = elapsedMinutes - activeMinutes`
- `overlapMinutes = attemptMinutes - activeMinutes`
- `attemptCount`
- `timedSessionCount`

Every Do must have a positive execution interval. A native/task completion with
no actual interval may still update Plan/native completion state, but it does
not create a zero-minute Do placeholder.

## Interval relation

`intervalRelation` is the Allen relation between the **execution envelope** (first timed start to last timed finish) and the plan. With split sessions, this describes schedule placement only; active effort remains represented by the separate metrics above.

The thirteen values are:

`before`, `meets`, `overlaps`, `starts`, `during`, `finishes`, `equals`, `started_by`, `contains`, `finished_by`, `overlapped_by`, `met_by`, `after`.

## Canonical product summary

`summarizeTiming()` is the small product-level summary. It is derived from the richer theory dimensions above and is **multi-label**, not one mutually-exclusive status.

Canonical labels:

- `within_plan`
- `late`
- `longer`
- `split`
- `not_started`
- `unplanned`

Rules:

- `within_plan`: a comparable planned execution exists and it is neither late nor longer. Early starts, early finishes and shorter execution can still be within-plan because they do not represent lateness or excess estimated effort.
- `late`: start is late **or** finish is late under the supplied tolerance policy.
- `longer`: recorded effort is longer than the plan duration under the supplied duration tolerance.
- `split`: two or more live Do attempts exist.
- `not_started`: **Plan fully elapsed AND no live Do AND no explicit Plan completion assessment**. Missing Do alone is never enough; before the Plan ends there is no `not_started`, and an explicit Plan completion suppresses it.
- `unplanned`: the caller explicitly knows there was no timed plan.
- `unknown` remains a lower-level Plan Context state and intentionally emits no product summary label.

Valid combinations include:

- `late + longer`
- `late + split`
- `longer + split`
- `late + longer + split`
- `within_plan + split`

Detailed dimensions such as early/late start, early/late finish, shorter/on-estimate/longer and Allen interval relation remain available for explanation, analytics and future UI drill-down. They are not canonical summary labels.

No single overall status is required.

## Boundaries

This layer does **not** infer procrastination, meeting interruption, low productivity, reasons for plan changes, or what the user should do next. Those belong to future Check / Act behavior.

The model also does not modify `pickJoboRecord`, persistence, sync, backup, restore, native task completion or Life Planner.


## Transition note

`classifyAgainstPlan()` and the prototype `TIMING` constants are retained only
as a temporary compatibility surface. The wrapper translates canonical labels
from `compareExecutionToPlan()`; it contains no independent timing rules.


## Do record boundary

A Do record is execution evidence only. Its core fields are identity, task link,
actual interval, captured title/plan snapshot, source, version timestamps and
tombstone state. A `progress` field is invalid.

This separation prevents one execution segment from being mistaken for the
completion state of the Plan that may own several Do attempts.
