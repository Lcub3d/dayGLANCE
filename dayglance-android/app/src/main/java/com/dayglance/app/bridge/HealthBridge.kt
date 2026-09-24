package com.dayglance.app.bridge

import android.webkit.JavascriptInterface
import com.dayglance.app.data.HealthRepository
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * Android health bridge.
 *
 * Reads step counts and sleep data through [HealthRepository]. Methods are
 * called on a WebView background thread, so
 * [runBlocking] is safe here — it never blocks the main thread.
 *
 * Permission flow: [requestPermission] delegates to [onRequestPermission], which
 * posts an [ActivityResultLauncher] launch on the main thread in MainActivity.
 */
class HealthBridge(
    private val repository: HealthRepository,
    private val onRequestPermission: () -> Unit,
) {

    @JavascriptInterface
    fun getSteps(date: String): String {
        val localDate = parseDate(date)
        val result = runBlocking { repository.getStepsDetailed(localDate) }
        return JSONObject()
            .put("steps", result.value ?: 0)
            .put("goal", 10000)
            .put("status", result.status.wireValue)
            .put("provider", result.providerId ?: JSONObject.NULL)
            .toString()
    }

    @JavascriptInterface
    fun getSleep(date: String): String {
        val localDate = parseDate(date)
        val read = runBlocking { repository.getSleepDetailed(localDate) }
        val result = read.value
        val stagesArray = JSONArray()
        result?.stages?.forEach { s ->
            stagesArray.put(
                JSONObject()
                    .put("stage", s.stage)
                    .put("durationMinutes", s.durationMinutes)
            )
        }
        return JSONObject()
            .put("durationMinutes", result?.durationMinutes ?: 0)
            .put("stages", stagesArray)
            .put("status", read.status.wireValue)
            .put("provider", read.providerId ?: JSONObject.NULL)
            .toString()
    }

    @JavascriptInterface
    fun checkPermission(): String =
        if (runBlocking { repository.hasPermissions() }) "granted" else "denied"

    @JavascriptInterface
    fun checkStepsPermission(): String =
        if (runBlocking { repository.hasStepsPermission() }) "granted" else "denied"

    @JavascriptInterface
    fun checkSleepPermission(): String =
        if (runBlocking { repository.hasSleepPermission() }) "granted" else "denied"

    @JavascriptInterface
    fun requestPermission(): String {
        onRequestPermission()
        return "pending"
    }

    private fun parseDate(date: String): LocalDate = try {
        LocalDate.parse(date)
    } catch (e: DateTimeParseException) {
        LocalDate.now()
    }
}
