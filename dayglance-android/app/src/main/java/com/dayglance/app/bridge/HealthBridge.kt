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
 * Reads step counts and sleep data through [HealthRepository], whose provider
 * manager owns device-local Health Connect/OEM selection. Methods are called
 * on a WebView background thread, so
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
            .put("status", result.status.key)
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
            .put("status", read.status.key)
            .put("provider", read.providerId ?: JSONObject.NULL)
            .toString()
    }

    @JavascriptInterface
    fun getRawDiagnostics(date: String): String {
        val localDate = parseDate(date)
        val results = runBlocking { repository.getRawDiagnostics(localDate) }
        val providers = JSONArray()
        results.forEach { result ->
            val stepOrigins = JSONArray()
            result.stepOrigins.sorted().forEach { stepOrigins.put(it) }
            val sleepOrigins = JSONArray()
            result.sleepOrigins.sorted().forEach { sleepOrigins.put(it) }

            providers.put(
                JSONObject()
                    .put("provider", result.providerId)
                    .put("stepsRecordCount", result.stepsRecordCount ?: JSONObject.NULL)
                    .put("stepsRawTotal", result.stepsRawTotal ?: JSONObject.NULL)
                    .put("stepOrigins", stepOrigins)
                    .put("sleepRecordCount", result.sleepRecordCount ?: JSONObject.NULL)
                    .put("sleepOrigins", sleepOrigins)
                    .put("error", result.error ?: JSONObject.NULL)
            )
        }
        return JSONObject()
            .put("date", localDate.toString())
            .put("providers", providers)
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

    @JavascriptInterface
    fun getProviderStatus(): String {
        val snapshot = repository.getProviderSnapshot()
        val bindings = JSONObject()
        snapshot.bindings.forEach { (metric, providerId) ->
            bindings.put(metric, providerId ?: JSONObject.NULL)
        }
        val available = JSONArray()
        snapshot.availableProviders.forEach { available.put(it) }

        val providerDiagnostics = JSONObject()
        snapshot.providerDiagnostics.forEach { (providerId, values) ->
            val providerJson = JSONObject()
            values.forEach { (key, value) -> providerJson.put(key, value) }
            providerDiagnostics.put(providerId, providerJson)
        }

        return JSONObject()
            .put("schemaVersion", snapshot.schemaVersion)
            .put("manufacturer", snapshot.manufacturer)
            .put("model", snapshot.model)
            .put("androidSdk", snapshot.androidSdk)
            .put("bindings", bindings)
            .put("availableProviders", available)
            .put("providerDiagnostics", providerDiagnostics)
            .toString()
    }

    @JavascriptInterface
    fun resetProviderSelection(): String {
        repository.resetProviderSelection()
        return "ok"
    }

    private fun parseDate(date: String): LocalDate = try {
        LocalDate.parse(date)
    } catch (e: DateTimeParseException) {
        LocalDate.now()
    }
}
