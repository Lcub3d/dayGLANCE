# JOBO ledger: persistence and merge

Design for slice 3 of #1726. This is the slice that decides where Do records
live, how they reach React state, how both sync tiers carry them, and what
backup, restore and reset do with them. It is written before any code because
it is the slice that is hardest to change later, and because two people are
building against it: the pure rules in `src/jobo/core.js` are slice 2 and are
@Lcub3d's; the view is slice 5. Nothing here draws anything.

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
   nothing else. (From the #1623 discussion of Final Plan versus Do.)
2. **Each record carries a snapshot of the plan it was recorded against.**
   That snapshot is the Final Plan, and it is what survives the plan block
   being tidied afterwards. It lives in the record, so the task gains no field.
3. **The flag gates the interface, never the data.** A device with
   `joboEnabled` off still loads, stores, pushes, pulls and merges records.
   It only declines to show them. Otherwise the first sync from a device with
   the flag off would push a payload without the collection and the vault
   would treat that as deletion.
4. **Records reach React state, not only storage.** `buildSyncPayload` reads
   state; `applyEngineData` writes state; `preserveStickyFields` reads state.
   `originalPlan` shipped once written to localStorage and never to state, and
   could not survive a single sync cycle. See "Adding a field to a task" in
   `CLAUDE.md`, whose fourth question is this one.

## The record

Slice 2 owns the fields that express progress and classification. This slice
needs only the following to be present and stable, and asks slice 2 to treat
them as fixed:

```js
{
  id: 'do:…',              // stable; see "Identity" below
  taskId: 't1',            // the task this attempt was against; may be an id
                           //   that no longer exists (see "Orphans")
  date: '2026-09-19',      // the day the interval falls on
  startTime: '14:30',
  endTime: '15:10',
  planSnapshot: {          // invariant 2: the Final Plan, frozen at recording
    date: '2026-09-19', startTime: '14:30', duration: 60,
  },
  title: 'Draft the report',   // so the record reads on its own if the task goes
  source: 'completion',    // 'completion' | 'manual' | 'focus' | …; slice 2 may add
  progress: 'completed',   // slice 2's vocabulary
  createdAt: '2026-09-19T15:10:02.000Z',
  updatedAt: '2026-09-19T15:10:02.000Z',   // the LWW key; bumped on every edit
  deleted: false,          // soft tombstone; see "Deletion"
}
```

`updatedAt` is the only field the sync layer reads. Everything else passes
through opaque, which is what lets slice 2 change its mind about
classification without touching persistence.

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

### Storage medium: IndexedDB, through the existing door

`createIdbKeyValue('dayglance-jobo')` from `src/utils/idbKeyValue.js`, holding
the array under one key, the way `src/todoist/client.js` holds its cache. The
helper's localStorage fallback is automatic where IndexedDB will not open, so
the behaviour is identical everywhere and only the space ceiling differs.

Why not localStorage, where tasks live: the ledger grows for as long as the
app is used. At ten records a day it is roughly half a megabyte a year, and
localStorage is capped near five megabytes for the whole origin, of which a
real install already used three before #1629 and #1630 relieved it. This is
the shape of data #1627 exists for.

IndexedDB is asynchronous, which is the one cost. The Todoist hook already
pays it: `useTodoistSync` awaits `readAccountState` at mount and gates on a
loaded flag. The ledger hook does the same, and nothing that reads records
runs before the flag is set. In particular the first sync cycle must not push
an empty collection because the load has not finished; the payload builder
reads state, and state is empty until loaded, so the hook has to hold the
collection out of the payload (undefined, not `[]`) until then. **An
undefined collection means "not loaded"; an empty array means "empty".** Both
tiers already distinguish absent from empty for other bundles.

## Reaching React state

A hook, `src/hooks/useJoboLedger.js`, owns `joboRecords` as React state:

- On mount, load from IndexedDB once, then set `loaded`.
- Every mutation goes through the hook and writes through to IndexedDB. The
  write is awaited before the hook reports success, because a record written
  to state and not yet to disk is exactly what a crash loses.
- `buildSyncPayload` (`src/App.jsx`) includes `joboRecords` from state, or
  omits the key entirely while `loaded` is false.
- `applyEngineData` writes the merged collection back to state **and** to
  IndexedDB. Writing state alone repeats the `originalPlan` failure in the
  other direction: the vault's records arrive, render, and are gone on
  reload.

The hook is the only writer. The detector in slice 4, manual entry in slice 5
and any later importer all go through it.

## Both sync tiers

**Vault tier (`src/sync/dbAdapter.js`).** One line in `COLLECTION_KINDS`. Per-
record last-writer-wins on `updatedAt`. No sticky-field carry is needed,
because the record is the unit: a newer copy of a record is a newer copy of
that record, not a task that might be missing a field. The cross-list
reconciliation for `TASK_KINDS` does not apply; a record never moves between
kinds.

**File tier (`src/mergeSync.js`).** In `mergeSyncData`, merge `joboRecords`
with `mergeArrayById(local, remote, {}, horizon, { timestampField: 'updatedAt' })`,
the same call `mergeTaskArrays` wraps. Set `localChanged` and `remoteChanged`
on the same contract the habit-log merge uses.

**The remote-apply window.** `applyEngineData` sets `suppressTimestampRef` and
`applyingRemoteDataRef` while it writes. The ledger hook must treat writes
that happen inside that window as applies, not edits: it does not bump
`updatedAt`, and slice 4's detector must not observe the resulting state
change as a local completion. The completion log's planner defers exactly
this case; the ledger follows it.

### The flag does not gate data

Restating invariant 3 where it bites. The hook loads, persists and exposes
records regardless of `joboEnabled`. `buildSyncPayload` includes them
regardless. `applyEngineData` merges them regardless. The flag is read by the
view and by slice 4's detector (a device with JOBO off does not create Do
records from its own completions, but forwards everyone else's). A device
that has never heard of the collection, running an older build, drops the key
from its payload; the vault tier treats an absent bundle as "this device does
not carry it" rather than "delete", which is the existing behaviour for every
bundle added since the tier shipped, and the file-tier merge keeps the side
that has it. Both are covered by the test plan below.

## Identity, and why it matters for slice 4

Two devices can observe the same completion. Both run the detector. Both
create a record. With random ids that is two records for one attempt, and no
merge rule can tell them apart afterwards.

So a record the detector creates has a **deterministic id**:
`do:${taskId}:${completedAt}`, where `completedAt` is the task's own completion
timestamp, which both devices already agree on because it is on the task.
Two devices then create the same id, and last-writer-wins collapses them. This
is the same trick `useCompletionLog` uses: its entries are deterministic, so a
second device logging the same completion is a no-op.

Un-completing uses the same id: the record is kept, `progress` drops to the
partial state, `updatedAt` bumps. A record is never deleted by an uncheck.

Manual and focus records get random ids; they are created on one device by
definition.

## Deletion

Records are rarely deleted (an undo, a correction). When they are, the row
gets `deleted: true` and a bumped `updatedAt`, and stays in the collection. Per-
record last-writer-wins then propagates the deletion the same way it
propagates an edit, with no new tombstone bundle and no new entry in the
`day-planner-deleted-task-ids` map, which is for tasks. Soft-deleted rows are
pruned after the fixed tombstone window in `src/sync/tombstoneRetention.js`,
by every writer, so the collection stays bounded by use rather than by
history.

## Orphans

A record whose `taskId` no longer resolves is kept. The prototype's rule is
right: a Do that happened is history, and history does not depend on the plan
surviving. The record carries `title` and `planSnapshot` so it reads on its
own. A task restored from the recycle bin relinks by id with no work.

## Backup, restore, reset

**Backup.** The export in `src/App.jsx` gains `joboRecords`. It is user data
and belongs in every backup the app makes, folder and file alike.

**Restore.** Every restore path (`restoreFromBackupFolder`, restore from file,
the cloud restore at `applyEngineData`'s call sites) writes the collection to
IndexedDB **and awaits the write before reloading.** `resetVaultSyncCursor`
notes that the snapshot's IndexedDB delete is not awaited because it races the
unload and the snapshot was keyed to make the race harmless. The ledger has
no such key; a restore that reloads before the write lands restores an empty
ledger. Await it.

**Reset.** `KNOWN_INDEXEDDB_NAMES` in `src/utils/resetAppData.js` gains
`'dayglance-jobo'`, so a full reset on iOS, where `indexedDB.databases()` is
unavailable, deletes it. (While reading that list: it does not include
`'dayglance-todoist'` either, so the Todoist cache currently survives a reset
on iOS. Pre-existing and unrelated; a one-line fix.)

**Todoist and Obsidian.** Untouched. Records never leave the app in this
slice. An Obsidian archive of Do intervals is the open question from #1623,
which @Lcub3d answered as "optional, later, and never a second source of
truth"; nothing here forecloses it.

## What is out of scope

- The fields that express progress and classification (slice 2).
- Creating records from completions (slice 4), which depends on the identity
  rule above and on the hook being the only writer.
- Any rendering (slice 5), including the history popover learning about Do.
- Import of the prototype's JSON ledger. Worth doing, and small, once the
  record shape is final; not before.

## Testing

Per `CLAUDE.md`: assert where the app reads it, not that a function returned
it, and mutation-check every guard. The scenarios, each as one test that walks
the whole path rather than a unit test per module:

1. **save → state → push → apply.** Record through the hook; assert it is in
   state; build the payload and assert it is in `data.joboRecords`; merge
   against a newer remote copy of an unrelated task; apply; assert it is still
   in state and in IndexedDB.
2. **A device with the flag off forwards records.** `joboEnabled: false`,
   records present in IndexedDB; assert they load, appear in the payload, and
   survive an apply.
3. **A device that predates the collection does not delete it.** A payload
   without the key merges against one with it; the records survive on both
   tiers.
4. **Same completion, two devices, one record.** Two hooks create a record with
   the same deterministic id; merge; assert one record, newest `updatedAt`.
5. **Un-complete keeps the record.** Assert the record remains with partial
   progress after the task is unchecked.
6. **Restore then reload keeps the ledger.** Restore with an awaited write;
   simulate reload by constructing a fresh hook over the same store; assert
   the records are there.
7. **Not loaded is not empty.** Before the mount load resolves, the payload
   omits the key; after, it carries `[]` for an empty ledger.

Mutation checks: remove the `COLLECTION_KINDS` entry (scenario 1 fails at
apply), remove the flag-independence (2 fails), replace the deterministic id
with a random one (4 yields two records), drop the awaited restore write (6
fails), and return `[]` instead of undefined before load (7 fails).

## Files this touches

| File | Change |
| --- | --- |
| `src/hooks/useJoboLedger.js` | new: state, load, write-through, the only writer |
| `src/sync/dbAdapter.js` | `joboRecords` in `COLLECTION_KINDS` |
| `src/mergeSync.js` | merge `joboRecords` by `updatedAt` |
| `src/App.jsx` | `buildSyncPayload` includes it; `applyEngineData` writes it back; backup export and every restore path |
| `src/utils/resetAppData.js` | `'dayglance-jobo'` in `KNOWN_INDEXEDDB_NAMES` |
| `CLAUDE.md` | a short section: the ledger is a collection; the hook is the only writer; the flag gates UI not data |

Nothing in `src/jobo/core.js`, nothing in any component.

## Open questions for slice 2

Small, and they only affect field names:

- Whether `title` and `planSnapshot` are part of the core record shape or are
  added by the hook at write time. Either works; the hook adding them keeps
  core purer.
- The name and vocabulary of `progress`, and whether un-completing maps to a
  specific existing value or a new one.
