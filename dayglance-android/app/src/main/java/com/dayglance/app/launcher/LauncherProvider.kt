package com.dayglance.app.launcher

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import com.dayglance.app.data.SharedDataStore

/**
 * The read-only face of the launcher snapshot (docs/launcher-integration.md):
 * `content://com.dayglance.app.launcher/<collection>` serves the rows
 * [LauncherSnapshotRows] maps out of the JSON the web layer pushed
 * ([com.dayglance.app.bridge.NativeBridge.updateLauncherSnapshot]). Every push
 * notifies the authority, so a ContentObserver on any collection URI sees
 * every change without polling.
 *
 * Guarded in the manifest by `com.dayglance.permission.LAUNCHER`
 * (`signature|knownSigner`, the launcher's certificates). Nothing is ever
 * inserted, updated or deleted here: writes go through
 * [LauncherIntentReceiver].
 */
class LauncherProvider : ContentProvider() {

    private lateinit var store: SharedDataStore
    private val matcher = UriMatcher(UriMatcher.NO_MATCH).apply {
        for (c in LauncherSnapshotRows.COLLECTIONS) addURI(LauncherSnapshotRows.AUTHORITY, c, 1)
    }

    override fun onCreate(): Boolean {
        store = SharedDataStore(context ?: return false)
        return true
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? {
        if (matcher.match(uri) != 1) return null
        val collection = uri.lastPathSegment ?: return null
        val rows = LauncherSnapshotRows.rows(
            store.launcherSnapshot, collection,
            heartbeatJson = store.launcherHeartbeat,
            refreshLogJson = store.launcherRefreshLog,
            rendererAlive = com.dayglance.app.MainActivity.rendererAlive,
            headlessRunning = LauncherRefreshWorker.running,
        ) ?: return null
        val cursor = MatrixCursor(LauncherSnapshotRows.COLUMNS, rows.size)
        rows.forEachIndexed { i, row -> cursor.addRow(arrayOf<Any?>(i, row.id, row.json)) }
        context?.let { cursor.setNotificationUri(it.contentResolver, CONTENT_URI) }
        return cursor
    }

    override fun getType(uri: Uri): String? =
        if (matcher.match(uri) == 1) "vnd.android.cursor.dir/vnd.dayglance.${uri.lastPathSegment}" else null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("read-only")
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("read-only")
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("read-only")

    companion object {
        /** The authority URI: observers register here and every push notifies it. */
        val CONTENT_URI: Uri = Uri.parse("content://${LauncherSnapshotRows.AUTHORITY}")
        fun collectionUri(collection: String): Uri = Uri.withAppendedPath(CONTENT_URI, collection)
    }
}
