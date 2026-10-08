# Direct Access sync

A third file-tier Cloud Sync option alongside WebDAV and iCloud. Direct Access
reads and writes `dayglance-sync.json` in a folder the user picks on each device,
and leaves moving that folder between devices to whatever already does so:
Google Drive for desktop, Dropbox, OneDrive, Syncthing, a Nextcloud client, or
a plain network share.

This document is the design and the phased plan. Phases 1 and 2 are merged;
3 and 4 are built and awaiting device tests; 5 and 6 are designed below.
Phase 1 is the refactor that
makes the rest possible; each later phase is its own branch and PR.

## Where it fits

The two existing file-tier options are not siblings in the code:

| | WebDAV | iCloud |
|---|---|---|
| Lives in | `@glance-apps/sync` engine, via `src/sync/adapter.js` | a loop in `App.jsx` (`iCloudSync`) |
| Transport | HTTP with server ETags and `If-Match` | a local file the iCloud daemon ferries |
| Concurrency | optimistic (412 → conflict dialog) | none; three-way merge absorbs races |
| Encryption | optional passphrase envelope | plaintext (Apple encrypts the container) |
| Runs alongside the others | one provider slot | yes, with its own mutex |
| Configuration | text fields in the settings form | zero-config; per-device on/off |
| Remote change signal | 60 s poll | 15 s poll + `fs.watch` / `NSMetadataQuery` |

Direct Access follows the **iCloud model**, for three reasons:

1. A third-party synced folder behaves like the iCloud container. It is a local
   file ferried by a daemon, with no ETag, eventual consistency, and files that
   may be cloud-only placeholders (Drive streaming, OneDrive Files On-Demand,
   Dropbox online-only). The iCloud loop already handles the placeholder,
   partial-read and evicted-file cases.
2. It must run alongside WebDAV and GLANCEvault. The engine resolves providers
   from its own table and has one provider slot; making Direct Access an engine
   provider would force a choice between it and WebDAV, and would need a change
   in the upstream package.
3. The settings form cannot express it. Engine providers are text fields;
   Direct Access needs a native folder picker and persisted folder access, which
   the Obsidian vault integration already solved on every platform
   (`electron/obsidian.ts`, `ObsidianRepository.kt`, `ObsidianBridge.swift`).

What it must **not** do is copy the iCloud loop. That loop is ~270 lines with
guards that have each shipped a fix (the seed guard, the first-run prompt, the
stale-mutex release, the write throttle, the HealthKit strip, the reset guard).
A second copy would drift. So the iCloud loop is first extracted into a hook
parameterised by a *transport*, and Direct Access becomes the second transport.

## Design decisions

**One diagnostics panel, on every platform.** Settings → Cloud Sync → Sync
diagnostics reports GLANCEvault and WebDAV everywhere, the iCloud container on
Apple platforms, and the Direct Access folder wherever the bridge exists, each
block only where its transport is. The report's first line names the device
(`ios`, `android`, `macos`, `windows`, `linux`, `web`), not the iCloud bridge.
The web and PWA, which have neither file transport, still get the vault and
WebDAV rows.

**A write takes a second look.** A change reaches a device by two roads at
different speeds: GLANCEvault in seconds, the folder's syncing tool in tens of
seconds. The second Mac learned of an iPhone's edit from the vault, found its
folder copy stale, wrote the same data with a fresh stamp, and Nextcloud
reported a conflict on every change (2026-10-08; the conflict copies were
byte-identical in content to the live file). So the cycle that first wants a
write only records what it saw, and writes when a later cycle, at least
`WRITE_CONFIRM_MS` (10 s) on, sees the same difference against the same file
version. If the file moved on in between, the slower road delivered what this
device was about to write, and the write is dropped. A real edit made on the
device still goes out, one poll later. Seeding an absent file is not deferred.

