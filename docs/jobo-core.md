# JOBO pure core (slice 2)

Slice 2 defines the pure JOBO record and comparison rules used by the ledger.
It imports no React, storage, sync engine, task store, or clock.

The persistence contract is the merged #1744 design: **progress belongs to each
Do attempt**. Timed / Untimed execution is explicit in the record shape.

## Public API

| Export | Contract |
| --- | --- |
| `createDoRecord(input)` | Validate and defensively copy one canonical Do record. |
| `validateDoRecord(record)` | Validate without repair, migration, or clock lookup. |
| `updateDoRecord(record, patch, updatedAt)` | Correct timing fields only; captured history is preserved. |
| `reassessDoProgress(record, progress, updatedAt)` | Reassess an existing attempt to `started`, `partial`, or `mostly`. |
| `tombstoneDoRecord(record, updatedAt)` | Soft-delete one record with a newer version. |
| `completeDoAttempt(records, input)` | Ensure one completion record exists; a new completion is always `completed`. |
| `migrateLegacyDoRecord(record)` | Normalize a prototype-import row to the canonical progress/timing shape. |
| `doDurationMinutes(record)` | Measured civil minutes for Timed Do; `null` for Untimed Do. |
| `pickJoboRecord(a, b)` | Deterministic merge winner for two copies of the same id. |
| `comparePlanAnchors(originalPlan, finalPlan)` | Raw Original Plan → Final Plan schedule deltas. |
| `compareExecutionToPlan(plan, records, options)` | Rich Plan → Do comparison with independent dimensions and raw metrics. |
| `summarizeTiming(comparison)` | Compact multi-label product summary. |
| `classifyAgainstPlan(...)` | Compatibility adapter for the prototype timing vocabulary. |

## Do record contract

Canonical records contain a stable id/task link, explicit Timed or Untimed
execution shape, captured title and plan snapshot, source, per-attempt progress,
version timestamps, tombstone state, and optional opaque JSON extension fields.

`title` and `planSnapshot` are capture-once history. Interval correction,
progress reassessment, persistence, merge, and later task edits do not refresh
them from the live task.

### Progress

`DO_PROGRESS` is serialized once in core:

- `started`
- `partial`
- `mostly`
- `completed`

Completing creates a `completed` attempt. Reassessment can move an existing
attempt to any of the other three values while preserving its interval and
snapshot. A later completion is a new attempt under a new completion key.

`notStarted` is not progress. It is derived when the current displayed Plan
has fully elapsed and there is no live Do attempt.

### Timed / Untimed

Timed Do has a positive measured interval. Untimed Do means execution is known
to have happened but duration was not measured:

```js
{
  timing: 'untimed',
  startTime: null,
  endDate: null,
  endTime: null,
}
```

Untimed Do is real execution evidence. It suppresses `notStarted`, but does
not contribute a fabricated zero-minute interval and does not support
start/finish, duration, or Allen comparison. In mixed Timed + Untimed history,
the overall Plan → Do comparison is non-comparable while measured Timed
diagnostics remain available.

## Prototype import

`migrateLegacyDoRecord()` is an import boundary for prototype data, not a
normal persistence or merge step. Prototype progress maps as
`started → started`, `partial → partial`, `mostly → mostly`, and
`complete → completed`.

Prototype rows that predate the explicit timing discriminant are normalized to
Timed or, for zero-duration completion evidence, Untimed before canonical
validation. Current canonical records do not pass through migration.

## Merge contract

`pickJoboRecord()` is schema-agnostic and returns one original operand:

`updatedAt → observedAt → canonical JSON`

Newer `updatedAt` wins. On an exact version tie, lower `observedAt` wins.
If that also ties, recursively canonical JSON decides. The rule is
order-independent and preserves tombstones and opaque fields.

## Comparison model

The rich comparison keeps independent dimensions:

- Plan context: `planned / noPlan / unknown`
- Start: `early / onTime / late`
- Finish: `early / onTime / late`
- Duration: `shorter / onEstimate / longer`
- Execution: `singleSession / splitSessions`
- all 13 Allen interval relations

The compact summary is multi-label:
`withinPlan`, `late`, `longer`, `split`, `notStarted`, `unplanned`.

Measured duration uses the union of Timed intervals, so overlapping wall-clock
minutes count once and gaps add no recorded work.

## Plan anchors

The analytical path is `Original Plan → Final Plan → Do`.
`comparePlanAnchors()` reports raw schedule deltas and does not infer why a
plan changed. Provisional-plan history remains task-owned through
`deferrals` and `planTrail`.

## Boundaries

Slice 2 does not wire storage, sync, React, task completion detection, native
checkbox behavior, backup/restore, Carry Forward, or mobile UI. The comparison
surface is frozen here for later slices to consume.
