# Proposed JOBO capture-safe merge, protocol v2

Status: executable proposal, not installed in the current application. The
existing `pickJoboRecord` and core behavior remain untouched. This requires an
explicit revision of #1744's whole-operand merge contract and coordinated wiring
through #1762 and both sync transports before claiming a live fix.

## Problem and rule

A observes completion promptly and captures the original title and plan. B
observes it after a rename/reschedule, then corrects its actual end time while
offline. V1 chooses B's entire newer row, replacing A's history as a side effect.

V2 uses two independently ordered registers within the same Do identity:

| Register | Contents | Winner |
| --- | --- | --- |
| Capture | `id`, `taskId`, `title`, `planSnapshot`, `source`, `createdAt`, `observedAt` | Earlier `observedAt`; then smaller recursively canonical capture JSON |
| Revision | Actual interval, `progress`, `deleted`, `updatedAt`, and all other opaque extension fields | Newer `updatedAt`; earlier original revision observation; then smaller canonical `{observedAt, value}` JSON |

The revision remains one atomic value: concurrent interval/progress/extension
edits are not combined field by field. A newer revision may overwrite another
concurrent edit under the existing LWW model. Tombstones participate in this
register and are retained; no new delete-wins rule is introduced for exact ties.

Metadata `_joboMerge: {version: 2, revisionObservedAt, revisionKey}` retains the
revision winner's own observation provenance independently of the selected
capture. `revisionKey` is canonical JSON of that revision, not a cryptographic
signature. It deliberately duplicates the revision text to detect unwrapped
local edits that leave stale provenance metadata. Malformed/stale metadata is an
error, never silently repaired. It cannot authenticate hostile input.

Keeping revision provenance is essential: merging A's early capture into B's
late-observed revision must not make B appear to have been observed earlier.
Otherwise a third equal-time revision can win or lose depending on grouping.
Each register is selected by its own total order, so their product is
commutative, associative and idempotent for normalized v2 rows. Raw legacy rows
first undergo the documented deterministic normalization.

`createdAt` can remain in the capture block without creating a backward version:
the selected revision's timestamp is at least every operand's `updatedAt`, which
is at least its own `createdAt`. Core validation is also applied after composition.

## API and local writes

```js
import {
  createCaptureSafeDoRecord,
  upgradeCaptureSafeDoRecord,
  mergeCaptureSafeDoRecords,
  updateCaptureSafeDoRecord,
  tombstoneCaptureSafeDoRecord,
} from './captureMerge.js';
```

Construct v2 rows with `createCaptureSafeDoRecord`; upgrade complete legacy rows
with `upgradeCaptureSafeDoRecord`. Use the v2 update/delete wrappers, which retain
revision provenance and refresh its canonical key. Their patch/timestamp rules
are inherited from core. A wrapper no-op preserves values and timestamps; object
identity is not promised. Uncompletion must also use the v2 update path, rather
than passing v2 records to `reopenDoAttempt` unchanged.

All input and output data is JSON and defensively copied. Existing opaque fields
belong to the atomic revision value and follow its winner. They are not all
unioned: a field absent from the winning revision is absent from the result.
Extensions needing their own conflict behavior require a future schema decision.
`_joboMerge` is reserved; a conflicting legacy extension must be resolved rather
than overwritten.

## Migration and integration gates

1. Agree to a merge result that can be a composite of both operands. Every
   JOBO collision must call this merge, including unequal `updatedAt` values.
   Calling it only on a timestamp tie still loses early history.
2. Upgrade complete existing records through the single coordinated writer.
   Minimal/opaque transport fixtures are not complete historical records and
   are rejected by this proposal. Do not fill missing capture data from today's
   task. Keep unreadable/unmigratable data for recovery and report failure.
3. Use the same merge in ledger commit/hydration/remote apply and file/vault
   tiers. Remove identity-based winner checks and earlier LWW short-circuits.
   Compare canonical full-row values against both inputs: a composite can
   require both local apply and remote push even if `updatedAt` did not change.
   Vault change detection must likewise transmit an equal-timestamp capture
   improvement. Storage, state, payload, backup and restore must retain metadata.
4. Route all creation, interval/progress correction, uncompletion and deletion
   through the v2 APIs. Never strip metadata and reconstruct it from the now
   selected capture; that erases the revision provenance this fix requires.
5. Coordinate writer rollout. A pre-ledger build that omits the collection is
   different from a v1 ledger writer: the latter may discard history, bypass v2
   merging, or write stale metadata. Prevent v1 ledger clients from writing this
   protocol, or provide a separately designed compatibility bridge. This module
   alone does not implement a capability handshake or safe mixed-version sync.
6. Verify real save → state → payload → both transports → disk → reload and
   backup/restore. Test feature-off forwarding, offline arrivals, tombstones,
   duplicate remote apply, equal-timestamp convergence and no push churn.

The pure checks cover the merge and wrappers (11 cases, including an exhaustive
finite set of three-way grouping comparisons):

```sh
node scripts/check-jobo-capture-merge.mjs
```

The separate controller harness accepts the actual controller from #1762:

```sh
node scripts/check-jobo-capture-ledger.mjs /absolute/path/to/ledger.js
```

Six checks passed against the pinned
`964abed1831c3761f84edd94ceb447e494811e80` controller with a strict serialized
in-memory store and JSON copies at storage boundaries. They exercise commit →
state → JSON payload → remote apply → reload; the late B correction with A's early
capture; reverse-order convergence; duplicate/stale replay; retained tombstones;
and a remote apply held until hydration finishes. This validates the real
controller's injected merge path, not the live sync tiers, IndexedDB, React,
backup/restore, or a mixed-version rollout.

Two isolated mutation checks also failed as required: replacing the independent
capture winner with the revision winner's capture, and replacing revision
provenance with the selected capture's observation. Both reproduce concrete
regressions caught by the pure harness.

## Honest limits

The chosen capture is the earliest *reported observation among versions that
arrive*. Device clock skew can make that differ from real chronological order.
An earlier capture arriving late can improve the selected history. This does
not prove the pre-work plan, and cannot reconstruct a capture already lost by
v1 before migration. Capturing trusted plan data at the source event would be a
separate stronger design.

This proposal changes neither duration/overlap rules, checkbox behavior,
progress vocabulary, manual-title corrections nor exact-tie deletion policy.
