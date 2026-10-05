package com.dayglance.app.bridge

import android.content.Context
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.dayglance.app.data.DirectAccessRepository

/**
 * Direct Access sync (docs/direct-access-sync.md): window.DayGlanceDirectAccess.
 *
 * The web layer's adapter (src/sync/directAccessAndroidBridge.js) wraps these
 * synchronous calls in the same promise-based shape the Electron preload
 * offers, so the shared transport and cycle run unchanged. The one asynchronous
 * step is the folder picker: [pickFolder] asks MainActivity to launch the SAF
 * tree picker, and the result comes back through [onFolderPicked], which calls
 * `window.__dgDirectAccessPicked(statusOrNull)` on the page.
 *
 * JS contract:
 *   pickFolder()            → void; later window.__dgDirectAccessPicked({…} | null)
 *   status()                → JSON { configured, name, path, reachable }
 *   read()                  → JSON { kind: absent|downloading|error|text, text?, error? }
 *   write(text)             → Boolean
 *   deleteSnapshot()        → Boolean
 *   disconnect()            → Boolean
 *
 * All methods run on the JavascriptInterface background thread; SAF I/O is
 * acceptable there (the Obsidian bridge does the same).
 */
class DirectAccessBridge(
    context: Context,
    private val webView: WebView,
    private val launchPicker: () -> Unit,
) {
    private val repository = DirectAccessRepository(context)

    @JavascriptInterface
    fun pickFolder() = launchPicker()

    @JavascriptInterface
    fun status(): String = repository.status().toString()

    @JavascriptInterface
    fun read(): String = repository.read()

    @JavascriptInterface
    fun write(text: String): Boolean = repository.write(text)

    @JavascriptInterface
    fun deleteSnapshot(): Boolean = repository.delete()

    @JavascriptInterface
    fun disconnect(): Boolean {
        repository.clearFolder()
        return true
    }

    /**
     * NOT a @JavascriptInterface: MainActivity's picker result. A null uri is a
     * cancelled picker and leaves the stored folder as it was. The status JSON
     * is built with org.json, so it is also a valid JS object literal.
     */
    fun onFolderPicked(uri: Uri?) {
        if (uri != null) repository.setFolder(uri)
        val json = if (uri != null) repository.status().toString() else "null"
        webView.post {
            webView.evaluateJavascript(
                "window.__dgDirectAccessPicked && window.__dgDirectAccessPicked($json)",
                null,
            )
        }
    }
}
