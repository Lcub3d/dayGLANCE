/**
 * What dayGLANCE's own cloud-sync triggers do — one place, so the button and the
 * post-edit debounce cannot drift apart (and so neither can drift back into a
 * bare upload).
 *
 * ── Why it is a full cycle, not an upload ──────────────────────────────────
 * The button used to call `engine.upload()`: a bare PUT of this device's state
 * with no read and no ETag. One click therefore replaced the remote file with
 * whatever this device held, which is how a device that had never read the remote
 * (a wrong server address, a proxy pointed at the wrong host) destroyed the other
 * devices' data. The settings page's "Sync now" has always been the full cycle
 * (`engine.sync()` = download → merge → upload) and that is what a user pressing a
 * sync button expects: read first, merge, then write.
 *
 * There is deliberately no upload parameter here — the signature is the
 * guarantee. The WebDAV file tier runs the cycle; GLANCEvault keeps its own.
 * `runSyncAfterEdit` keeps the same guarantee for the debounce below.
 *
 * @param {object} io
 * @param {boolean} io.webdavOn        the file tier is enabled
 * @param {boolean} io.vaultEnabled    the GLANCEvault DB tier is enabled
 * @param {() => void} [io.cloudSyncDownload]  engine.download() (read → merge → write)
 * @param {() => void} [io.vaultSyncNow]       the vault's own cycle
 */
export function runSyncNow({ webdavOn, vaultEnabled, cloudSyncDownload, vaultSyncNow } = {}) {
  if (webdavOn) cloudSyncDownload?.();
  if (vaultEnabled) vaultSyncNow?.();
}

/**
 * What the 5-second debounce after a local edit does. Same rule, same reason as
 * the button, and deliberately the same shape: a cycle, never a bare upload.
 *
 * ── Why "just upload, the edit is newer anyway" is wrong twice over ────────
 * 1. An edit that no read backs has no validator to send, so the server cannot
 *    refuse it. That is the overwrite this PR exists to stop — a device holding
 *    a snapshot of a different server, or of a folder that has since been
 *    pointed elsewhere, replaces the fleet's file.
 * 2. It does not even work as a fast path. The verified ETag is recorded from
 *    the last READ, never from a write (a provider's `upload()` returns no ETag),
 *    so after any cycle that wrote, a bare upload carries an ETag the server has
 *    already moved past: a 412 the engine swallows under the in-flight lock.
 *    The edit then waits for the next poll — up to 60 s — instead of 5.
 *
 * The cycle reads first, so it always writes against the current ETag. It costs
 * one GET per debounced edit, and it merges before writing, which is what makes
 * the fast path safe rather than merely quicker.
 *
 * The signature is the guarantee: there is no upload parameter to pass.
 *
 * @param {object} io
 * @param {() => void} [io.cloudSyncDownload]  engine.download() (read → merge → write)
 */
export function runSyncAfterEdit({ cloudSyncDownload } = {}) {
  cloudSyncDownload?.();
}
