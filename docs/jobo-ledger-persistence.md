# JOBO ledger: persistence and merge

Design for slice 3 of #1726. This is the slice that decides where Do records
live, how they reach React state, how both sync tiers carry them, and what
backup, restore and reset do with them. It is written before any code because
it is the slice that is hardest to change later, and because two people are
building against it: the pure rules in `src/jobo/core.js` are slice 2 and are
@Lcub3d's; the view is slice 5. Nothing here draws anything.

Revised after three rounds of @Lcub3d's review on #1744. The first tightened
the record contract, the identity rule and the storage failure semantics; the
second closed a recurring-identity collision, replaced a convergence claim
with a convergence rule, and removed a recovery promise the localStorage
fallback could not keep; the third removed the sync horizon from the
file-tier merge. Those revisions are marked where they changed a decision.

The short version: **the ledger is a collection, not a task field and not a
cache.** Each Do record is its own row with its own timestamp, stored in
IndexedDB, mirrored into React state, registered with the sync layer as one
more collection kind, and carried by every device whether or not that device
has JOBO switched on.

## What this slice must guarantee

Four invariants, each of which has already been violated once by something
smaller than a ledger and cost real data.

1. **A Do record never changes the plan.** The task's `date`, `startTime` and
   `duration` are the plan. Recording what happened writes a record and
   nothing else.
2. **A record captures once, then preserves.** Its `title` and `planSnapshot`
   are copied at creation and never refreshed from the live task: not by a
   progress edit, not by an interval correction, not by persistence, not by a
   remote apply. Renaming, rescheduling or deleting the task never rewrites
   its history. (Sharpened from "each record carries a snapshot" after
   review; the important half is the second word.)
3. **The flag gates the interface, never the data.** A device with
   `joboEnabled` off still loads, stores, pushes, pulls and merges records.
   It only declines to show them, and does not create records from its own
   completions. Otherwise the first sync from a device with the flag off
   would push a payload without the collection.
4. **Records reach React state, not only storage.** `buildSyncPayload` reads
   state; `applyEngineData` writes state. `originalPlan` shipped once written
   to localStorage and never to state, and could not survive a single sync
   cycle. See "Adding a field to a task" in `CLAUDE.md`, whose fourth
   question is this one.

## The record

The revised split proposed by Slice 2: **core owns the complete Do record
shape and snapshot semantics; Plan owns completion; the hook and storage layer
own coordinated durable writes; sync merges Do records without rebuilding them
from today's task.** This is an explicit revision to the merged #1744 record
contract, which previously placed progress on Do.

So `title` and `planSnapshot` are part of the core record, not something the
hook adds. Core constructs and validates a record from ordinary inputs (the
caller supplies the title, the copied plan values, the id and the timestamps)
without reading React state, storage or the clock. The fields the sync and
storage layers depend on, and ask core to keep fixed:

```js
{
  id: 'do:…',              // stable for the record's whole life; see "Identity"
  taskId: 't1',            // the task this attempt was against, or null for an
                           //   unlinked manual Do; may also be an id that no
                           //   longer resolves (see "Orphans")
  timing: 'timed',         // 'timed' | 'untimed'
  date: '2026-09-19',      // execution day
  startTime: '14:30',      // null for untimed
  endDate: '2026-09-19',   // null for untimed; explicit across midnight
  endTime: '15:10',        // null for untimed
  title: 'Draft the report',   // captured once; the record reads on its own
  planSnapshot: {          // the plan as observed when the record was made,
    date: '2026-09-19', startTime: '14:30', duration: 60,
  },                       //   or null when there was no timed plan
  source: 'completion',    // 'completion' | 'manual' | 'focus' | …; core's list
  createdAt: '2026-09-19T15:10:02.000Z',
  updatedAt: '2026-09-19T15:10:02.000Z',   // the LWW key; see "Identity" for
                                           //   what the initial value anchors to
  observedAt: '2026-09-19T15:10:02.418Z',  // this device's clock when it made
                                           //   the record; the tie-break, and
                                           //   nothing else; see "Identity"
  deleted: false,          // soft tombstone; see "Deletion"
}
```

