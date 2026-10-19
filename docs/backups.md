# Backups: what is kept, and how much space it takes

dayGLANCE has three backup channels. Each copy is a **full payload**, about
the size of your data in local storage (Settings → Storage Breakdown shows
that figure). This page lists how many copies each channel keeps, so the
total footprint can be worked out from that one number.

## Local auto-backups (IndexedDB)

- **What:** a snapshot on the hourly, daily or weekly cadence you choose,
  stored in this browser's IndexedDB (`dayglance-auto-backups`). It lives
  outside local storage and its ~5 MB limit.
- **Retention:** up to 24 hourly, 30 daily and 12 weekly copies
  (`AUTO_BACKUP_RETENTION` in `@glance-apps/sync`). Only the frequency you
  have enabled accumulates.
- **Unchanged data is not stored twice** (#2144). A backup whose data is
  identical to the last backup of that frequency is skipped, so the copies
  you keep are the last *N distinct states* rather than the last N ticks of
  the clock. The comparison is a SHA-256 of the payload's `data`
  (`src/utils/backupDedupe.js`). It ignores the payload's own timestamp, and
  device-settings capture already excludes the backup and sync markers that
  change on their own.
- **Pruning and the restore list never load the backups themselves**: both
  work from the backup ids. Restoring loads only the one you pick.
- **Worst case:** 30 × your data size (daily). With dedupe, it is one copy
  per day on which something changed.

## Remote auto-backups (WebDAV / Nextcloud)

- **What:** one file per upload in `<app folder>/backups/` on your server.
- **Retention:** the same counts as local, pruned after each upload.
- **Size:** each file is your data as JSON. With sync encryption on, it is
  about a third larger (the encrypted payload is base64).
- **Unchanged data is not uploaded again.** The upload is skipped when this
  device's last successful upload has identical content, was encrypted the
  same way, and is still on the server. Turning encryption on, switching
  servers, or that file being pruned or deleted all lead to a fresh upload.

## Folder backup (desktop browsers, File System Access)

- **What:** a live file (`dayglance-data.json`), rewritten a couple of
  seconds after each change, plus point-in-time snapshots
  (`dayglance-backup-YYYY-MM-DD-HHMM.json`) on the cadence you choose.
- **Retention:** one live file, plus up to the cadence's retention count of
  snapshots (30 for daily).
- **Not deduplicated, on purpose.** The folder is for machines that wipe
  browser data when they close. There, a snapshot per session is the
  history the machine otherwise lacks, and the marker a dedupe would need
  is wiped with everything else.

## Putting it together

With 3 MB of data, daily cadence on every channel and something changing
every day, the worst case is about 90 MB in IndexedDB, 90 MB (120 MB
encrypted) on the server, and 93 MB in the folder. Days with no changes add
nothing locally or remotely.