**Health-store counts ride in the file.** The iCloud transport strips
HealthKit-derived habit counts from what it writes (`utils/healthLogFilter.js`),
because Apple guideline 5.1.3 forbids HealthKit data in iCloud. That rule is
about Apple's container. A Direct Access folder is the user's own cloud, so the
transport declares `stripsHealthLogs: false` and the cycle writes the counts
whole, exactly as GLANCEvault and WebDAV carry them; a Mac, which has no health
store, adopts an Android phone's Health Connect steps from the file. The first
build stripped on every transport, and the steps never reached the Macs
(2026-10-07). The diagnostics dry run asks the write question the same way the
cycle does, per transport.

- **Same file, same envelope.** The folder holds `dayglance-sync.json` in the
  existing `{ version, lastModified, data }` shape. A user who points Direct
  Access at a locally mirrored copy of their WebDAV folder interoperates.
- **Plaintext first, like iCloud, but never downgrade.** The iCloud loop
  rewrites an encrypted envelope it cannot decrypt as plaintext. That is
  acceptable inside Apple's container and wrong on a Google Drive folder.
  Direct Access refuses to write over an encrypted file it cannot read (it
  surfaces an error instead). Optional passphrase encryption of the Direct
  Access file is a later phase and reuses `src/utils/crypto.js`.
- **Off by default, explicitly configured.** iCloud's tri-state preference
  exists because iOS re-grants the entitlement on reinstall. Direct Access has
  no such problem: absence means off, and "configured" means a folder was
  picked on this device.
- **Folder path and bookmark live in the native layer.** Exactly as the Obsidian
  vault does: Electron's main process (security-scoped bookmark under the Mac
  App Store sandbox), Android's SAF persistable tree URI, iOS's security-scoped
  bookmark in UserDefaults. The renderer only ever sees a folder *name*.
- **Atomic writes.** `electron/icloud.ts` writes in place to preserve the iCloud
  daemon's extended attributes. Drive, Dropbox, OneDrive and Syncthing all cope
  with temp-plus-rename, and `writeFileAtomicSync` protects against a torn file.
- **Longer write throttle, cheap change check.** Third-party daemons round-trip
  slower than iCloud, so the write throttle is longer to limit conflict copies.
  The transport stats the file before each poll read and skips an unchanged
  size and mtime.
- **Reset "everywhere" deletes it**, as it does the iCloud snapshot
  (`src/utils/resetAppData.js`).
- **Multi-user counts it as configured sync.** The roster travels inside the
  snapshot and is merged by `mergeSyncData`, so `multiUserGate.js` treats a
  Direct Access device like a WebDAV one. The separate `glance-users.json`
  roster sync over WebDAV/iCloud is out of scope.

## Shared snapshot-file sync (Phase 1 output)

```
src/sync/snapshotFileSync.js      pure: one cycle over an injected transport + io
src/hooks/useSnapshotFileSync.js  React wiring: poll, mutex, foreground kicks,
                                  change events, first-run prompt state
src/sync/icloudSnapshotTransport.js   iCloud as the first transport
```

A **transport** is a plain object:

```js
{
  id: 'icloud',                     // namespaces storage keys and log lines
  isAvailable(): boolean,           // platform supports it AND it is reachable now
  read(): Promise<string|null>,     // JSON text, 'null'/null when absent,
                                    // '{"downloading":true}' or '{"error":"…"}'
  write(text): Promise<boolean>,
  onChanged(cb): () => void,        // optional push signal from the native side
  lastSyncedKey, prefKey,           // localStorage keys this transport owns
  isEnabled(): boolean,             // per-device switch (iCloud: tri-state, absent = on)
  writeThrottleMs,                  // iCloud 5 s; Direct Access longer
  allowsPlaintextReseed: boolean,   // iCloud true (legacy envelope cleanup); Direct Access false
  stripsHealthLogs: boolean,        // iCloud true (Apple guideline 5.1.3); Direct Access false
}
```

The pure cycle (`runSnapshotFileCycle`) takes the transport plus an `io` object
(`buildSyncPayload`, `applyEngineData`, `mergeSyncData`, `stripHealthSourcedLogs`,
`decryptData`, `isEncryptedEnvelope`, `now`, `storage`) and the per-transport
cycle state (`missingSince`, `lastWriteAt`, `firstRunPending`), and returns the
next state plus what it did (`seeded`, `applied`, `wrote`, `prompted`,
`skipped: reason`). Every guard the App.jsx loop carries today is preserved and
is tested in `snapshotFileSync.test.js` with a mutation check per guard.