`updatedAt` and `observedAt` are the only fields the sync layer reads, and
`observedAt` only to break an exact tie on `updatedAt`. Everything else
passes through opaque, which is what lets core change its mind about
classification without touching persistence.

Two pre-existing nullables remain: `taskId: null` is a manual Do with no task
behind it; `planSnapshot: null` means there genuinely was no timed plan to
copy. In addition, Untimed Do uses explicit null interval coordinates
(`startTime`, `endDate`, `endTime`) under `timing: 'untimed'`. Those
nulls mean "execution happened, duration unmeasured", never zero minutes. An
unavailable historical snapshot is not the same as "unplanned", and the hook
must never manufacture one from today's task to fill the gap.

**What the snapshot is, honestly.** A detector that runs on completion
captures the plan as it stands at completion. It cannot prove what the plan
was when work began if the plan changed in between. Where an earlier event
supplies a reliable baseline (a recording started before completion, a focus
session) the hook passes that plan in; otherwise the snapshot is the
completion-time plan and the doc says so rather than promising history that
was not captured. `originalPlan` on the task remains the Original Plan; the
snapshot is the best available Final Plan, not a guaranteed one.

Plan-change counting stays on the task/Plan side, not on Do. Slice 2 defines
`planRevisionCount` plus `lastPlanRevisionAt` as write-time metadata for
effective changes to `date / startTime / duration`. The default coalescing
window is 5 minutes: edits separated by at most 5 minutes stay in one revision
session; a larger gap opens another. Changing that threshold later affects only
future writes and never recomputes existing counts. This metric is deliberately
separate from `rescheduleCount` or any overdue-deferral counter.

**Completion is not a Do field.** Plan owns the ordinal completion assessment:
`started / partly / mostly / completed`. "Not started" is still derived from
time when no Do exists, the current displayed Plan has wholly elapsed, and
there is no explicit Plan completion assessment.

A native completion appends one Do. With a known positive actual/retrospective
interval it is Timed; with known execution but unmeasured duration it is
Untimed. Zero minutes is never used as an "unknown" sentinel. Un-completing
does not mutate a historical Do record. A later execution is a new attempt
under a new identity.

Legacy prototype/#1744 rows that still contain `progress` cross an explicit
`migrateLegacyDoRecord()` boundary **before merge**: Core returns a progress-free
canonical Do plus a separate legacy completion value for the caller to attach to
the correct identified Plan if appropriate. Once migrated, normal merge applies
without any schema-specific tie-break.

## Where it lives, and the two homes rejected

**On the task, like `originalPlan`.** Rejected. A task can have many attempts,
so this is unbounded per task; every attempt rides every sync of that task
forever; both transports do whole-entity last-writer-wins, so a device that
recorded attempt B while another recorded attempt A keeps only one of them.
And every task field is another chance at the resurrection hazard in
`normalizeField`. The whole point of this design is that **the task gains no
field.**

**A single IndexedDB blob, like the Todoist cache.** Rejected as the merge
unit, kept as the storage medium. The Todoist cache is derived data: losing
it costs a re-sync. The ledger is original user data. A single value merges
as a single value, so two devices each holding a different attempt would
overwrite each other's whole ledger.

**A collection kind in the sync layer.** Chosen. `src/sync/dbAdapter.js`
already defines exactly this shape:

```js
export const COLLECTION_KINDS = {
  tasks:  { idField: 'id', tsField: 'lastModified' },
  goals:  { idField: 'id', tsField: 'updatedAt'    },
  …
};
```

Adding `joboRecords: { idField: 'id', tsField: 'updatedAt' }` gives the vault
tier per-record last-writer-wins, `shredState` and `reassembleState` pick the
collection up without further changes, and the file tier's `mergeArrayById`
does the same for the JSON payload. Records are small (roughly 200 bytes),
append-mostly, and distinct attempts have distinct ids, so two devices
recording different attempts never collide.

