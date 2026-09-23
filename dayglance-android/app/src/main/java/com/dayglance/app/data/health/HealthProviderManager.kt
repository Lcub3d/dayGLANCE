package com.dayglance.app.data.health

import android.content.Context
import android.os.Build
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.time.LocalDate
import java.util.EnumMap

/**
 * Device-local health-provider binding.
 *
 * Discovery happens once per metric and the result is persisted in
 * dayglance_shared (which is excluded from Android backup/transfer). Normal
 * reads go straight to the saved provider. Re-discovery occurs only when the
 * saved adapter no longer exists or explicitly returns PROVIDER_UNAVAILABLE.
 */
class HealthProviderManager(
    context: Context,
    providers: List<HealthProvider> = AndroidHealthProviderRegistry.create(context),
) {
    private val store = SharedDataStore(context.applicationContext)
    private val manufacturer = Build.MANUFACTURER.orEmpty()
    private val model = Build.MODEL.orEmpty()
    private val providerById = providers.associateBy { it.id }

    private val lock = Any()
    private var loaded = false
    private val bindingIds = EnumMap<HealthMetric, String>(HealthMetric::class.java)
    private val activeProviders = EnumMap<HealthMetric, HealthProvider>(HealthMetric::class.java)

    fun requiredAndroidPermissions(): Set<String> {
        val grouped = HealthMetric.entries
            .mapNotNull { metric -> providerFor(metric)?.let { metric to it } }
            .groupBy({ it.second }, { it.first })

        return grouped.entries.flatMapTo(mutableSetOf()) { (provider, metrics) ->
            provider.requiredAndroidPermissions(metrics.toSet())
        }
    }

    suspend fun hasPermission(metric: HealthMetric): Boolean =
        providerFor(metric)?.let { provider ->
            runCatching { provider.hasPermission(metric) }.getOrDefault(false)
        } ?: false

    suspend fun readSteps(date: LocalDate): HealthRead<Int> =
        readWithOneFailover(HealthMetric.STEPS) { it.readSteps(date) }

    suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> =
        readWithOneFailover(HealthMetric.SLEEP) { it.readSleep(date) }

    fun snapshot(): HealthProviderSnapshot {
        ensureLoaded()
        val bindings = HealthMetric.entries.associate { metric ->
            metric.key to bindingIds[metric]?.takeUnless { it == NO_PROVIDER_ID }
        }
        val available = providerById.values
            .filter { runCatching { it.isAvailable() }.getOrDefault(false) }
            .map { it.id }
            .sorted()

        return HealthProviderSnapshot(
            schemaVersion = SELECTION_SCHEMA_VERSION,
            manufacturer = manufacturer,
            model = model,
            bindings = bindings,
            availableProviders = available,
        )
    }

    fun resetSelection() {
        synchronized(lock) {
            store.healthProviderSelectionJson = null
            bindingIds.clear()
            activeProviders.clear()
            loaded = false
        }
    }

    private suspend fun <T> readWithOneFailover(
        metric: HealthMetric,
        read: suspend (HealthProvider) -> HealthRead<T>,
    ): HealthRead<T> {
        val provider = providerFor(metric)
            ?: return HealthRead(status = HealthReadStatus.PROVIDER_UNAVAILABLE)

        val first = runCatching { read(provider) }.getOrElse { error ->
            HealthRead(
                status = HealthReadStatus.ERROR,
                providerId = provider.id,
                message = error.message,
            )
        }

        if (first.status != HealthReadStatus.PROVIDER_UNAVAILABLE) return first

        val replacement = synchronized(lock) {
            ensureLoadedLocked()
            bindingIds.remove(metric)
            activeProviders.remove(metric)
            discoverMetricLocked(metric, excludedProviderId = provider.id)
        } ?: return first

        return runCatching { read(replacement) }.getOrElse { error ->
            HealthRead(
                status = HealthReadStatus.ERROR,
                providerId = replacement.id,
                message = error.message,
            )
        }
    }

    /**
     * Fast path after the first resolution: return the in-memory adapter.
     * On process restart the persisted id is resolved directly without probing
     * every provider again.
     */
    private fun providerFor(metric: HealthMetric): HealthProvider? {
        synchronized(lock) {
            ensureLoadedLocked()
            activeProviders[metric]?.let { return it }

            val savedId = bindingIds[metric]
            if (savedId == NO_PROVIDER_ID) return null
            if (savedId != null) {
                providerById[savedId]?.let { saved ->
                    activeProviders[metric] = saved
                    return saved
                }
                // App updated and no longer contains that adapter.
                bindingIds.remove(metric)
            }

            return discoverMetricLocked(metric)
        }
    }

    private fun ensureLoaded() {
        synchronized(lock) { ensureLoadedLocked() }
    }

    private fun ensureLoadedLocked() {
        if (loaded) return
        loaded = true

        val raw = store.healthProviderSelectionJson ?: return
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (json.optInt("schemaVersion", -1) != SELECTION_SCHEMA_VERSION) return
        if (!json.optString("manufacturer", "").equals(manufacturer, ignoreCase = true)) return
        if (json.optString("model", "") != model) return

        val bindings = json.optJSONObject("bindings") ?: return
        for (metric in HealthMetric.entries) {
            val id = bindings.optString(metric.key, "")
            if (id.isNotBlank()) bindingIds[metric] = id
        }
    }

    private fun discoverMetricLocked(
        metric: HealthMetric,
        excludedProviderId: String? = null,
    ): HealthProvider? {
        val provider = HealthProviderSelector.select(
            metric = metric,
            manufacturer = manufacturer,
            providers = providerById.values,
            excludedProviderId = excludedProviderId,
        ) ?: run {
            // Persist a negative result as well. Otherwise a phone with no
            // usable provider would probe the full catalog on every read and
            // again after every process restart.
            bindingIds[metric] = NO_PROVIDER_ID
            activeProviders.remove(metric)
            persistLocked()
            return null
        }

        bindingIds[metric] = provider.id
        activeProviders[metric] = provider
        persistLocked()
        return provider
    }

    private fun persistLocked() {
        val bindings = JSONObject()
        for (metric in HealthMetric.entries) {
            bindingIds[metric]?.let { bindings.put(metric.key, it) }
        }

        store.healthProviderSelectionJson = JSONObject()
            .put("schemaVersion", SELECTION_SCHEMA_VERSION)
            .put("manufacturer", manufacturer)
            .put("model", model)
            .put("bindings", bindings)
            .put("selectedAt", System.currentTimeMillis())
            .toString()
    }

    companion object {
        /**
         * Bump this when provider-catalog semantics change (for example when a
         * new built-in OEM adapter ships) so previous negative selections are
         * intentionally re-discovered once after the app update.
         */
        const val SELECTION_SCHEMA_VERSION = 1
        private const val NO_PROVIDER_ID = "__none__"
    }
}

data class HealthProviderSnapshot(
    val schemaVersion: Int,
    val manufacturer: String,
    val model: String,
    val bindings: Map<String, String?>,
    val availableProviders: List<String>,
)

/**
 * Central registration point for Android health stores.
 *
 * Health Connect is the generic provider and covers the broadest set of
 * Android devices today. Direct HONOR/HUAWEI/Samsung adapters can be added
 * here once their vendor SDK credentials/partnership configuration is present;
 * the manager and web bridge do not need another redesign.
 */
object AndroidHealthProviderRegistry {
    fun create(context: Context): List<HealthProvider> = listOf(
        HealthConnectProvider(context.applicationContext),
    )
}