The hook owns what needs React: the 15 s poll, the shared `cloudSyncInProgressRef`
mutex with WebDAV, the stale-lock timestamp used on foreground resume, the
pending flag for a cycle skipped under the lock, the `onChanged` subscription,
and the first-run prompt state and handlers. Phase 1 changes no behaviour:
iCloud users see the same cycles, the same prompt, the same keys.

## Phased plan

### Phase 1: extract the iCloud loop (no behaviour change)

- Add the pure cycle module and the hook; wire iCloud through them.
- `icloudSyncPref.js` and `icloudSeedGuard.js` keep their exports; the hook
  reads keys off the transport so a second transport brings its own.
- `ICloudFirstRunModal` is unchanged in Phase 1; it gains string props when
  Direct Access needs its own copy.
- Tests: the cycle planner with each guard mutation-checked, and a scenario that
  walks save → state → write → read → apply through a fake transport.

### Phase 2: Direct Access on desktop (macOS, Windows, Linux) — done

- `electron/directAccess.ts` modelled on `icloud.ts` and `obsidian.ts`: native
  picker with security-scoped bookmarks, config in the user-data folder, restore
  on launch with a reachability check, read/write/delete, a re-attaching watcher
  with own-write suppression. An unreadable or zero-length file reads as
  `downloading`.
- Preload exposes a `directAccess` namespace; `src/sync/directAccessTransport.js`
  implements the transport shape above.
- Settings: a Direct Access card beside the iCloud toggle in `SettingsModal.jsx`
  and `MobileSettingsPanel.jsx`: choose folder, folder name, on/off, disconnect,
  last synced, status. Strings in all ten locale bundles.
- Reset-app-data gains the Direct Access snapshot for scope `everywhere`.
- Docs: this file gains the user-facing behaviour; README feature row;
  ARCHITECTURE.md describes both file-tier models.

#### What Phase 2 shipped, and two decisions it settled

- No first-run restore prompt for Direct Access. iCloud asks because its sync
  can come back on without the user; here, picking the folder is the decision,
  and the snapshot in it is applied.
- An unreachable folder (the streaming tool not running, a share not mounted)
  is reported once, then waited out quietly: the transport marks itself
  unreachable, the hook stops cycling, and each poll tick re-probes so sync
  resumes on its own when the folder is back. A fresh pick clears the
  last-synced stamp, so an empty new folder is seeded at once rather than
  treated as an eviction of the old one.
- The main process classifies reads (`electron/directAccessStore.ts`): a
  zero-length file is a cloud-only placeholder or a tool mid-write and is never
  reported as absent; a vanished folder is an error, never an absent file; an
  unchanged file is served from a size-and-mtime cache. Writes go through
  `writeFileAtomicSync`.
- The folder path and the macOS bookmark are persisted by the main process in
  `direct-access.json` under the user-data folder; the renderer stores only the
  per-device switch (`dayglance-direct-access-enabled`) and the last-synced
  stamp (`dayglance-direct-access-last-synced`).

### Phase 3: Android — done

- A `DirectAccessBridge` on the Storage Access Framework, reusing the
  persistable tree permission flow and `SafeReplace` from the Obsidian
  repository. Thin wrappers in `src/native.js`.
- No reliable change watcher exists on SAF content URIs; Android relies on the
  poll plus the existing foreground kick.
- Caveat to document: the Google Drive and Dropbox Android apps do not expose a
  folder tree to the picker. Android users need a tool that mirrors to a real
  local folder (Syncthing, FolderSync, Autosync).

#### What Phase 3 shipped

- `DirectAccessRead.kt` classifies a read exactly as the desktop store does
  (zero-length is a placeholder, a revoked grant or vanished tree is an error,
  a thrown read is retried, a refused open is an error), pure over a `Source`
  seam and JVM-tested in `DirectAccessReadTest.kt`.