### Storage medium: IndexedDB, with a stricter door than the cache uses

The database is `dayglance-jobo`, opened through the same machinery as
`src/utils/idbKeyValue.js`, holding the array under one key, with the
localStorage fallback for platforms where IndexedDB will not open.

But the ledger cannot use `createIdbKeyValue`'s methods as they are, and
review is what made that concrete. That helper is built for caches: every
method resolves rather than rejects, `get()` falls through to the
localStorage fallback when the IndexedDB read fails (so a broken read can
come back as a stale or absent fallback value and look clean), and `set()`
returns `false` when both paths fail rather than throwing. For a cache, "no
value" is always the safe answer. For original user data it is the dangerous
one: **an unreadable ledger must never become an authoritative `[]`.**

So the ledger gets its own store module, `src/jobo/store.js`, sharing the
open-database plumbing but with three differences:

- **A strict read.** `read()` resolves to `{ ok: true, value }` or
  `{ ok: false }`. Absent is `{ ok: true, value: undefined }`. A failed
  IndexedDB read is `ok: false`, full stop; it does not consult the fallback,
  because a fallback value is not the ledger. The hook treats `ok: false` as
  "not loaded" (see "Lifecycle"), never as empty.
- **A checked write.** Every write resolves to `{ ok, value }` and the hook
  acknowledges a save, or reloads after a restore, only on `ok: true`.
- **An atomic update.** `update(fn)` runs read → `fn(current)` → put inside
  **one** readwrite transaction, then resolves with the committed value.
  IndexedDB serializes readwrite transactions on a store, so two tabs that
  both try to append see each other's record. Separate `get()` and `set()`
  calls do not give that guarantee: both tabs read `[A]`, one writes
  `[A, B]`, the other writes `[A, C]`, and B is gone before sync could merge
  it. `fn` is always a merge by id, never a replace.

The localStorage fallback has no cross-tab transaction, and, from the second
review round, the first draft's claim that a record lost in that window is
"picked up on the next read" was wrong: if two tabs both read `[A]` and write
`[A, B]` and `[A, C]`, B exists only in one tab's memory, and if that tab
closes before it syncs, B is gone. That is loss, not staleness. So the
fallback does not get a weaker version of the guarantee; it gets a
coordinated one or none:

- **With Web Locks** (`navigator.locks`, which `useTodoistSync` already takes
  around its writes), `update(fn)` runs read → merge by id → write while
  holding an exclusive lock named for the key. The lock is cross-tab, so the
  fallback then has the same append guarantee as the IndexedDB path.
- **Without Web Locks the ledger is read-only on that device.** The store
  reports `writable: false`, the hook refuses local mutations with a visible
  reason, and records that arrive by sync are still merged into state (but
  not written) so the device is not blind, only silent. The
  `writeLockUnavailable` error in `useTodoistSync` is the same policy for the
  same reason.

No configuration of the fallback is allowed to lose a record and call it
recoverable.

Why not localStorage as the primary, where tasks live: the ledger grows for
as long as the app is used. At ten records a day it is roughly half a
megabyte a year, and localStorage is capped near five megabytes for the whole
origin, of which a real install already used three before #1629 and #1630
relieved it. This is the shape of data #1627 exists for.

## Lifecycle: reaching React state

A hook, `src/hooks/useJoboLedger.js`, owns `joboRecords` as React state and
is the only writer. Slice 4's detector, slice 5's manual entry and any later
importer all go through it.

- **Load.** On mount, one strict read. `ok: true` sets state and `loaded`.
  `ok: false` leaves `loaded` false: the ledger is unreadable, and the hook
  says so rather than pretending it is empty.
- **Not loaded is not empty.** While `loaded` is false, `buildSyncPayload`
  omits the `joboRecords` key entirely. `undefined` means "this device has
  not loaded its ledger"; `[]` means "this device's ledger is empty". Both
  tiers already distinguish an absent bundle from an empty one for other
  data, and the vault tier treats absent as "does not carry it", never as a
  delete.
