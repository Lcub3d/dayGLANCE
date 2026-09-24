package com.dayglance.app.data.health

import com.dayglance.app.data.SharedDataStore

/**
 * Resolves a native health provider once, then remembers that decision locally.
 *
 * The provider list is already ordered by platform preference. Manufacturer
 * checks belong where concrete adapters are registered, not in this resolver.
 * This keeps selection deterministic and keeps normal reads free of probing.
 */
class HealthProviderResolver(
    private val dataStore: SharedDataStore,
    providers: List<HealthProvider>,
) {
    private val providersById = providers.associateBy { it.id }
    private val orderedProviders = providers.toList()

    init {
        if (dataStore.healthProviderSelectionVersion != SELECTION_VERSION) {
            dataStore.healthStepsProviderId = null
            dataStore.healthSleepProviderId = null
            dataStore.healthProviderSelectionVersion = SELECTION_VERSION
        }
    }

    @Synchronized
    fun providerFor(metric: HealthMetric, excludingId: String? = null): HealthProvider? {
        val savedId = savedProviderId(metric)
        if (excludingId == null && savedId != null) {
            if (savedId == NONE) return null

            providersById[savedId]
                ?.takeIf { metric in it.supportedMetrics }
                ?.let { return it }

            // The app no longer contains the adapter that wrote this binding.
            saveProviderId(metric, null)
        }

        val selected = selectHealthProvider(metric, orderedProviders, excludingId)
        saveProviderId(metric, selected?.id ?: NONE)
        return selected
    }

    @Synchronized
    fun invalidate(metric: HealthMetric, providerId: String) {
        if (savedProviderId(metric) == providerId) {
            saveProviderId(metric, null)
        }
    }

    private fun savedProviderId(metric: HealthMetric): String? = when (metric) {
        HealthMetric.STEPS -> dataStore.healthStepsProviderId
        HealthMetric.SLEEP -> dataStore.healthSleepProviderId
    }

    private fun saveProviderId(metric: HealthMetric, providerId: String?) {
        when (metric) {
            HealthMetric.STEPS -> dataStore.healthStepsProviderId = providerId
            HealthMetric.SLEEP -> dataStore.healthSleepProviderId = providerId
        }
    }

    companion object {
        /**
         * Bump only when provider ordering/availability semantics change.
         * Each device will then discard its old bindings and discover once.
         */
        const val SELECTION_VERSION = 1
        private const val NONE = "__none__"
    }
}


internal fun selectHealthProvider(
    metric: HealthMetric,
    providers: List<HealthProvider>,
    excludingId: String? = null,
): HealthProvider? =
    providers.firstOrNull {
        it.id != excludingId &&
            metric in it.supportedMetrics &&
            runCatching { it.isAvailable() }.getOrDefault(false)
    }