- `DirectAccessRepository.kt` binds it to DocumentFile: the tree URI lives in
  `SharedDataStore.directAccessPath`, writes go through `SafeReplace`, every
  read heals a crashed write first, and an unchanged file is served from a
  lastModified-and-length cache.
- `DirectAccessBridge.kt` is `window.DayGlanceDirectAccess`; MainActivity owns
  the SAF tree picker and takes the persistable grant, and the result reaches
  the page through `window.__dgDirectAccessPicked`.
- `src/sync/directAccessNativeBridge.js` (named for Android in this phase, shared
  with iOS from Phase 4) adapts those synchronous calls to the
  promise shape the Electron preload offers, so the transport, hook, cycle and
  settings card are unchanged. There is no folder watcher on SAF, so the poll
  and the foreground kick carry remote changes.
- The settings card shows an Android-only hint: the Google Drive and Dropbox
  apps do not offer a folder tree to the picker, so the folder has to come from
  an app that mirrors to local storage (Syncthing, FolderSync, Autosync).

### Phase 4: iOS — done

- Folder picker plus security-scoped bookmark, the pattern `ObsidianBridge.swift`
  already uses. Drive and Dropbox file providers support folder selection and
  hydrate on coordinated reads.
- Lowest value because iCloud already covers Apple-only users.

#### What Phase 4 shipped

- A folder in a third-party File Provider's storage (Nextcloud, Drive, Dropbox)
  cannot be held at all on iOS: see "On iPhone and iPad the bookmark is of the
  sync FILE" under Phase 4. An earlier attempt to materialise the folder by
  listing it through coordination did nothing, because with the older File
  Provider API a folder has no directory on disk to materialise.

### Phase 5: multi-user over Direct Access

Phase 2 made a connected folder count as configured sync, so the multi-user
toggle unlocks and the roster that rides inside the snapshot (`users`, merged
last-writer-wins per `syncId` by `mergeSyncData`) travels with everything
else. What it left out is the household roster file, `glance-users.json`,
which is how two people on two *different* apps or accounts agree on who is in
the household: today it syncs over WebDAV (`syncSharedUsers`) or iCloud Drive
(`syncSharedUsersViaICloud`), and the "Sync household roster" button and the
automatic roster sync in `App.jsx` know only those two. A device whose only
tier is Direct Access unlocks multi-user and then has no roster sync. A shared
Nextcloud, Drive or Syncthing folder is exactly the shared destination iCloud
cannot be (`multiUserICloudOnly`), so this tier has to carry the roster.

- **One file, same wire format, same place.** `glance-users.json` in
  lastGLANCE's wire schema (`id` = sync id), at `usersPath` relative to the
  picked folder, default `GLANCE/users/`, exactly where the WebDAV tier puts
  it relative to its root. A sibling app pointed at the same folder reads the
  same roster with no translation. Plaintext, as on WebDAV and iCloud: names
  and ids only.
- **The bridges learn relative paths.** Every Direct Access bridge today reads,
  writes and deletes one fixed file. Each gains the same five path-taking
  operations the iCloud intents transport has (`listFiles`, `readFile`,
  `writeFile`, `deleteFile`, `makeDir`), confined to the picked folder: a path
  that escapes it (`..`, an absolute path) is refused in the bridge, not in the
  renderer, on all three platforms. Electron is `path.resolve` plus a prefix
  check; Android walks `DocumentFile` children under the tree; iOS resolves
  under the bookmark and keeps the coordinated I/O. The single-file snapshot
  calls stay as they are. A fake bridge in `src/sync/` exercises the contract
  once for all three.
- **`syncSharedUsersViaDirectAccess(usersPath, localUsers)`** in
  `src/intents/sharedUsers.js`, a copy of the iCloud one over the Direct
  Access bridge: read, `mergeUsers`, write (make the directory on a failed
  write, as the iCloud one does). Null when no folder is connected or the
  transport is unreachable.
- **Gates and wiring.** `canSyncUserRoster` and `multiUserUnavailableReason`
  take `directAccessConnected`; the button prefers WebDAV, then Direct Access,
  then iCloud, and the automatic roster sync effect runs the Direct Access one
  whenever a folder is connected, keyed on its last-synced stamp the way the
  WebDAV one is keyed on `cloudSyncLastSynced`.
