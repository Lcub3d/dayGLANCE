package com.dayglance.app.data.health

import android.content.Context
import com.dayglance.app.data.SharedDataStore
import java.time.LocalDate

class HealthProviderManager(
    context: Context,
    private val providers: List<HealthProvider> = listOf(
        HealthConnectProvider(context.applicationContext),
    ),
) {
    private val store = SharedDataStore(context.applicationContext)

    init {
        if (store.healthProviderSelectionVersion != SELECTION_VERSION) {
            store.healthStepsProvider = null
            store.healthSleepProvider = null
            store.healthProviderSelectionVersion = SELECTION_VERSION
        }
    }

    val requiredPermissions: Set<String>
        get() {
            val byProvider = HealthMetric.entries
                .mapNotNull { metric -> providerFor(metric)?.let { it to metric } }
                .groupBy({ it.first }, { it.second })
            return byProvider.entries.flatMapTo(mutableSetOf()) { (provider, metrics) ->
                provider.requiredAndroidPermissions(metrics.toSet())
            }
        }

    suspend fun hasPermission(metric: HealthMetric): Boolean =
        providerFor(metric)?.hasPermission(metric) ?: false

    suspend fun readSteps(date: LocalDate): HealthRead<Int> =
        read(HealthMetric.STEPS) { it.readSteps(date) }

    suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> =
        read(HealthMetric.SLEEP) { it.readSleep(date) }

    suspend fun providerAuthorizationIdsRequired(): Set<String> {
        val ids = linkedSetOf<String>()
        for (metric in HealthMetric.entries) {
            val provider = providerFor(metric) ?: continue
            if (
                provider.authorization == HealthAuthorization.PROVIDER &&
                !provider.hasPermission(metric)
            ) {
                ids += provider.id
            }
        }
        return ids
    }

    private suspend fun <T> read(
        metric: HealthMetric,
        block: suspend (HealthProvider) -> HealthRead<T>,
    ): HealthRead<T> {
        val provider = providerFor(metric) ?: return HealthRead(HealthReadStatus.UNAVAILABLE)
        val result = block(provider)
        if (result.status != HealthReadStatus.UNAVAILABLE) return result

        setSavedProvider(metric, null)
        val replacement = resolve(metric, excludedId = provider.id)
            ?: return result
        return block(replacement)
    }

    private fun providerFor(metric: HealthMetric): HealthProvider? {
        val savedId = savedProvider(metric)
        if (savedId == NO_PROVIDER) return null
        if (savedId != null) {
            providers.firstOrNull { it.id == savedId && metric in it.metrics }?.let { return it }
            setSavedProvider(metric, null)
        }
        return resolve(metric)
    }

    private fun resolve(metric: HealthMetric, excludedId: String? = null): HealthProvider? {
        val provider = selectHealthProvider(metric, providers, excludedId)
        setSavedProvider(metric, provider?.id ?: NO_PROVIDER)
        return provider
    }

    private fun savedProvider(metric: HealthMetric): String? = when (metric) {
        HealthMetric.STEPS -> store.healthStepsProvider
        HealthMetric.SLEEP -> store.healthSleepProvider
    }

    private fun setSavedProvider(metric: HealthMetric, value: String?) {
        when (metric) {
            HealthMetric.STEPS -> store.healthStepsProvider = value
            HealthMetric.SLEEP -> store.healthSleepProvider = value
        }
    }

    companion object {
        const val SELECTION_VERSION = 2
        private const val NO_PROVIDER = "__none__"
    }
}


internal fun selectHealthProvider(
    metric: HealthMetric,
    providers: List<HealthProvider>,
    excludedId: String? = null,
): HealthProvider? = providers.firstOrNull {
    it.id != excludedId &&
        metric in it.metrics &&
        runCatching { it.isAvailable() }.getOrDefault(false)
}
