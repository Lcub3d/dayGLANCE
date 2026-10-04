package com.dayglance.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject

/**
 * Direct Access sync (docs/direct-access-sync.md): the folder half on Android.
 *
 * The user picks a folder through the Storage Access Framework and the
 * persisted grant keeps it across reboots, exactly as the Obsidian vault is
 * held (ObsidianRepository). The web layer reads and writes dayglance-sync.json
 * in it and a third-party app mirrors the folder between devices. Only an app
 * that mirrors to a real local folder works here — Syncthing, FolderSync,
 * Autosync — because the Google Drive and Dropbox apps do not offer a folder
 * tree to the picker.
 *
 * Reads are classified by [DirectAccessRead] (pure, JVM-tested) over a
 * DocumentFile-backed source. Writes go through [SafeReplace] so a crash
 * mid-write cannot leave a torn file for the syncing app to ship everywhere;
 * every read heals a crashed write first. An unchanged file (same
 * lastModified and length) is served from a cache rather than re-read.
 */
class DirectAccessRepository(private val context: Context) {

    private val dataStore = SharedDataStore(context)

    private var cache: Cached? = null
    private data class Cached(val lastModified: Long, val length: Long, val text: String)

    // ── Folder ───────────────────────────────────────────────────────────────

    fun isConfigured(): Boolean = dataStore.directAccessPath != null

    /** Records the picked tree. The caller has already taken the persistable grant. */
    fun setFolder(uri: Uri) {
        dataStore.directAccessPath = uri.toString()
        cache = null
    }

