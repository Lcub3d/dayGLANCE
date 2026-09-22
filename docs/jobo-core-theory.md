
# JOBO theory-driven comparison model (Slice 2 follow-up)

This document is a fork-local refinement layered on the current Slice 2 core.
It does not change the merged #1744 persistence contract and it does not wire UI,
storage, sync or task completion.

The existing `classifyAgainstPlan()` API remains untouched for compatibility
while this model is reviewed. New Slice 2 consumers should prefer
`compareExecutionToPlan()` exported directly from `src/jobo/core.js`.

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
6. **Measurement theory** — time is ratio-scale data; progress is ordinal and must not be inferred from time spent.
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

Duration comparison uses the **sum of per-attempt recorded durations**. This is the effort attributed to the task. `activeMinutes` separately stores the union of actual wall-clock coverage so overlapping attempts are visible rather than silently double-counted as unique time.

For example, 09:00–09:40 plus 09:20–10:00 gives:

- `recordedMinutes = 80`
- `activeMinutes = 60`
- `overlapMinutes = 20`
- `elapsedMinutes = 60`

This permits effort and unique clock coverage to answer different questions.

### Execution pattern

- `single_session`
- `split_sessions`

`split_sessions` is deliberately neutral. It does not claim that a meeting, distraction or other external interruption caused the segmentation.

### Progress

The existing `started / partial / mostly / completed` vocabulary is retained. It is ordinal. No numeric completion percentage is inferred. A task planned for 60 minutes may be completed in 10 minutes without becoming “16.7% complete.”

## Raw metrics

For a comparable planned execution:

- `startOffsetMinutes = actual first start - planned start`
- `finishOffsetMinutes = actual final finish - planned finish`
- `durationDifferenceMinutes = sum(recorded attempt minutes) - planned duration`
- `durationRatio = sum(recorded attempt minutes) / planned duration`
- `planOverlapMinutes = unique active minutes inside the plan interval`

For the execution itself, regardless of plan availability:

- `recordedMinutes` — sum of positive attempt durations
- `activeMinutes` — union of wall-clock intervals
- `elapsedMinutes` — first timed start to last timed finish
- `gapMinutes = elapsedMinutes - activeMinutes`
- `overlapMinutes = recordedMinutes - activeMinutes`
- `attemptCount`
- `timedSessionCount`

A zero-minute completion placeholder counts as an attempt but not as measured work time.

## Interval relation

`intervalRelation` is the Allen relation between the **execution envelope** (first timed start to last timed finish) and the plan. With split sessions, this describes schedule placement only; active effort remains represented by the separate metrics above.

The thirteen values are:

`before`, `meets`, `overlaps`, `starts`, `during`, `finishes`, `equals`, `started_by`, `contains`, `finished_by`, `overlapped_by`, `met_by`, `after`.

## Canonical product summary

`summarizeTiming()` is the small product-level summary. It is derived from the richer theory dimensions above and is **multi-label**, not one mutually-exclusive status.

Canonical labels:

- `on_plan`
- `late`
- `longer`
- `split`
- `not_started`
- `unplanned`

Rules:

- `on_plan`: a comparable planned execution exists and it is neither late nor longer. Early starts, early finishes and shorter execution can still be on-plan because they do not represent lateness or excess estimated effort.
- `late`: start is late **or** finish is late under the supplied tolerance policy.
- `longer`: recorded effort is longer than the plan duration under the supplied duration tolerance.
- `split`: two or more live Do attempts exist.
- `not_started`: no live attempt exists and the current displayed plan has fully elapsed.
- `unplanned`: the caller explicitly knows there was no timed plan.
- `unknown` remains a lower-level Plan Context state and intentionally emits no product summary label.

Valid combinations include:

- `late + longer`
- `late + split`
- `longer + split`
- `late + longer + split`
- `on_plan + split`

Detailed dimensions such as early/late start, early/late finish, shorter/on-estimate/longer and Allen interval relation remain available for explanation, analytics and future UI drill-down. They are not canonical summary labels.

No single overall status is required.

## Boundaries

This layer does **not** infer procrastination, meeting interruption, low productivity, reasons for plan changes, or what the user should do next. Those belong to future Check / Act behavior.

The model also does not modify `pickJoboRecord`, persistence, sync, backup, restore, native task completion or Life Planner.


## Transition note

`classifyAgainstPlan()` and the prototype `TIMING` constants are retained only as a temporary compatibility surface while downstream code is migrated. They are not canonical and should not be used for new persistence or analytics. Before Slice 2 is proposed upstream, either migrate the remaining consumers to `compareExecutionToPlan()` or keep the legacy wrapper explicitly documented as a UI adapter; do not maintain two independent business-rule engines long term.
