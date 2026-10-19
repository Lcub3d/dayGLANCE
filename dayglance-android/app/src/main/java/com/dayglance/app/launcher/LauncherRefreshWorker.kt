package com.dayglance.app.launcher

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.webkit.WebViewAssetLoader
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dayglance.app.DayGlanceApplication
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The launcher's REFRESH at a dead process (docs/launcher-integration.md,
 * "Freshness"; CLAUDE.md "Headless refresh"). [LauncherIntentReceiver] enqueues
 * one of these when no renderer exists; it boots the web bundle in a WebView
 * with no Activity, at `index.html?headless=refresh&clientId=…`, where
 * main.jsx mounts src/headless/HeadlessRefresh.jsx: one cycle of every
 * configured sync tier, then the launcher snapshot and heartbeat are pushed
 * and the outcome is reported through [HeadlessBridge.headlessDone].
 *
 * Expedited, network-constrained, unique (KEEP): one run answers every REFRESH
 * that arrives while it waits. [HeadlessRefreshPolicy] decides what a run does
 * once the worker gets to execute: hand over to a renderer that has appeared
 * in the meantime, throttle (ten-minute floor between headless runs), or run
 * under a sixty-second cap.
 *
 * The REVERSE LOCK: a WebView here shares localStorage and IndexedDB with the
 * app's. If the user opens the app during a run, [abortForLiveInstance] runs
 * first thing in MainActivity.onCreate, on the main thread, and destroys this
 * WebView before the live one loads; the web root also asks the bridge
 * `headlessShouldAbort` at each phase boundary. Signal-abort, not wait: the
 * live instance runs its own cycle at start, so the headless result is
 * redundant the moment the app opens, and a run has no local edits to lose.
 * Waiting with a cap would only hold the splash for a result the app is about
 * to produce itself. A localStorage key written before the abort is one whole
 * slice, as a kill mid-apply leaves today; the next cycle merges it.
 *
 * Every step lands in the refresh log the launcher's diagnostics show:
 * `scheduled` at the receiver, then `startedAt` and `waitMs` (how long the OS
 * held the job: standby buckets and Doze are visible here) when the worker
 * runs, then `ran`/`failed` from the web layer or `aborted`/`throttled`/
 * `failed` with a reason from here.
 */