- **Tests.** `sharedUsers.test.js` over the fake bridge: first writer seeds,
  second merges, a tombstoned user stays gone, an unreachable folder is null
  and writes nothing; the gate tests gain the Direct Access rows; a scenario
  with two devices on one folder converging their rosters; and the path
  confinement mutation-checked on the Electron store (the only bridge that
  runs here).
- **Acceptance on devices.** Two Macs on the Nextcloud folder with WebDAV off:
  add a household member on one, press the button on the other, see the
  member. Then the same without the button.

### Phase 6: intents over Direct Access, and the sibling apps

Intents (`docs/tasker-intents-architecture.md`) are how the GLANCE apps talk
to each other: one envelope file per event, written by the sender into an
events folder and polled by the receiver, with a cursor so nothing is handled
twice and a garbage collector that deletes expired files. There are four
transports today: Android broadcasts, the WebDAV event log, the vault, and
iCloud Drive files under `GLANCE/events/`. Direct Access gives a folder, which
is the one thing the iCloud transport needs, so it becomes the fifth. This is
the larger phase, because a transport nobody else can read is pointless:
lastGLANCE and lifeGLANCE have to gain the Direct Access tier too.

**6a. dayGLANCE.**

- **Extract the folder transport once.** The iCloud intents code is already
  split into an adapter (`icloudFileTransport.js`: the five operations) and
  logic that only knows the adapter: `writeEventFileICloud`, the receive loop
  in `useIntentPoller.js`, `runIntentGCICloud`, `icloudDeliverer`. Lift that
  logic into `src/intents/folderIntents.js`, parameterised on an adapter, and
  instantiate it twice: iCloud, and Direct Access over the Phase 5 bridge
  operations. Same filenames (`filenameFor(envelope)`), same envelope, same
  cursor key per transport, same retention. The iCloud instance keeps its
  one difference, refusing encrypted envelopes; the Direct Access instance
  takes the WebDAV posture, plaintext unless passphrase encryption is on,
  because the folder is someone else's cloud.
- **A fifth outbox target.** `emitTargets` adds `directAccess` when a folder
  is connected and the new "Direct Access intents" switch is on; the outbox
  deliverer map gains the deliverer; the poller runs the receive loop for it
  on the same tick as the others. The switch sits beside "iCloud intents" and
  "GLANCEvault intents" in Settings, independent of the sync switch, and
  saving reloads the app so the poller restarts, as the vault one does.
- **Tests.** `folderIntents.test.js` runs the whole emit → file → receive →
  handle → GC path over a fake adapter, once per instance; the deliverer
  tests gain the Direct Access rows (transient when the folder is unreachable,
  held when encryption is on and the key is not ready); a scenario with two
  fake devices on one folder where an intent emitted on one is handled once
  on the other and the file is collected after retention.
- **Acceptance.** A `create` intent from a Mac reaches dayGLANCE on Android
  through the Nextcloud folder and FolderSync, and the event file is gone
  after retention.

**6b. lastGLANCE, then 6c. lifeGLANCE.** Each needs the tier before the
transport, in this order:

1. **The folder bridge.** The five operations plus `pickFolder`, `status`,
   `disconnect`, with the same read classification (`absent` only when the
   folder is there and the file is not; a zero-length file is a placeholder,
   never absent; a vanished folder or revoked grant is an error). lastGLANCE
   is Capacitor, so this is a small custom plugin wrapping the same Kotlin
   (SAF tree, `SafeReplace`) and Swift (security-scoped bookmark, coordinated
   I/O) that dayGLANCE's shells carry; the porting notes in the Tasker doc's
   section 8 apply unchanged. Electron is `electron/directAccessStore.ts` as
   is.
2. **Snapshot sync through the folder**, using `snapshotFileSync.js` and the
   transport pattern, so the sibling's own data syncs there too and the
   first-run and seed guards come with it. The cycle is pure and has no
   dayGLANCE in it; it belongs in `@glance-apps/sync` beside the merge the
   siblings already share, and this is the point to move it.