- **Applies during load are held.** A remote apply that arrives before
  `loaded` is queued and merged after hydration. Merging it into the stale
  initial state and then loading over it would drop it.
- **Every mutation** goes through `update(fn)` and the hook refreshes state
  from the committed value, not from what it intended to write. A record in
  state that is not on disk is exactly what a crash loses.
- **Remote apply preserves incoming timestamps.** `applyEngineData` writes
  the merged collection to state and to disk without touching any record's
  `updatedAt`. Under the remote-apply window (`suppressTimestampRef`,
  `applyingRemoteDataRef`) the hook writes as an apply, not an edit.

## Both sync tiers

Both tiers pick between two copies of one record with **the same function**,
`pickJoboRecord(a, b)`, exported by core and shared the way
`mergeCompletedDates` is shared today. It is: newer `updatedAt` wins; on an exact
tie, lower `observedAt` wins; on a tie there too, the smaller canonical JSON
wins. The rule is deliberately schema-agnostic. Legacy progress-bearing rows
must be migrated before they enter canonical merge. The picker contains no
migration policy. Order-independent and idempotent, so either tier may apply it
twice and in either order. Why a shared rule rather than each tier's own LWW: both
tiers today resolve an exact timestamp tie as "remote wins" (`>=` in
`dbAdapter.js` and in the file-tier merge). For tasks that is harmless,
because two devices almost never share a `lastModified`. For ledger records
it is the normal case (see "Identity"), and "remote wins" is order-dependent:
device A would keep B's copy and device B would keep A's, and they would never
converge.

**Vault tier (`src/sync/dbAdapter.js`).** One line in `COLLECTION_KINDS`,
plus the pick hook, the way recurring templates already get a custom apply.
No sticky-field carry is needed, because the record is the unit: a newer copy
of a record is a newer copy of that record, not a task that might be missing
a field. The cross-list reconciliation for `TASK_KINDS` does not apply; a
record never moves between kinds.

**File tier (`src/mergeSync.js`).** In `mergeSyncData`, merge `joboRecords`
with `mergeArrayById(local, remote, {}, null, { timestampField: 'updatedAt' })`,
with the pick rule supplied for the tie, and set `localChanged` and
`remoteChanged` on the same contract the habit-log merge uses: when the pick
replaces the local copy, raise `localChanged`; when it replaces the remote
copy, raise `remoteChanged`; when the two copies are equal, raise neither. A
merge that changes the data without the matching flag never applies or never
pushes on that device, so it fails to converge; a merge that raises a flag
without changing the data is the push churn the `archived` field once
caused, and this collection has no fields for the persist pass to restamp,
so the flags are the only place that churn could come from. **The fourth
argument is `null`, never the sync horizon.** (From the third review round;
the first draft passed the horizon the way `mergeTaskArrays` does.) That
helper drops any local-only row whose timestamp is older than the remote's
`tombstonePrunedBefore`, on the theory that its tombstone was pruned and the
row is a zombie. The theory holds for tasks, whose tombstones live in a map
that is pruned at sixty days. It is wrong for the ledger twice over: the
ledger's tombstones are rows that are never pruned (see "Deletion"), so a
returning stale copy is caught by the row itself and no horizon is needed;
and with the horizon in place, a device that had been offline past the
window, or a merge against a payload from a build that predates the
collection (`remote` absent, so every local row is local-only), would
silently drop every Do record and every tombstone older than sixty days.
`areas` already passes `null` here for the same reason. The regression is
scenario 3.

**A device that predates the collection.** An older build drops the key from
its payload. The vault tier treats an absent bundle as "this device does not
carry it"; the file-tier merge keeps the side that has it. Both are covered
by the test plan.

## Identity, and idempotent creation

Two devices can observe the same completion. Both run the detector. With
random ids that is two records for one attempt. So a record the detector
creates has a **deterministic id**, and, from review, creation is
**ensure-present rather than write**. The rules together:

