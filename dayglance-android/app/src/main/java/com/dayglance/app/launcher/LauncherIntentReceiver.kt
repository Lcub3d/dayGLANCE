package com.dayglance.app.launcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.dayglance.app.MainActivity
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject

/**
 * The GLANCElauncher's write entry point (docs/launcher-integration.md), beside
 * the automation [com.dayglance.app.intents.IntentReceiver] and sharing its
 * `{action, payload}` envelope and wake broadcast, with two differences:
 *
 *  - It sits behind `com.dayglance.permission.LAUNCHER` in the manifest and
 *    does NOT consult the "Automation intents" toggle: that switch gates the
 *    public, any-app transport and stays as it is.
 *  - Every write carries a `clientId` extra and lands in its own QUEUE
 *    ([SharedDataStore.appendPendingLauncherIntent]), not the automation
 *    transport's single-depth slot: the launcher may send two completes in a
 *    row at a dead app, and the second must not replace the first. The web
 *    layer drains the queue in order (intents/launcherWrites.js) and dedupes
 *    on the id, so a re-sent write is harmless.
 *
 * Actions: `com.dayglance.app.launcher.CREATE`, `.COMPLETE`, `.UNCOMPLETE`, `.MOVE`,
 * `.RESIZE`, `.TOGGLE_ROUTINE` and `.REFRESH` (not a write: see [refresh]).
 */
class LauncherIntentReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in ACTIONS) return
        val clientId = intent.getStringExtra("clientId")?.takeIf { it.isNotBlank() }
        if (clientId == null) {
            Log.w(TAG, "Dropped $action: no clientId")
            return
        }
        if (action == ACTION_REFRESH) {
            refresh(context, clientId)
            return
        }
        // Re-serialise through JSONObject so a crafted payload cannot inject structure.
        val payload = try {
            intent.getStringExtra("payload")?.let { JSONObject(it) } ?: JSONObject()
        } catch (e: Exception) {
            JSONObject()
        }
        val entry = JSONObject()
            .put("action", action)
            .put("payload", payload)
            .put("clientId", clientId)
            .put("receivedAt", System.currentTimeMillis())
        SharedDataStore(context).appendPendingLauncherIntent(entry.toString())

        // Wake a running MainActivity so the WebView drains at once; a dead app
        // drains on next launch. Package-scoped, like the automation wake.
        context.sendBroadcast(Intent(MainActivity.ACTION_INTENT_RECEIVED).setPackage(context.packageName))
    }

    /**
     * REFRESH, routed by liveness. With the renderer alive the request is queued
     * and the wake makes the web layer run every sync tier and re-push (it reports
     * `ran` or `failed` into the log). With no renderer, [LauncherRefreshWorker]
     * is scheduled to run the same cycle headlessly and the entry reads
     * `scheduled` until the worker reports; only a failed enqueue is `deferred`.
     * A second REFRESH inside [INFLIGHT_MS] of one still queued or scheduled is
     * `coalesced`. Every entry carries the liveness it saw, so standby-bucket
     * deferral and dead-process gaps are visible in the launcher's diagnostics.
     */
    private fun refresh(context: Context, clientId: String) {
        val store = SharedDataStore(context)
        if (store.launcherRefreshSeen(clientId)) return
        val now = System.currentTimeMillis()
        val alive = MainActivity.rendererAlive
        val last = store.lastLauncherRefresh()
        val entry = JSONObject().put("clientId", clientId).put("requestedAt", now).put("liveness", if (alive) "alive" else "dead")
        val inFlight = last != null && last.optString("outcome") in IN_FLIGHT && !last.has("finishedAt") && now - last.optLong("requestedAt") < INFLIGHT_MS
        when {
            inFlight -> entry.put("outcome", "coalesced").put("reason", "a refresh is in flight")
            !alive -> {
                try {
                    LauncherRefreshWorker.schedule(context, clientId)
                    entry.put("outcome", "scheduled").put("reason", "process not running: headless run scheduled")
                } catch (e: Exception) {
                    Log.w(TAG, "Could not schedule a headless refresh", e)
                    entry.put("outcome", "deferred").put("reason", "process not running, and no headless run could be scheduled: ${e.message}")
                }
            }
            else -> {
                entry.put("outcome", "queued")
                val queued = JSONObject()
                    .put("action", ACTION_REFRESH)
                    .put("payload", JSONObject())
                    .put("clientId", clientId)
                    .put("receivedAt", now)
                store.appendPendingLauncherIntent(queued.toString())
            }
        }
        store.appendLauncherRefresh(entry)
        context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        if (entry.optString("outcome") == "queued") {
            context.sendBroadcast(Intent(MainActivity.ACTION_INTENT_RECEIVED).setPackage(context.packageName))
        }
    }

    companion object {
        private const val TAG = "LauncherIntents"
        /** A queued or scheduled refresh older than this with no outcome is treated as lost, not in flight. */
        private const val INFLIGHT_MS = 60_000L
        private val IN_FLIGHT = setOf("queued", "scheduled")
        const val ACTION_CREATE = "com.dayglance.app.launcher.CREATE"
        const val ACTION_COMPLETE = "com.dayglance.app.launcher.COMPLETE"
        const val ACTION_UNCOMPLETE = "com.dayglance.app.launcher.UNCOMPLETE"
        const val ACTION_MOVE = "com.dayglance.app.launcher.MOVE"
        const val ACTION_RESIZE = "com.dayglance.app.launcher.RESIZE"
        const val ACTION_TOGGLE_ROUTINE = "com.dayglance.app.launcher.TOGGLE_ROUTINE"
        const val ACTION_REFRESH = "com.dayglance.app.launcher.REFRESH"
        val ACTIONS = setOf(ACTION_CREATE, ACTION_COMPLETE, ACTION_UNCOMPLETE, ACTION_MOVE, ACTION_RESIZE, ACTION_TOGGLE_ROUTINE, ACTION_REFRESH)
    }
}