3. **The roster** (Phase 5's file, same path) and **the intents transport**
   (6a's module, same adapter contract). Both are app-independent by
   construction; a sibling adds its own switch and its own cursor key.

**Acceptance for the phase:** three apps on one folder. A task created in
dayGLANCE on Android appears as an intent in lastGLANCE on a Mac, the
household roster edited in lifeGLANCE shows in both others, and an idle hour
leaves every file's modified time where it was.

### Phase 7 (optional, any order)

- Passphrase encryption for the Direct Access file, including the key-readiness
  gate in `useCloudSync.js`.
- Merge sibling "conflicted copy" files that Dropbox or Drive leave beside the
  snapshot, then delete them.
- A diagnostics card like `ICloudDiagnostics`, and a web/PWA transport via the
  File System Access API that `folderBackup.js` already demonstrates.

## Using it (desktop, Android, iPhone and iPad)

Settings → Cloud Sync → **Direct Access** → *Choose folder…* on each machine,
picking the same folder inside whatever the syncing tool mirrors (for example
`Google Drive/GLANCE`). The card shows the folder name, the last time a snapshot
was read, and a switch that pauses syncing on that device without touching the
folder copy. *Change folder* re-picks; *Disconnect* forgets the folder on that
device and leaves the file where it is. Reset App Data → *This device and the
Direct Access folder* deletes the file too.

On Android the card is the same, under Settings → Cloud Sync. Pick a folder
that an app mirrors to the phone's storage (Syncthing, FolderSync, Autosync);
the Google Drive and Dropbox apps do not offer their folders to Android's
folder picker. Remote changes land on the 15 second poll or when the app comes
to the foreground.

On iPhone and iPad the bookmark is of the sync FILE, not of its folder.
Nextcloud, Google Drive, Dropbox, Box and OneDrive ship Apple's older
non-replicated File Provider extension, which keeps every item in its own
directory keyed by the item's id: a picked folder has no real directory on disk
and never will, so a bookmark of it fails ("The file couldn't be opened because
it doesn't exist", iPhone, 2026-10-08) and a path built by appending a file name
to it points nowhere. Folder selection from those providers is a known-open
Apple bug (FB9703910). A picked file works with all of them: the system calls
the provider's `startProvidingItem` on a coordinated read and `itemChanged`
after a coordinated `.forReplacing` write, which is how any app edits a
provider's document in place. So the card offers **Choose sync file…** (the
`dayglance-sync.json` another device already seeded) and **Create sync file…**
(the export picker moves a file holding `null` into a folder of the user's
choice; `null` classifies as absent, so the first cycle seeds it from this
device exactly as it seeds an empty folder). A wrong file name is refused, and
a create that the picker renamed on a clash (`dayglance-sync 2.json`) is
removed with a message to choose the existing file. A bookmarked file that is
gone reads as `error`, never `absent`: there is no folder to seed into, and
the user re-picks or re-creates. `deleteSnapshot` forgets the bookmark with
the file. iCloud sync keeps running alongside; the two share one mutex and
never merge into state at once.

Settings → Cloud Sync → Sync diagnostics → *Run check* reads the Direct
Access file too, on any platform with the bridge: folder status, the file's
size, modified time and counts, and the dry run of this device's merge against
it (*would write*, *would apply*, and the slices that differ). That is the tool
for "why does the file keep changing": the slice it names is the one two
devices disagree on.

The file is plain JSON, the same `dayglance-sync.json` the WebDAV tier writes.
If the folder already holds an encrypted copy from a WebDAV setup, Direct
Access reports it and writes nothing until the file is replaced or decrypted;
it never downgrades an encrypted file to plaintext.

## Risks

- The daemon can write while we read. Parse-fail-and-skip covers this; the stat
  check makes it rarer.
- Two devices editing inside the daemon's propagation window produce conflict
  copies rather than a 412. The union merge means churn, not loss; the throttle
  keeps it rare.
- Phase 1 touches the iCloud path that has had several field incidents. The
  scenario test lands with it, before any Direct Access code is built on top.