class LauncherRefreshWorker(
    private val appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    /** One headless WebView and its outcome; the bridge and the abort hook hold it. */
    class Run(val clientId: String) {
        @Volatile var abortRequested: Boolean = false
            private set
        @Volatile var rendererGone: Boolean = false
        @Volatile var webView: WebView? = null
        /** The web layer's outcome JSON, or null when the worker had to decide. */
        val done = CompletableDeferred<String?>()

        fun finish(json: String?) { done.complete(json) }

        /** Main thread only: stop the page and release the WebView. */
        fun abort() {
            abortRequested = true
            teardown()
            done.complete(null)
        }

        fun teardown() {
            val wv = webView ?: return
            webView = null
            try {
                wv.stopLoading()
                wv.loadUrl("about:blank")
                wv.destroy()
            } catch (e: Exception) {
                Log.w(TAG, "headless WebView teardown", e)
            }
        }
    }

    override suspend fun doWork(): Result {
        val clientId = inputData.getString(KEY_CLIENT_ID) ?: return Result.success()
        val store = SharedDataStore(appContext)
        val now = System.currentTimeMillis()
        return when (val decision = HeadlessRefreshPolicy.decide(MainActivity.rendererAlive, store.launcherHeadlessLastRunAt, now)) {
            is HeadlessRefreshPolicy.Decision.HandToLive -> { handToLive(store, clientId, now); Result.success() }
            is HeadlessRefreshPolicy.Decision.Throttled -> {
                patch(store, clientId, JSONObject().put("outcome", "throttled").put("reason", HeadlessRefreshPolicy.throttledReason(decision.sinceLastMs)).put("finishedAt", now))
                Result.success()
            }
            is HeadlessRefreshPolicy.Decision.Run -> { run(store, clientId, now); Result.success() }
        }
    }

    /** The renderer came up while the job waited: the alive path answers this REFRESH. */
    private fun handToLive(store: SharedDataStore, clientId: String, now: Long) {
        val queued = JSONObject()
            .put("action", LauncherIntentReceiver.ACTION_REFRESH)
            .put("payload", JSONObject())
            .put("clientId", clientId)
            .put("receivedAt", now)
        store.appendPendingLauncherIntent(queued.toString())
        patch(store, clientId, JSONObject().put("outcome", "queued").put("reason", "renderer alive when the worker ran").put("liveness", "alive"))
        appContext.sendBroadcast(Intent(MainActivity.ACTION_INTENT_RECEIVED).setPackage(appContext.packageName))
    }

    private suspend fun run(store: SharedDataStore, clientId: String, startedAt: Long) {
        // Stamped at the start so a crash mid-run still counts toward the floor.
        store.launcherHeadlessLastRunAt = startedAt
        val requestedAt = store.launcherRefreshEntry(clientId)?.optLong("requestedAt", startedAt) ?: startedAt
        patch(store, clientId, JSONObject().put("startedAt", startedAt).put("waitMs", startedAt - requestedAt).put("headless", true))

        val run = Run(clientId)
        val booted = withContext(Dispatchers.Main) {
            // Same thread as MainActivity.onCreate: either the renderer is alive
            // already (hand over) or an opening app will find `current` and abort it.
            if (MainActivity.rendererAlive) return@withContext false
            current = run
            run.webView = buildWebView(run)
            run.webView?.loadUrl("$ENTRY?headless=refresh&clientId=${android.net.Uri.encode(clientId)}")
            true
        }
        if (!booted) { handToLive(store, clientId, System.currentTimeMillis()); return }

        val reported = withTimeoutOrNull(HeadlessRefreshPolicy.CAP_MS) { run.done.await() }
        val timedOut = !run.done.isCompleted
        withContext(Dispatchers.Main) {
            if (current === run) current = null
            run.teardown()
        }
        if (reported == null) {
            val (outcome, reason) = HeadlessRefreshPolicy.unreportedOutcome(run.abortRequested, timedOut, run.rendererGone)
            patch(store, clientId, JSONObject().put("outcome", outcome).put("reason", reason).put("finishedAt", System.currentTimeMillis()))
            Log.w(TAG, "headless refresh $clientId: $outcome ($reason)")
        } else {
            Log.i(TAG, "headless refresh $clientId: $reported")
        }
    }

    private fun buildWebView(run: Run): WebView {
        val webView = WebView(appContext)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(appContext))
            .addPathHandler("/", WebViewAssetLoader.PathHandler { path ->
                try {
                    val stream = appContext.assets.open("web/$path")
                    val mime = when {
                        path.endsWith(".svg") -> "image/svg+xml"
                        path.endsWith(".png") -> "image/png"
                        path.endsWith(".ico") -> "image/x-icon"
                        path.endsWith(".js") -> "application/javascript"
                        path.endsWith(".css") -> "text/css"
                        path.endsWith(".html") -> "text/html"
                        else -> "application/octet-stream"
                    }
                    WebResourceResponse(mime, "utf-8", stream)
                } catch (e: Exception) { null }
            })
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                assetLoader.shouldInterceptRequest(request.url)

            // The headless page never navigates; anything else is refused.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net" && request.url.toString() != "about:blank"

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                run.rendererGone = true
                run.webView = null
                run.finish(null)
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(TAG, "headless js: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                }
                return true
            }
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        val bridge = HeadlessBridge(appContext, run) { json ->
            run.webView?.post {
                run.webView?.evaluateJavascript("window.__dgNativeHttpDone && window.__dgNativeHttpDone($json)", null)
            }
        }
        webView.addJavascriptInterface(bridge, "DayGlanceNative")
        return webView
    }

    private fun patch(store: SharedDataStore, clientId: String, patch: JSONObject) {
        store.updateLauncherRefresh(clientId, patch)
        appContext.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
    }

    /**
     * Expedited work runs as a foreground service below Android 12, which
     * needs a notification; on 12+ it is a JobScheduler expedited job and this
     * is never shown. Quiet channel, no sound.
     */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val notification: Notification = NotificationCompat.Builder(appContext, DayGlanceApplication.CHANNEL_UP_NEXT)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(appContext.getString(R.string.launcher_refresh_notification))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return ForegroundInfo(NOTIFICATION_ID, notification)
    }

    companion object {
        private const val TAG = "LauncherRefresh"
        const val UNIQUE_WORK_NAME = "launcher-headless-refresh"
        private const val KEY_CLIENT_ID = "clientId"
        private const val NOTIFICATION_ID = 7310
        private const val ENTRY = "https://appassets.androidplatform.net/assets/web/index.html"

        /** The run in progress, if any; main thread writes. */
        @Volatile private var current: Run? = null

        /** Whether a headless WebView exists right now (the provider's `meta.headlessRunning`). */
        val running: Boolean get() = current != null

        /** Enqueue one run for [clientId]; a run already queued or running answers it too (KEEP). */
        fun schedule(context: Context, clientId: String) {
            val request = OneTimeWorkRequestBuilder<LauncherRefreshWorker>()
                .setInputData(Data.Builder().putString(KEY_CLIENT_ID, clientId).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        /**
         * The reverse lock's trigger: the app is about to create its renderer.
         * Main thread (MainActivity.onCreate), before `rendererAlive` is set. A
         * run between its liveness check and its WebView has not set `current`
         * yet; it re-checks liveness on this same thread before booting.
         */
        fun abortForLiveInstance() {
            val run = current ?: return
            current = null
            Log.i(TAG, "headless refresh ${run.clientId}: aborted, the app opened")
            run.abort()
        }
    }
}
