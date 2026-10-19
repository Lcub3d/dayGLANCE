package com.dayglance.app.launcher

import android.content.Context
import android.webkit.JavascriptInterface
import com.dayglance.app.bridge.CryptoKeyBridge
import com.dayglance.app.bridge.HttpBridge
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject

/**
 * `window.DayGlanceNative` for a headless refresh (src/headless/, CLAUDE.md
 * "Headless refresh"): the ALLOWLIST of what a run may reach, and nothing the
 * full [com.dayglance.app.bridge.NativeBridge] has beyond it. The web root
 * boots only the data layer, both sync tiers and the launcher push; this is
 * the native side of the same line. A module that did initialise in a headless
 * run would find no method here (the web layer feature-detects every bridge
 * call), not a native side effect. Keep this list equal to
 * HEADLESS_BRIDGE_METHODS in src/headless/headlessMode.js.
 *
 * Requires no Activity: HTTP, the Keystore-wrapped sync keys and the launcher
 * store all take a Context.
 */
class HeadlessBridge(
    private val context: Context,
    private val run: LauncherRefreshWorker.Run,
    private val onHttpResult: (json: String) -> Unit,
) {
    private val http = HttpBridge()
    private val cryptoKey = CryptoKeyBridge(context)
    private val store = SharedDataStore(context)

    // ── The sync transports ───────────────────────────────────────────────────

    @JavascriptInterface
    fun httpRequest(method: String, url: String, headersJson: String, body: String): String =
        http.request(method, url, headersJson, body)

    @JavascriptInterface
    fun httpRequestAsync(callId: String, method: String, url: String, headersJson: String, body: String) {
        HttpBridge.workers.execute {
            val raw = http.request(method, url, headersJson, body)
            val result = try { JSONObject(raw) } catch (_: Exception) { JSONObject(HttpBridge.errorResult("invalid bridge result")) }
            onHttpResult(JSONObject().put("id", callId).put("result", result).toString())
        }
    }

    @JavascriptInterface
    fun supportsAsyncHttp(): Boolean = true

    // ── The sync keys (the same Keystore slots the app uses) ──────────────────

    @JavascriptInterface
    fun storeSyncKey(b64: String?) = cryptoKey.storeSyncKey(b64)

    @JavascriptInterface
    fun getSyncKey(): String = cryptoKey.getSyncKey()

    @JavascriptInterface
    fun storeSyncKeyForSlot(slot: String, b64: String?) = cryptoKey.storeSyncKeyForSlot(slot, b64)

    @JavascriptInterface
    fun getSyncKeyForSlot(slot: String): String = cryptoKey.getSyncKeyForSlot(slot)

    /** No SSE reader without an Activity; the vault tier polls in its cycle anyway. */
    @JavascriptInterface
    fun isVaultSseSupported(): Boolean = false

    // ── The launcher push ─────────────────────────────────────────────────────

    /** The snapshot, keeping the last one's weather: a headless run fetches no forecast. */
    @JavascriptInterface
    fun updateLauncherSnapshot(snapshotJson: String) =
        LauncherWrites.updateSnapshot(context, store, snapshotJson, carryWeather = true)

    @JavascriptInterface
    fun touchLauncherHeartbeat(json: String) = LauncherWrites.touchHeartbeat(context, store, json)

    @JavascriptInterface
    fun recordLauncherRefresh(json: String) = LauncherWrites.recordRefresh(context, store, json)

    // ── The run's protocol with the worker ────────────────────────────────────

    /** True once the app has opened: the run stops at its next phase boundary (the reverse lock). */
    @JavascriptInterface
    fun headlessShouldAbort(): Boolean = run.abortRequested

    /** The run's outcome ({clientId, outcome, reason?, durationMs}); the worker tears the WebView down. */
    @JavascriptInterface
    fun headlessDone(json: String) = run.finish(json)
}
