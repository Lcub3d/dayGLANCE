# JOBO independent Do notes (experimental)

This document describes the view-side extension for notes on a Do that has no
Plan/task link. It is intentionally an experimental contract for the current
JOBO work and does not change the Slice 2 record schema or the Slice 3 ledger
boundary.

## Record shape

An independent Do is a normal canonical record created by
`createDoRecord(...)` with `taskId: null`. Its optional opaque extension is:

```js
{
  taskId: null,
  notes: 'A note attached to this independent Do'
}
```

`notes` is a string. An empty string means that the note has been cleared. The
record is retained; clearing text never tombstones or removes the Do. A linked
Do (`taskId !== null`) does not receive a separate note through this adapter:
its task note remains the task-owned surface.

## Adapter API

`src/jobo/doNotes.js` exports:

```js
doNotesText(record) -> string
prepareDoNotesEdit({ records, record, text, now }) -> record | null
```

`doNotesText` returns the text for a live independent Do and `''` for a linked
or deleted Do. Invalid records and invalid note values throw.

`prepareDoNotesEdit` takes the version opened by the editor (`record`) and the
latest canonical collection (`records`). `now` is an epoch millisecond number.
The caller commits the returned record through the existing `recordJobo` /
ledger writer. It never writes to a second notes store.

The collection only needs to be an array. Rows for unrelated IDs are ignored,
which lets an older opaque extension coexist while this experimental adapter is
being rolled out. A malformed row with the target ID is rejected.

The adapter returns `null` when the row is missing, deleted, linked, or stale.
An edit is stale when the current copy changed its note, identity, captured
history, source, observation timestamp, or another opaque extension. A current
copy that changed only its schedule interval or progress is safe to reuse: the
new note is applied on top of that current copy. The resulting `updatedAt` is
strictly newer than the current version, even when the device clock moved
backward. `createdAt`, `observedAt`, `taskId`, `title`, `planSnapshot`, source,
and all other immutable fields are preserved byte-for-byte.

If `text` already equals the current text, the current canonical record is
returned unchanged as a no-op; callers should skip the write. This avoids
creating a new version for a click that did not change the note.

## Merge and recovery boundary

The note is an opaque field on the Do row, so the existing ledger store,
vault/file sync merge, and backup/restore transport it without a new
collection. `pickJoboRecord` remains whole-record last-writer-wins. There is no
text merge: if two devices edit the same record concurrently, the winning
record's complete note is selected. A newer remote tombstone or note edit is a
conflict and the local editor must reopen the row.

The current UI integration is responsible for choosing the writer and for
showing a conflict. A future upstream review may promote this extension into a
formal record contract; until then, it remains local experimental behavior.
