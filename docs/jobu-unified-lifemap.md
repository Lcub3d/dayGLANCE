# Unified planning nodes and lane-based Life Map (Jobu only)

This is a personal `product/jobu` change, not an upstream JOBO slice proposal.

## One durable planning format

Wishes, visions, goals, projects and unclassified ideas now use the same
`lifeNode` value in the existing append-only `jobuRecords` journal:

```js
{
  version: 1,
  id: 'stable-domain-id',
  type: 'wish', // 'vision' | 'goal' | 'project' | null
  title: '...', description: '', completed: false, starred: false,
  parentIds: [],
  position: null, // or { x, y }, in canvas coordinates
  onCanvas: true,
  bindings: {}, // original wish/vision/stage/goal/project identifiers
  details: {}   // retained type-specific payloads, without nested node arrays
}
```

The journal revision ID and the logical node ID remain separate. Changing type
never changes the node ID. Hierarchy and support-network references use the
stable ID, not the mutable type or React Flow's escaped presentation ID.
Wishes do not store embedded vision arrays, and visions do not store embedded
stage arrays. Type-specific fields remain in `details`; they are not a second
editable collection. No task or JOBO record format changes.

`entities.js` owns pure validation, migration projection and identity helpers;
`lifeNodeStore.js` owns atomic journal commands; `useLifeNativeCollections.js`
adapts inherited native goal/project handlers. Native arrays are now committed
read projections/compatibility caches, not competing planning owners. Local
native-editor commands patch the canonical node and preserve unrelated facets.
Legacy arrays arriving through sync are ignored when either the current journal
or incoming payload already contains the migration marker. An unloaded journal
is not an empty one, and the apply gate reads the store rather than stale React
state. Authoritative changes travel in `jobuRecords` through the existing file
and vault transports.

## Upgrade and recovery

Take a whole-app and personal-journal backup before deployment. Upgrade **all
personal syncing Jobu clients together**: older builds reject unknown revision
kinds. This is not a backwards-compatible mixed-version sync rollout.

The first loaded personal session snapshots the exact old local source strings
once at `jobu-life-node-source-backup-v1` before rewriting compatibility caches.
This includes goals, projects, native deletion masks, the old notebook and old
map-view storage. The map footer exports that recovery snapshot as JSON. It is
not a second live store or an automatic downgrade mechanism.

A single journal transaction flattens valid existing data and writes marker
`jobu:life-nodes:v1` (`lifeNodeSchema`). Existing personal notebook revisions take
precedence over its stale localStorage copy. Original nested wish revisions
remain in History, with their old live heads retired. Native payloads, genuine
stage handoff identities and ordered measured milestones are preserved. Old
native tombstones do not resurrect nodes. Corrupt/future sources block migration;
failed transactions publish no partial result. Retry does not duplicate nodes.
A failure to save the source-recovery copy prevents automatic cache overwrite.

History restore creates a new revision. Restoring canonical nodes validates
aliases and hierarchy; retired nested `lifeWish` versions are inspection-only
after migration, rather than becoming an ignored second writer. The schema
marker cannot be deleted. Personal export and whole-app backups carry the new
nodes; notebook-only export is a **legacy projection**, not a complete Life Map
backup. Original local sources and immutable revisions should be kept for any
manual rollback. An old application cannot read newly edited `lifeNode` rows.

## Interaction

Open **Life Planner → Life Map** in Jobu. The map has four shaded vertical lanes:
Wish, Vision, Goal and Project. A neutral staging lane sits to their left, beside
the unclassified inbox.

- Capture free text in the inbox; no type or required metric is invented.
- Drag an inbox item onto a typed lane to classify it, or use its placement button.
  “Spread on canvas” lays out the inbox in neutral staging **without assigning a
  type**. Drag a canvas card back to the inbox to make it unclassified and hide it
  from the canvas, without deleting it.
- Drag a card across lanes, or change its type in the common editor. The card's
  center is hit-tested in flow coordinates, including pan/zoom. Type, location
  and canvas membership commit together; failed/stale drops revert the preview.
- Drag from the right handle of a parent to the left handle of a child. Same-type
  children and multiple parents are allowed; self-links and new hierarchy cycles
  are rejected. Selecting a hierarchy edge offers unlink, not delete-node.
- Click a card to edit. Double-click, use its Focus button, or press Shift+Enter
  to focus that original node and its descendants. Breadcrumbs restore the prior
  view. Shared descendants appear once; external links are counted. This is a
  view filter, never a cloned subtree or a new score-calculation population.
- With a node focused by keyboard, Enter opens its editor, Left/Right moves it
  between lanes and Up/Down moves it vertically. Moves are persisted, not merely
  React Flow previews. Zoom/fit and the editor provide non-drag alternatives.
- “Add child” creates an unclassified child in the current scope. Optional linked
  tasks are read-only in the map and open through their existing editor.

Changing lane does not reparent a node; changing a parent does not force a type.
In Support Network mode, the same handles create support/prerequisite relations,
not hierarchy links. Scores, scenarios and original network identities survive
retyping; focus, search and visual positioning do not recalculate value inputs.
The inherited permission-filtered goal/project lists also gate map visibility.

## Compatibility limits that remain explicit

The old notebook and native task/goal/project screens are compatibility editors,
not redesigned into four-lane views. Retyping preserves existing binding roles:
a former native goal can remain in the native goal screen so task references do
not break. A node can retain both goal and project aliases after conversion.
All their writes still reach the same canonical node; this is not four stores.
New free-form wish/vision cards are edited in the common map editor, not forced
into the old measured notebook's numeric/horizon schema. A renamed vision keeps
its original metric label separately and the editor explains the distinction.
Use explicit notebook handoff for an old measured stage's native goal identity.

Deleting a node does not delete descendants or linked tasks. Missing endpoints
and support links remain recoverable, with explicit diagnostics/cleanup rather
than cascade deletion. Local commands prevent new cycles and duplicate bindings;
concurrent devices can still merge independently valid edits into a structural
conflict. The map surfaces those conflicts instead of silently discarding
history or claiming cross-device serializability.

Dirty editors, quick-capture text and network forms guard navigation. Native
asynchronous command failures retain a retryable in-memory command and expose a
retry/discard banner; do not close the page until saved. This is not a crash-
durable outbox. Personal clients only; no real shared-household permission model,
production cloud account or physical multi-device session was tested.

## Verification

New tests cover flat shape, original facets/order, stable identity, unclassified
placement, retyping, focus/multiple parents, stale editors, migration/retry,
legacy apply gating, native handoff conflicts, history, real IndexedDB and the
existing file/vault/backup boundaries. Chinese and English strings are authored;
other shipped languages carry English fallback for this new namespace with key
and interpolation parity tests.

Isolated Chromium acceptance uses the real store, native adapter and React Flow,
including actual pointer connections and lane dragging. A separate whole-App
StrictMode test exercises migration, entry navigation, editing and reload of a
native project. It uses synthetic data on a separate local origin, never personal
accounts or the user's running Jobu instance.

The pinned product base `8bc1b96` already fails 10 assertions in
`src/locales.test.js` (9) and `src/sync/joboRecordsSync.test.js` (1). Final checks
compare the candidate's failure names to that unchanged base, rather than
skipping tests or hiding failures. In particular, the existing personal JOBO
Timed/Untimed scenario is not changed by this planning-storage feature.
