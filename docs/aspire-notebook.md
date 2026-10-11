# Aspire notebook

Enable **Aspire** under Settings > Experimental, then use the Compass button in
Goals & Projects. The notebook uses a single-column layout on desktop and phone.

## Writing

Wishes and mottos are free text. Neither section has to be filled, and added rows
can stay blank. Enter or leaving a field saves it; Shift+Enter inserts a line
break. Escape in a draft cancels that edit. Closing the notebook saves remaining
drafts first and stays open if a write fails. Up/down buttons reorder entries
within their section. Remove keeps a synchronized tombstone; Undo restores the
last removed entry while the notebook remains open.

A draft whose entry changes on another device is not silently written over that
change. The draft remains visible, including after a remote removal, so it can
be copied or cancelled before editing the latest version.

## Persistence and synchronization

`aspireEntries` is a separate app-data collection. It is loaded even when the
Experimental switch is off, included in manual/automatic backups, and carried
by both the snapshot/file and GLANCEvault sync tiers. It follows the configured
sync workspace; it does not create a separate account or per-user private space.
The UI's save status confirms local durability, not completion of a network sync.

The collection lives in the `dayglance-aspire` IndexedDB database. Its strict
store has an atomic read-modify-write transaction; the fallback uses Web Locks.
Without either safe write path, the notebook is read-only. An unreadable store
is omitted from outgoing payloads, never advertised as an empty notebook.

Each entry has a stable ID and independently stamped text and order registers.
Both sync tiers use the same deterministic picker, so a concurrent reorder does
not overwrite an edit. Deletes and restores have retained stamps. Tombstones
are never pruned by the task retention horizon, and an offline text edit cannot
resurrect a deleted entry. Explicit Undo can restore one. An explicit backup
restore replaces the local notebook with the selected snapshot, so a backup
from before a removal can restore that entry. Older backups without the
collection leave the current notebook alone.

Vision/Goal relationships and annual/five-year planning windows are outside this
notebook's data model.

## Verification

```sh
npm test
npm run lint
npm run build
npm run audit
```

Focused suites live in `src/aspire/notebook.test.js`,
`src/aspire/notebookOrder.test.js`, `src/sync/aspireEntriesSync.test.js`, and
`src/components/AspireModal.test.jsx`.

Optional mounted DOM interaction checks (test-only dependency):

```sh
npm install --no-save --package-lock=false jsdom
node scripts/check-aspire-interactions.mjs
```

These cover save/dismiss failures and a remote deletion arriving during an edit;
they do not render a browser layout.

For browser review, check at 320px, 375px and desktop widths, including dark mode
and German/Chinese copy. Exercise blank creation, multiline/IME entry, blur and
Enter saves, Escape cancellation, close/backdrop saves, failed writes, reordering,
remove/Undo, and reload. With two devices on a configured sync target, verify
concurrent edits/reorders and a removal received while the other device has a
draft open. Browser layout and a live remote-service round trip complement the
local persistence and sync-simulator tests.