    /** Forgets the folder and releases the grant; the file in it is left alone. */
    fun clearFolder() {
        val uriString = dataStore.directAccessPath
        if (uriString != null) {
            try {
                context.contentResolver.releasePersistableUriPermission(
                    Uri.parse(uriString),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
            } catch (e: Exception) {
                // Not held any more — nothing to release.
            }
        }
        dataStore.directAccessPath = null
        cache = null
    }

    private fun root(): DocumentFile? {
        val uriString = dataStore.directAccessPath ?: return null
        return try { DocumentFile.fromTreeUri(context, Uri.parse(uriString)) } catch (e: Exception) { null }
    }

    /**
     * True when a tree URI is stored but the persisted grant behind it is gone.
     * DocumentFile hides this (listFiles just returns empty), so this is the only
     * way to tell "the folder is empty" from "we can no longer see it at all".
     */
    private fun grantRevoked(): Boolean {
        val uriString = dataStore.directAccessPath ?: return false
        return try {
            val uri = Uri.parse(uriString)
            context.contentResolver.persistedUriPermissions.none { it.uri == uri && it.isReadPermission && it.isWritePermission }
        } catch (e: Exception) {
            false // can't tell — never invent an error
        }
    }

    private fun folderReachable(root: DocumentFile?): Boolean =
        root != null && !grantRevoked() && try { root.exists() && root.isDirectory } catch (e: Exception) { false }

    /** { configured, name, path, reachable } — the shape the web transport consumes. */
    fun status(): JSONObject {
        val root = root()
        val configured = isConfigured()
        return JSONObject().apply {
            put("configured", configured)
            put("name", if (configured) (root?.name ?: JSONObject.NULL) else JSONObject.NULL)
            put("path", dataStore.directAccessPath ?: JSONObject.NULL)
            put("reachable", configured && folderReachable(root))
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────────────────

    /** The classified read as JSON (see DirectAccessRead). */
    fun read(): String {
        val root = root()
        if (root != null && folderReachable(root)) {
            // Heal a crashed write before anything reads the file.
            recover(root)
        }
        val source = SafSource(root)
        val result = DirectAccessRead.classify(source)
        return DirectAccessRead.toJson(result)
    }

    /** Crash-safe create-or-replace of the snapshot. */
    fun write(text: String): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        cache = null
        return try {
            SafeReplace.replace(SafDir(root), DirectAccessRead.SYNC_FILE, text)
        } catch (e: Exception) {
            Log.w(TAG, "write failed: ${e.message}")
            false
        }
    }

    /** Deletes the snapshot (reset scope "everywhere"). A missing file counts as deleted. */
    fun delete(): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        cache = null
        return try {
            root.findFile(DirectAccessRead.SYNC_FILE)?.delete() ?: true
        } catch (e: Exception) {
            false
        }
    }

    private fun recover(root: DocumentFile) {
        try {
            when (SafeReplace.recover(SafDir(root), DirectAccessRead.SYNC_FILE)) {
                SafeReplace.Recovery.RESTORED_FROM_TEMP -> {
                    Log.w(TAG, "Restored ${DirectAccessRead.SYNC_FILE} from a crashed write's temp")
                    cache = null
                }
                SafeReplace.Recovery.DISCARDED_STALE_TEMP ->
                    Log.w(TAG, "Discarded a crashed write's temp (snapshot intact)")
                SafeReplace.Recovery.RESTORE_FAILED ->
                    Log.e(TAG, "Could not restore ${DirectAccessRead.SYNC_FILE} from a crashed write's temp")
                SafeReplace.Recovery.NONE -> {}
            }
        } catch (e: Exception) {
            // Recovery is best effort; the classified read below reports the state.
        }
    }

    // ── SAF bindings ─────────────────────────────────────────────────────────

    private fun readText(file: DocumentFile): String? =
        context.contentResolver.openInputStream(file.uri)?.use {
            it.bufferedReader().readText()
        }

    /** The read-side seam: one read's view, with the unchanged-file cache. */
    private inner class SafSource(private val root: DocumentFile?) : DirectAccessRead.Source {
        private var file: DocumentFile? = null
        private var looked = false
        private fun file(): DocumentFile? {
            if (!looked) {
                looked = true
                file = try { root?.findFile(DirectAccessRead.SYNC_FILE) } catch (e: Exception) { null }
            }
            return file
        }
        override fun configured() = isConfigured()
        override fun grantRevoked() = this@DirectAccessRepository.grantRevoked()
        override fun folderExists() = try { root != null && root.exists() && root.isDirectory } catch (e: Exception) { false }
        override fun fileExists() = file() != null
        override fun fileIsDirectory() = file()?.isDirectory == true
        override fun fileLength() = file()?.length() ?: 0L
        override fun readText(): String? {
            val f = file() ?: return null
            val stamp = Cached(f.lastModified(), f.length(), "")
            cache?.let { if (it.lastModified == stamp.lastModified && it.length == stamp.length) return it.text }
            val text = this@DirectAccessRepository.readText(f) ?: return null
            if (text.isNotEmpty()) cache = stamp.copy(text = text)
            return text
        }
    }

    /** The write-side seam for SafeReplace, mirroring ObsidianRepository.SafDir. */
    private inner class SafDir(private val dir: DocumentFile) : SafeReplace.Dir {
        override fun exists(name: String) = dir.findFile(name) != null
        override fun createAndWrite(name: String, text: String): Boolean {
            // octet-stream: providers only append an extension when the MIME
            // maps to one, so the exact display name survives.
            val created = dir.createFile("application/octet-stream", name) ?: return false
            if (created.name != name) {
                created.delete()
                return false
            }
            // Close the BufferedWriter (not just the raw stream) so its buffer
            // reaches the provider before the stream closes.
            val outputStream = context.contentResolver.openOutputStream(created.uri, "wt") ?: return false
            outputStream.use { stream ->
                stream.bufferedWriter().use { writer -> writer.write(text) }
            }
            return true
        }
        override fun delete(name: String) = dir.findFile(name)?.delete() ?: true
        override fun rename(from: String, to: String): Boolean {
            val f = dir.findFile(from) ?: return false
            return try { f.renameTo(to) && f.name == to } catch (e: Exception) { false }
        }
        override fun read(name: String): String? = dir.findFile(name)?.let { readText(it) }
    }

    companion object {
        private const val TAG = "DirectAccessRepository"
    }
}
