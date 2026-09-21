# JOBO pure core (slice 2)

Implements the record-facing part of #1726 against the merged
[jobo-ledger-persistence.md](jobo-ledger-persistence.md) contract (#1744).
This module does not import React, storage, a task store or a sync engine.
It does not obtain the current time or generate IDs. No app surface imports it
until the later slices are wired, so the feature-off experience is unchanged.

## API

| Export | Contract |
| --- | --- |
| `createDoRecord(input)` | Returns a full, defensively copied record; invalid input throws `TypeError`. Only `deleted` defaults to `false`. |
| `validateDoRecord(record)` | Returns `{ ok, errors }`, with no repair, clock lookup or migration. |
| `updateDoRecord(record, patch, updatedAt)` | Patches only interval fields and/or progress, never captured identity/title/plan/source/creation/observation data. |
| `tombstoneDoRecord(record, updatedAt)` | Returns a retained `deleted: true` version; repeat deletion is a no-op. |
| `completeDoAttempt(records, input)` | Pure ensure-present by caller-supplied completion ID; otherwise appends a Completed attempt. |
| `reopenDoAttempt(records, previousId, updatedAt)` | Changes that attempt to Partially Completed, preserving its interval and snapshot. Missing or deleted attempts are not recreated. |
| `doDurationMinutes(record)` | Positive civil-clock minutes, including explicit `endDate`. |
| `classifyAgainstPlan(plan, records, options)` | Independent timing labels and a per-attempt progress list, with recorded minutes and attempt count. |
| `pickJoboRecord(a, b)` | Returns one whole original operand: newer `updatedAt`, lower `observedAt`, smaller recursively canonical JSON. |

A record has `id`, `taskId`, `date`, `startTime`, `endDate`, `endTime`, `title`,
`planSnapshot`, `source`, `progress`, `createdAt`, `updatedAt`, `observedAt`, and
`deleted`. `taskId` allows a native numeric/string ID or explicit `null`;
`planSnapshot` allows a valid timed plan or explicit `null`. Orphan IDs survive.
JSON extension fields are copied and preserved by edits and by the picker.

`DO_PROGRESS` defines the serialized vocabulary once: `started`, `partial`,
`mostly`, `completed`. The first three retain the prototype spellings;
`completed` follows the merged contract's example. `notStarted` is never a Do
progress value. Prototype JSON migration (including its `complete` spelling)
is outside this slice. `DO_SOURCES` contains `completion`, `manual`, `focus`;
accepting `focus` is not focus-session integration.

Dates must be real Gregorian `YYYY-MM-DD` values and times must be `HH:MM`.
Use next-day `endDate` plus `00:00`, not `24:00`. Intervals must be positive;
Not Started is not a zero-duration record. ISO timestamps require an explicit
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
It keeps #1762's epoch-zero rank for missing/invalid timestamps. It accepts a
missing operand, requires matching IDs (string identity, like the controller),
and returns an existing operand without changing timestamps or dropping fields.
On the final tie it recursively sorts every object's keys, retains array order,
and uses code-unit comparison rather than locale-dependent collation. In
particular it does NOT use `JSON.stringify(row, Object.keys(row).sort())`, whose
replacer whitelist can omit `planSnapshot.duration` and other nested-only keys.

`completeDoAttempt` / `reopenDoAttempt` are pure operations, not completion
observers. Slice 4 supplies the previous key on uncheck and a NEW key for a later
completion, including a new per-occurrence stamp for recurring work. A replay
returns the existing collection unchanged, even when its row is edited/deleted.
The writer still owns checking this against current committed state; calling the
constructor alone is not an atomic ensure-present guarantee. Native completion,
remote-apply detection, legacy ID selection and retry orchestration remain outside
core. Nothing here decides the JOBO-checkbox/native-completion question.

## Classification choices and limits

Pass one explicit plan anchor and a caller-selected array of distinct attempts:

```js
classifyAgainstPlan(originalPlan, selectedAttempts);
classifyAgainstPlan(attempt.planSnapshot, [attempt]);
classifyAgainstPlan(originalPlan, [], {
  displayedPlan: currentPlan,
  now: { date: '2026-09-19', time: '16:00' },
});
```

Timing follows the prototype's independent rules. Delayed means first actual
start after anchor start OR last actual end after anchor end. Overrun means sum
of entered durations greater than the anchor duration. With neither, Within Plan
applies. Two or more records yield Interrupted independently, even if adjacent;
it is a segmentation cue, not proof of a real-world interruption. Gaps do not
count; overlaps are summed, not unioned. This is not a daily unique-time total.

Not Started is derived only when no live attempt exists and the CURRENT displayed
plan has wholly elapsed. With no supplied `now`, it is not derived. Deleted rows
are excluded from analysis but never removed from a collection. Duplicate IDs
must be merged first, not silently double-counted.

`planSnapshot: null` alone is not evidence of unplanned work. With a missing anchor
the result is `comparable: false`, with no Within Plan/Delayed/Overrun label.
Only an explicit `knownUnplanned: true` option yields Unplanned. This conservative
caller-side distinction adds no field to the agreed record. Persisting richer
unknown-versus-known-absent evidence remains a later contract decision.

The classifier returns progress per attempt; it does not choose a latest attempt
from sync-array order, aggregate a completion percentage, or change native task
completion. Do not compare a group of attempts with different snapshots to an
implicitly selected last snapshot. Select a common anchor explicitly, or compare
each attempt with its own snapshot.

Intervals use CIVIL planner coordinates, independent of the machine's timezone.
This is an explicit implementation choice for the contract's date/time fields,
not a claim of measured UTC duration across DST folds/gaps or timezone travel.
Those cannot be reconstructed from these fields alone. No timezone field,
remaining-effort estimate, automatic default duration, or live-task lookup is
invented here.

## Validation and handoff

`npm test -- src/jobo/core.test.js` runs the standalone Vitest suite.
The suite covers construction, immutable snapshots, edits/tombstones, ordinary
and recurring reopen/re-complete, civil midnight/leap/year boundaries, both plan
anchors, independent labels, unknown plans, late duplicates, nested-key ties,
and picker commutativity/associativity/idempotence.

The fork audit additionally overlays the exact core on pinned #1762 and injects
it into the REAL controller/store for save, hydration, remote apply, reopen,
re-complete, two writers and readonly-fallback scenarios. This is an integration
check against that draft revision, not a claim that its unfinished payload/sync
wiring, backup/restore, native installers, or live providers have been tested.
The audit workflow is separate from this upstream PR.
