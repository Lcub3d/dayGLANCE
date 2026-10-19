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
 * `.RESIZE` and `.TOGGLE_ROUTINE`.
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

    companion object {
        private const val TAG = "LauncherIntents"
        const val ACTION_CREATE = "com.dayglance.app.launcher.CREATE"
        const val ACTION_COMPLETE = "com.dayglance.app.launcher.COMPLETE"
        const val ACTION_UNCOMPLETE = "com.dayglance.app.launcher.UNCOMPLETE"
        const val ACTION_MOVE = "com.dayglance.app.launcher.MOVE"
        const val ACTION_RESIZE = "com.dayglance.app.launcher.RESIZE"
        const val ACTION_TOGGLE_ROUTINE = "com.dayglance.app.launcher.TOGGLE_ROUTINE"
        val ACTIONS = setOf(ACTION_CREATE, ACTION_COMPLETE, ACTION_UNCOMPLETE, ACTION_MOVE, ACTION_RESIZE, ACTION_TOGGLE_ROUTINE)
    }
}