- **Key.** `do:${taskId}:${completedAt}` for an ordinary task, where
  `completedAt` is the task's own completion stamp. Every completion path
  stamps it (`applySetCompletion` in `src/utils/taskMutations.js`, both
  branches of `toggleComplete` in `src/hooks/useTaskActions.js`), so it is
  a source-event timestamp both devices already agree on. For a recurring
  instance, `do:${templateId}:${instanceDate}:${stamp}`, where `stamp` is
  `completedDatesTimestamps[instanceDate]` from the snapshot in which the
  date is present. (Changed in the second review round: the first draft keyed
  on template id and instance date alone, and that collides with the attempt
  rule below, because completing the same occurrence again after a reopen
  would produce the same key, ensure-present would do nothing, and there
  would be no second attempt. Every current completion path writes the stamp:
  both branches of the recurring `toggleComplete`, `applySetCompletion`, and
  the Obsidian bridge.) The instance date is still the record's `date`. A key
  must never be built from a device's current time; that would defeat the
  point.
- **Legacy recurring rule.** A completion observed with no stamp for its date
  keys on `do:${templateId}:${instanceDate}` and that id is permanent. A
  stamp appearing later for an existing record is not a presence transition,
  so nothing re-keys, and no missing attempt is ever reconstructed from the
  observing device's clock. In practice this case is confined to data that
  predates the stamps, which never produces a transition anyway.
- **Ensure-present.** Re-observing a completion whose record already exists
  is a no-op. It does not rewrite the record and does not bump `updatedAt`.
  Otherwise a late detector, holding the right id, would overwrite an interval
  correction or a tombstone.
- **The initial `updatedAt` is anchored to the source event**, not to when
  the detector happened to run. Any later user edit or tombstone, with a
  later `updatedAt`, then wins over any re-observation.
- **Same id and version does not mean same content, so there is a
  convergence rule.** (From the second review round; the first draft claimed
  the two initial records would be byte-identical, and they need not be.) A
  device that learns of the completion late, through a remote apply, snapshots
  the task as it stands then, after any rename or reschedule, under the same
  id and the same anchored `updatedAt`. The detector cannot tell a local edge
  from a remote-applied one (the hold in `useCompletionLog` mixes them on
  purpose), so "the local observer wins" is not available. The rule is
  `pickJoboRecord` under "Both sync tiers": on an exact `updatedAt` tie the
  lower `observedAt` wins, the earlier observer being the one closest to the
  event. This establishes convergence, not proof that the chosen snapshot is
  the pre-work plan; the snapshot paragraph under "The record" already says
  what is promised there. Pristine records tie; any user edit breaks the tie
  on `updatedAt` and the rule never runs.
- **Un-completing does not mutate Do history.** The native task follows its
  normal reopen path. Any completion reassessment belongs to Plan state.
  Historical Do intervals stay unchanged.
- **A later recorded execution is a new key.** Editing a record's interval
  never changes its id.
- **Manual and focus records** get generated ids, created once before the
  write so that a retry reuses the same id rather than minting a second.

## Deletion

Records are rarely deleted (an undo, a correction). When they are, the row
gets `deleted: true` and a bumped `updatedAt`, and stays in the collection.
Per-record last-writer-wins propagates the deletion the same way it
propagates an edit, with no new tombstone bundle and no entry in the
`day-planner-deleted-task-ids` map, which is for tasks.

**Soft-deleted rows are never pruned.** Review asked what protects the
ledger from a stale device returning after the fixed tombstone window with
an old live copy. For tasks the file tier has `syncHorizon` (a local-only
item older than `tombstonePrunedBefore` is dropped as a presumed zombie), but
the vault tier is grow-only and would accept the old row. Rather than depend
on horizon logic on one tier and nothing on the other, the ledger keeps its
tombstones, and opts out of the horizon on the file tier, since the horizon
would drop the very tombstones that make this work (see "Both sync tiers"). A tombstone row is about a hundred bytes, deletions are rare, and
a kept tombstone is what makes a returning stale copy lose on `updatedAt`
under every transport, at any age. The collection stays bounded by use.

