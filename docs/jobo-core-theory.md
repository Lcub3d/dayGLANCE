# JOBO comparison model (slice 2)

This document records the comparison theory implemented by the pure JOBO core.
Progress remains a property of each Do attempt under the merged persistence
contract; timing comparison and progress are independent dimensions.

## Theory stack

1. **Feedback control** — Plan is the reference and Do is observed execution.
2. **Event-oriented history** — captured history is preserved; derived labels can be recomputed.
3. **Allen interval algebra** — execution envelope and Plan have one of thirteen interval relations.
4. **Scheduling / earliness-tardiness** — start and finish offsets are independent.
5. **Estimation** — duration difference and duration ratio are both retained.
6. **Measurement theory** — measured time and ordinal progress are not interchangeable.
7. **Preemptive scheduling** — split sessions retain active, elapsed, gap, and overlap measures.
8. **Strong eventual consistency** — comparison never influences `pickJoboRecord()`.

## Per-attempt progress

`DO_PROGRESS` is `started / partial / mostly / completed`.
Progress is stored on one Do attempt, is not a task-level percentage, and is
never inferred from duration. Completing creates `completed`;
`reassessDoProgress()` handles the other three values.

`notStarted` is separate from progress: it is derived only after the current
displayed Plan has fully elapsed with no live Do attempt.

## Canonical comparison dimensions

Plan context: `planned / noPlan / unknown`.

Start and finish timing: `early / onTime / late`.

Duration comparison: `shorter / onEstimate / longer`.

Execution pattern: `singleSession / splitSessions`.

A known absent timed plan is different from unavailable history. Raw signed
offsets and duration metrics remain available independently of summary labels.

Duration comparison uses overlap-deduplicated measured time. For
09:00–09:40 plus 09:20–10:00, attemptMinutes is 80 while recordedMinutes and
activeMinutes are 60 and overlapMinutes is 20. Gaps do not contribute measured
work.

## Timed / Untimed

Timed Do is a positive measured interval. Untimed Do is execution evidence with
unknown duration and explicit null interval coordinates.

Untimed Do suppresses `notStarted` but contributes no invented minutes. It
does not support start/finish, duration, or Allen comparison. If any live Do is
Untimed, the overall Plan → Do comparison is non-comparable; diagnostics for
the measured Timed subset remain available.

## Allen interval relation

`intervalRelation` compares the measured execution envelope with the Plan.
The thirteen serialized values are:

`before`, `meets`, `overlaps`, `starts`, `during`, `finishes`,
`equals`, `startedBy`, `contains`, `finishedBy`, `overlappedBy`,
`metBy`, `after`.

## Canonical product summary

`summarizeTiming()` returns a multi-label summary:

- `withinPlan`
- `late`
- `longer`
- `split`
- `notStarted`
- `unplanned`

`withinPlan` means comparable planned execution that is neither late nor
longer. `late` means start or finish is late under tolerance. `longer`
means recorded effort exceeds planned duration. `split` means two or more
live attempts. `notStarted` means the displayed Plan fully elapsed with no
live Do. `unplanned` requires explicit knowledge that there was no timed Plan.

## Original Plan → Final Plan

Plan change is measured independently from execution. Positive shifts mean the
Final Plan moved later or became longer; negative shifts mean earlier or shorter.
No causal explanation is inferred. Provisional Plan history remains in the
task-owned `deferrals` and `planTrail` model.

## Boundaries

The model does not infer causes, productivity, or recommended next actions. It
does not modify persistence, sync, backup/restore, native task completion, or
Life Planner behavior.
