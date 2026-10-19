package com.dayglance.app.launcher

import android.content.Context
import android.util.Log
import com.dayglance.app.data.SharedDataStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * The three launcher-facing writes the web layer makes (docs/launcher-integration.md),
 * shared by the full bridge ([com.dayglance.app.bridge.NativeBridge], the app) and
 * the headless one ([HeadlessBridge], the worker's WebView), so both roots write
 * the store the same way and announce it on the same URI.
 */
object LauncherWrites {
    private const val TAG = "LauncherSnapshot"

    /**
     * Store the snapshot and announce it. With [carryWeather], a snapshot that
     * carries no weather keeps the previous one's: a headless run fetches no
     * forecast, and the launcher's weather ring would otherwise go blank until
     * the app next opened.
     */
    fun updateSnapshot(context: Context, store: SharedDataStore, snapshotJson: String, carryWeather: Boolean = false) {
        try {
            store.launcherSnapshot = if (carryWeather) withCarriedWeather(snapshotJson, store.launcherSnapshot) else snapshotJson
            store.launcherSnapshotUpdatedAt = System.currentTimeMillis()
            context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to store the launcher snapshot", e)
        }
    }

    /** [incoming]'s weather collection replaced by [previous]'s when it is absent or empty. Pure. */
    fun withCarriedWeather(incoming: String, previous: String?): String {
        if (previous == null) return incoming
        return try {
            val next = JSONObject(incoming)
            val weather = next.optJSONArray("weather")
            if (weather != null && weather.length() > 0) return incoming
            val old = JSONObject(previous).optJSONArray("weather") ?: return incoming
            if (old.length() == 0) return incoming
            next.put("weather", JSONArray(old.toString())).toString()
        } catch (e: Exception) {
            incoming
        }
    }

    /** Merge the heartbeat ({checkedAt, syncedAt}) into the stored one and announce it. */
    fun touchHeartbeat(context: Context, store: SharedDataStore, json: String) {
        try {
            val incoming = JSONObject(json)
            val merged = store.launcherHeartbeat?.let { JSONObject(it) } ?: JSONObject()
            for (key in incoming.keys()) merged.put(key, incoming.get(key))
            store.launcherHeartbeat = merged.toString()
            context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to store the launcher heartbeat", e)
        }
    }

    /** Merge a REFRESH outcome ({clientId, outcome, reason?, durationMs}) into its log entry and announce it. */
    fun recordRefresh(context: Context, store: SharedDataStore, json: String) {
        try {
            val entry = JSONObject(json)
            val clientId = entry.optString("clientId")
            if (clientId.isEmpty()) return
            entry.put("finishedAt", System.currentTimeMillis())
            store.updateLauncherRefresh(clientId, entry)
            context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to record a launcher refresh", e)
        }
    }
}
