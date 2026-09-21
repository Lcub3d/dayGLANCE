# Life Map / 人生蓝图

Life Map replaces the disabled mind-map entry in Life Planner. It is another
presentation of the existing document and native collections, not a second
planner database. The notebook, Planning Assistant, SWOT/vision notes, native
Goals dashboard, Project Planner and task editors remain the editing surfaces.

## Data boundary

`src/lifeplanner/lifeMap.js` adapts the existing `buildHierarchy` projection.
Wish → vision → semantic stage goal → native project → task is the normal path.
A materialised native goal and the corresponding stage appear as **one node**.
Additional projects linked by a native `goalId` are included. Tasks are resolved
by `projectId`, including inbox tasks and recurring templates. Native IDs never
come from titles or graph coordinates; recurring templates retain separate
identities from their expanded occurrences.

Shared native entities are drawn once. Existing conflicting planning references
are dashed, not repaired/reparented. A missing project is a non-editable
placeholder, not an instruction to recreate it. Tombstones are observed on map
open, native collection changes, window focus and storage events. Invalid native
deletion metadata temporarily hides native entities instead of resurrecting them.
Unassociated native items are opt-in under “Show unlinked items”. Recycle-bin
records and example tasks are not presented as active personal plans.

## Interaction

- Pan/zoom, fit view, search across all five levels, focus one wish, choose the
  deepest visible level, and fold/expand a branch.
- Phone layouts start at a readable wish-sized zoom, or the matching node when
  searching. Fit is still available for an explicit whole-map overview.
- Search reveals matching ancestor paths even when the path was collapsed; it
  does not overwrite the saved collapse state.
- Click a node for its full title and native Open action; double-click to open
  directly. A wish returns to the notebook and focuses its actual writing line.
  A vision or unmaterialised stage uses the existing vision note; a native goal,
  project or task uses the respective native workspace. Recurring templates
  navigate through the existing spotlight route to their next occurrence.
- Dragging only changes presentation coordinates. Connections are not editable,
  and Delete never deletes business records. Multi-user/read-only guards keep
  editing disabled and native collections use the existing visibility predicate.
- Switching from notebook/assistant to map flushes pending writing through the
  original durable store; a failed write does not silently discard the draft.

Only coordinates and collapsed graph IDs are stored in
`day-planner-life-map-view-v1`. This cosmetic key is device-local, bounded to
2,000 entries, and does not contain copied titles or task records. Invalid data
is left intact until an explicit reset. Quota failures keep the visual state and
expose Retry. Auto-arrange resets only these cosmetic settings. Cross-device or
atomic cross-tab layout synchronization is not implemented.

The existing notebook's hierarchy migration behavior is unchanged; entering the
map itself does not run migration. This UI does not implement new hierarchy
relations, dependency scheduling, task completion, provider writeback, native
record persistence or changes to either sync transport.

## React Flow

The requested repository `bcakmakoglu/react-flow` is a fork of `xyflow/xyflow` and
its README installs the official `@xyflow/react` package. This feature pins that
MIT-licensed package to **12.11.3**, with the lockfile committed. The attribution
remains visible. Custom native-styled nodes and a deterministic layered layout
are local code. No additional graph layout library, paid Pro code, backend,
fonts or external runtime service is added. React Flow is lazy-loaded only when
the map is first opened.

## Reproduce review

```sh
npm ci
npm run lint
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 5173
# another terminal, Python Playwright + Chromium installed:
python scripts/life-map-review.py
```

The script generates synthetic data using the real model and hierarchy helpers.
It exercises the production app and captures Chinese/English, light/dark and
1700/1440/1024/393/320px screenshots. No personal accounts are used. CI separately
builds the Android WebView and Electron renderer; browser review does not claim
physical-device, native installer, live provider or new cross-device testing.