## Orphans

A record whose `taskId` no longer resolves is kept. The prototype's rule is
right: a Do that happened is history, and history does not depend on the plan
surviving. The record carries `title` and `planSnapshot`, captured once, so it
reads on its own. A task restored from the recycle bin relinks by id with no
work.

## Backup, restore, reset

**Backup.** The export in `src/App.jsx` gains `joboRecords`. It is user data
and belongs in every backup the app makes, folder and file alike.

**Restore.** Every restore path (`restoreFromBackupFolder`, restore from file,
the cloud restore at `applyEngineData`'s call sites) writes the collection
through the checked write **and reloads only on `ok: true`.**
`resetVaultSyncCursor` notes that the snapshot's IndexedDB delete is not
awaited because it races the unload and the snapshot was keyed to make the
race harmless. The ledger has no such key; a restore that reloads before the
write lands, or after a write that failed, restores an empty or stale ledger.

**Reset.** `KNOWN_INDEXEDDB_NAMES` in `src/utils/resetAppData.js` gains
`'dayglance-jobo'`. Since #1745 a test scans `src/` for every database name
the app opens and fails when the list does not know one, so forgetting this
is a red test rather than a store that outlives a reset on iOS.

**Todoist and Obsidian.** Untouched. Records never leave the app in this
slice. An Obsidian archive of Do intervals is the open question from #1623,
which @Lcub3d answered as "optional, later, and never a second source of
truth"; nothing here forecloses it.

## What is out of scope

- Plan completion persistence/integration and rendering. Slice 2 defines its
  vocabulary and comparison contract; this ledger stores Do execution rows.
- Creating records from completions (slice 4), which depends on the identity
  rules above and on the hook being the only writer.
- Any rendering (slice 5), including the history popover learning about Do.
- Import of the prototype's JSON ledger. Worth doing, and small, once the
  record shape is final; not before.

## Testing

Per `CLAUDE.md`: assert where the app reads it, not that a function returned
it, and mutation-check every guard. Each scenario walks the whole path
rather than unit-testing a module. The five from review are folded in.

1. **save → state → push → apply.** Record through the hook; assert it is in
   state; build the payload and assert it is in `data.joboRecords`; merge
   against a newer remote copy of an unrelated task; apply; assert it is
   still in state and on disk.
2. **A device with the flag off forwards records.** `joboEnabled: false`,
   records present on disk; assert they load, appear in the payload, and
   survive an apply.
3. **A device that predates the collection does not delete it, and neither
   does the horizon.** A payload without the key merges against one with it;
   the records survive on both tiers. Then, on the file tier, a local-only
   live record and a local-only tombstone both older than the remote's
   `tombstonePrunedBefore` merge against a remote that lacks them; assert
   both survive, and that the tombstone still beats a stale live copy of the
   same id arriving afterwards.
4. **Same completion, two devices, one record.** Two hooks observe the same
   completion; assert one record with the source-anchored `updatedAt`. Then
   a user edit on one device, followed by a delayed re-observation on the
   other; assert the edit survives. Then a deletion, followed by a delayed
   re-observation; assert the tombstone survives. Then the convergence case:
   two candidates with the same id and `updatedAt` but different `title` and
   `planSnapshot`, merged in both orders through both transports; assert all
   four results are the same record, the one with the lower `observedAt`.
5. **Complete, reopen, re-complete.** Assert reopening does not mutate the
   first Do interval/snapshot/version; if later execution is recorded, assert
   it is a new row under a new key. Run it for an ordinary task and for the
   same recurring occurrence, where the later completion carries a new stamp.
   A delayed duplicate observation of the first event must still change
   nothing.
6. **Frozen title and plan.** Rename and reschedule the task after the
   record exists, then edit the record's interval; assert `title` and
   `planSnapshot` are unchanged throughout.
7. **Two tabs append different records.** Two stores over the same database
   append concurrently; assert both records are on disk. Repeat over the
   localStorage fallback with Web Locks present; assert the same. Repeat with
   neither IndexedDB nor Web Locks; assert the store reports `writable:
   false` and the append is refused rather than lost.
8. **Remote apply during initial load.** An apply arrives before the load
   resolves; assert it is merged after hydration, not lost.
9. **Failures are not success.** A failed read leaves `loaded` false and the
   payload without the key; a failed write is not acknowledged; a failed
   restore write does not reload; at no point is an empty ledger published
   in place of an unreadable one.
10. **Unlinked, unplanned and untimed.** A manual Do with `taskId: null` and
    `planSnapshot: null` round-trips both tiers intact in both Timed and
    Untimed forms; a cross-midnight Timed interval keeps its `endDate`, while
    Untimed preserves explicit null interval coordinates. Zero-duration
    sentinels are rejected/migrated before canonical persistence.
11. **Restore then reload keeps the ledger.** Restore with a checked write;
    construct a fresh hook over the same store; assert the records are there.

Mutation checks: remove the `COLLECTION_KINDS` entry (1 fails at apply);
remove the flag-independence (2 fails); pass the sync horizon to the
file-tier merge (3 loses the old record and the old tombstone); replace the deterministic id with a
random one (4 yields two records); let re-observation write instead of
ensure-present (4's edit is overwritten); drop the `observedAt` tie-break and
let each tier's own tie rule run (4's convergence case ends with a different
record on each device); key recurring records on instance date alone (5's
recurring re-complete yields no second attempt); refresh the snapshot from
the live task on edit (6 fails); replace `update(fn)` with separate get and
set (7 loses a record); let the fallback write without a lock (7's fallback
case loses a record, or its lockless case writes); return `[]` from a failed
read (9 fails); drop the checked restore write (11 fails).

## Files this touches

| File | Change |
| --- | --- |
| `src/jobo/core.js` | consumed: the record constructor; exported: `pickJoboRecord`, the shared merge rule |
| `src/jobo/store.js` | new: strict read, checked write, atomic `update(fn)`, over the shared IndexedDB plumbing; Web Lock or read-only on the fallback |
| `src/hooks/useJoboLedger.js` | new: state, load, held applies, write-through, the only writer |
| `src/sync/dbAdapter.js` | `joboRecords` in `COLLECTION_KINDS`, picking with `pickJoboRecord` |
| `src/mergeSync.js` | merge `joboRecords` by `updatedAt`, picking with `pickJoboRecord`, horizon `null` |
| `src/App.jsx` | `buildSyncPayload` includes it; `applyEngineData` writes it back; backup export and every restore path |
| `src/utils/resetAppData.js` | `'dayglance-jobo'` in `KNOWN_INDEXEDDB_NAMES` |
| `CLAUDE.md` | a short section: the ledger is a collection; the hook is the only writer; the flag gates UI not data; never prune ledger tombstones |

Slice 3 consumes the record constructor and `pickJoboRecord`. The exact record
contract must be updated to this progress-free shape before #1762 is merged;
otherwise strict Core validation and the persistence design disagree.

## Resolved after review

The fork-local Slice 2 refinement keeps `title` and `planSnapshot` in core,
captured once and preserved, but revises #1744 by removing Do progress entirely.
Plan owns completion; legacy progress-bearing rows require explicit migration.
The other changes from review are the strict store, ensure-present creation with
source-anchored timestamps, held applies during load, `endDate`, the two
nullables, and keeping tombstones forever.

The second round settled three more. Recurring records key on the
occurrence's completion stamp as well as its date, so a reopened occurrence
completed again is a new attempt. Equal ids and versions converge by a shared
tie-break on `observedAt` rather than by a claim that they are identical, and
the tie-break is the same function under both transports because each tier's
own tie rule is order-dependent. The localStorage fallback takes a Web Lock
where one exists and is read-only where none does, in place of a recovery
promise it could not keep.

The third round caught one more: the file-tier merge must not be given the
sync horizon, which would drop old local-only rows, tombstones included, on
an offline device or against an older build's payload. The collection design
itself is unchanged.
