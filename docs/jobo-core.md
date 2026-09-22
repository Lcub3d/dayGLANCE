# JOBO pure core (slice 2)

Implements the record-facing part of #1726 against the merged
[jobo-ledger-persistence.md](jobo-ledger-persistence.md) contract (#1744).
This module does not import React, storage, a task store or a sync engine.
It does not obtain the current time or generate IDs. No app surface imports it
until the later slices are wired, so the feature-off experience is unchanged.

The interval, reopen and checkbox decisions below reflect the user's subsequent
product decisions. In particular, reopen now preserves an existing non-completed
assessment, and the checkbox/native-completion question is settled for the fork.
These are updates to the earlier #1744 wording, not claims that its merged design
or the upstream implementation has already changed. See the
[slice 4/5 checkbox contract](jobo-checkbox-contract.md) for the integration handoff.

## API

| Export | Contract |
| --- | --- |
| `createDoRecord(input)` | Returns a full, defensively copied record; invalid input throws `TypeError`. Only `deleted` defaults to `false`. |
| `validateDoRecord(record)` | Returns `{ ok, errors }`, with no repair, clock lookup or migration. |
| `updateDoRecord(record, patch, updatedAt)` | Patches only interval fields and/or progress, never captured identity/title/plan/source/creation/observation data. |
| `tombstoneDoRecord(record, updatedAt)` | Returns a retained `deleted: true` version; repeat deletion is a no-op. |
| `completeDoAttempt(records, input)` | Pure ensure-present by caller-supplied completion ID; otherwise appends a Completed attempt. |
| `reopenDoAttempt(records, previousId, updatedAt)` | Changes a Completed attempt to Partly Completed; preserves Started, Partly Completed and Mostly Completed. Keeps interval and snapshot. Missing or deleted attempts are not recreated. |
| `doDurationMinutes(record)` | Civil-clock minutes, including explicit `endDate`; zero is allowed only for an unmeasured, unplanned completion. |
| `classifyAgainstPlan(plan, records, options)` | Independent timing labels and a per-attempt progress list, with recorded minutes and attempt count. |
| `pickJoboRecord(a, b)` | Returns one whole original operand: newer `updatedAt`, lower `observedAt`, smaller recursively canonical JSON. |

A record has `id`, `taskId`, `date`, `startTime`, `endDate`, `endTime`, `title`,
`planSnapshot`, `source`, `progress`, `createdAt`, `updatedAt`, `observedAt`, and
`deleted`. `taskId` allows a native numeric/string ID or explicit `null`;
`planSnapshot` is a captured timed plan or explicit `null` when there was no
timed plan at capture. Do not use `null` to fill unavailable historical data.
Orphan IDs survive.
JSON extension fields are copied and preserved by edits and by the picker.

`DO_PROGRESS` defines the serialized vocabulary once: `started`, `partial`,
`mostly`, `completed`. The first three retain the prototype spellings;
`completed` follows the merged contract's example. `notStarted` is never a Do
progress value. Prototype JSON migration (including its `complete` spelling)
is outside this slice. `DO_SOURCES` contains `completion`, `manual`, `focus`;
accepting `focus` is not focus-session integration.

Dates must be real Gregorian `YYYY-MM-DD` values and times must be `HH:MM`.
Use next-day `endDate` plus `00:00`, not `24:00`. Intervals must be positive,
except that `source: 'completion'` with `planSnapshot: null` may have identical
start and end coordinates. This zero is a sentinel for duration not recorded,
not evidence that the work took no time. It contributes zero recorded minutes,
but is a live attempt and must not be classified as Not Started. The caller
supplies its coordinates; core does not infer an actual start or a default
duration. Manual, focus and timed-plan records still require positive duration.
No new record field is introduced. ISO timestamps require an explicit
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
core. JOBO's checkbox is now required to complete the native task through the
existing task-completion path in slice 4; this pure module does not perform that
mutation. The integration is pending, as described in the checkbox contract.

## Classification choices and limits

Pass one explicit plan anchor and a caller-selected array of distinct attempts:

```js
classifyAgainstPlan(originalPlan, selectedAttempts);
classifyAgainstPlan(attempt.planSnapshot, [attempt], {
  knownUnplanned: attempt.planSnapshot === null,
});
classifyAgainstPlan(originalPlan, [], {
  displayedPlan: currentPlan,
  now: { date: '2026-09-19', time: '16:00' },
});
```

Timing and progress are independent. Delayed means first actual start after
anchor start OR last actual end after anchor end. Overrun means the union of
recorded intervals is longer than the anchor duration. With neither, Within Plan
applies where the actual timing is comparable. Overlaps count once and gaps do
not count: 09:00–09:20 plus 09:40–10:00 is 40 minutes, while 09:00–09:40 plus
09:20–10:00 is 60 minutes. First start and last end bound the schedule comparison;
their difference is not the recorded work duration.

Zero-duration placeholders supply no measured interval, so they are excluded
from timing bounds. If every live attempt is such a placeholder, no Within Plan,
Delayed or Overrun label is derived, even when another plan anchor is supplied.
A known absent timed plan can still yield Unplanned. In a mixed set, only
positive intervals determine timing; every live attempt contributes to the
attempt count and progress list.

Two or more live records still yield Interrupted independently, even when
adjacent or overlapping. This is the agreed interaction/segmentation cue, not
proof of a real-world interruption. Two identical one-hour records therefore
yield 60 recorded minutes and Interrupted, not an automatic Overrun. Interval
union applies only to the caller-selected attempts; it does not infer a global
daily total or merge distinct record identities.

Not Started is derived only when no live attempt exists and the CURRENT displayed
plan has wholly elapsed. With no supplied `now`, it is not derived. Deleted rows
are excluded from analysis but never removed from a collection. Duplicate IDs
must be merged first, not silently double-counted.
Here Not Started means that the user has not recorded an attempt; it is not
live activity detection. A five-minute recorded attempt may remain Within Plan
and Partly Completed after the plan ends: the passage of time alone does not
make the historical interval delayed. When comparing Original Plan after a
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

The classifier returns progress per attempt; it does not choose a latest attempt
from sync-array order, aggregate a completion percentage, or change native task
completion. Do not compare a group of attempts with different snapshots to an
implicitly selected last snapshot. Select a common anchor explicitly, or compare
each attempt with its own snapshot.

Intervals use CIVIL planner coordinates, independent of the machine's timezone.
This is an explicit implementation choice for the contract's date/time fields,
not a claim of measured UTC duration across DST folds/gaps or timezone travel.
Those cannot be reconstructed from these fields alone. No timezone field,
remaining-effort estimate, invented measured duration, or live-task lookup is
added here.

## Validation and handoff

`npm test -- src/jobo/core.test.js` runs the standalone Vitest suite.
The suite covers construction, immutable snapshots, edits/tombstones, ordinary
and recurring reopen/re-complete, civil midnight/leap/year boundaries, both plan
anchors, independent labels, unknown plans, late duplicates, nested-key ties,
picker commutativity/associativity/idempotence, and legacy timestamp ranks in
independent UTC and Asia/Shanghai processes.

For this behavioral revision, 135 core test cases passed locally using Node's
test runner on a temporary copy whose only runner change was importing
`describe`/`it` from `node:test` instead of `vitest`. This includes the existing
separate UTC and Asia/Shanghai timestamp checks. The committed suite remains a
Vitest suite. Native checkbox integration, full app tests/builds and the real
Vitest runner were not exercised in this local check.

The earlier core baseline was separately audited against the real controller
and store from a pinned #1762 revision, including save, hydration, remote apply,
reopen/re-complete, two writers and readonly fallback. That historical audit
does not establish integration coverage for these new behavioral rules. The
updated checkbox contract lists the remaining integration acceptance checks.
