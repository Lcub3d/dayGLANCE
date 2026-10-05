# Direct Access sync

A third file-tier Cloud Sync option alongside WebDAV and iCloud. Direct Access
reads and writes `dayglance-sync.json` in a folder the user picks on each device,
and leaves moving that folder between devices to whatever already does so:
Google Drive for desktop, Dropbox, OneDrive, Syncthing, a Nextcloud client, or
a plain network share.

This document is the design and the phased plan. Phase 1 is the refactor that
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

### Phase 3: Android

- A `DirectAccessBridge` on the Storage Access Framework, reusing the
  persistable tree permission flow and `SafeReplace` from the Obsidian
  repository. Thin wrappers in `src/native.js`.
- No reliable change watcher exists on SAF content URIs; Android relies on the
  poll plus the existing foreground kick.
- Caveat to document: the Google Drive and Dropbox Android apps do not expose a
  folder tree to the picker. Android users need a tool that mirrors to a real
  local folder (Syncthing, FolderSync, Autosync).

### Phase 4: iOS

- Folder picker plus security-scoped bookmark, the pattern `ObsidianBridge.swift`
  already uses. Drive and Dropbox file providers support folder selection and
  hydrate on coordinated reads.
- Lowest value because iCloud already covers Apple-only users.

### Phase 5 (optional, any order)

- Passphrase encryption for the Direct Access file, including the key-readiness
  gate in `useCloudSync.js`.
- Merge sibling "conflicted copy" files that Dropbox or Drive leave beside the
  snapshot, then delete them.
- A diagnostics card like `ICloudDiagnostics`, and a web/PWA transport via the
  File System Access API that `folderBackup.js` already demonstrates.

## Using it (desktop)

Settings → Cloud Sync → **Direct Access** → *Choose folder…* on each machine,
picking the same folder inside whatever the syncing tool mirrors (for example
`Google Drive/GLANCE`). The card shows the folder name, the last time a snapshot
was read, and a switch that pauses syncing on that device without touching the
folder copy. *Change folder* re-picks; *Disconnect* forgets the folder on that
device and leaves the file where it is. Reset App Data → *This device and the
Direct Access folder* deletes the file too.

Settings → Cloud Sync → iCloud diagnostics → *Run check* reads the Direct
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
