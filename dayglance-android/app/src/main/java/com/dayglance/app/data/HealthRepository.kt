package com.dayglance.app.data

import com.dayglance.app.data.health.HealthConnectProvider
import com.dayglance.app.data.health.HealthMetric
import com.dayglance.app.data.health.HealthProvider
import com.dayglance.app.data.health.HealthRead
import com.dayglance.app.data.health.HealthReadStatus
import com.dayglance.app.data.health.LocalRecordingStepsProvider
import com.dayglance.app.data.health.SleepResult
import com.dayglance.app.data.health.StepProviderChoice
import com.dayglance.app.data.health.StepProviderFacts
import com.dayglance.app.data.health.chooseStepProvider
import android.content.Context
import java.time.LocalDate

/**
 * Stable facade used by the Android bridge and widgets.
 *
 * Step-provider discovery is deliberately one-shot. On first use dayGLANCE:
 *  1. keeps Health Connect when it already contains recent step history;
 *  2. otherwise prefers the platform Local Recording API when available;
 *  3. persists that choice on this device.
 *
 * Sleep remains Health Connect-backed until another concrete sleep provider is
 * added. No manufacturer check lives here: providers are selected by actual
 * platform capability/data rather than a phone-brand table.
 */
class HealthRepository(context: Context) {

    private val appContext = context.applicationContext
    private val dataStore = SharedDataStore(appContext)

    private val healthConnect = HealthConnectProvider(appContext)
    private val localRecordingSteps = LocalRecordingStepsProvider(appContext, dataStore)

    private val providersById: Map<String, HealthProvider> =
        listOf(healthConnect, localRecordingSteps).associateBy { it.id }

    init {
        if (dataStore.healthProviderSelectionVersion != SELECTION_VERSION) {
            dataStore.healthStepsProviderId = null
            dataStore.healthSleepProviderId = null
            dataStore.healthProviderSelectionVersion = SELECTION_VERSION
        }
    }

    /** Health Connect permissions handled by PermissionController. */
    val requiredPermissions: Set<String>
        get() =
            if (healthConnect.isAvailable()) {
                healthConnect.healthConnectPermissions(
                    setOf(HealthMetric.STEPS, HealthMetric.SLEEP)
                )
            } else {
                emptySet()
            }

    /** Ordinary Android runtime permissions handled by ActivityResultContracts. */
    val requiredRuntimePermissions: Set<String>
        get() =
            if (localRecordingSteps.isAvailable()) {
                localRecordingSteps.runtimePermissions(setOf(HealthMetric.STEPS))
            } else {
                emptySet()
            }

    suspend fun hasPermissions(): Boolean =
        hasStepsPermission() && hasSleepPermission()

    suspend fun hasStepsPermission(): Boolean {
        val provider = resolveStepsProvider() ?: return false
        return runCatching {
            provider.hasPermission(HealthMetric.STEPS)
        }.getOrDefault(false)
    }

    suspend fun hasSleepPermission(): Boolean {
        val provider = resolveSleepProvider() ?: return false
        return runCatching {
            provider.hasPermission(HealthMetric.SLEEP)
        }.getOrDefault(false)
    }

    suspend fun getStepsDetailed(date: LocalDate): HealthRead<Int> {
        val provider = resolveStepsProvider()
            ?: return HealthRead(status = HealthReadStatus.UNAVAILABLE)

        val first = safeRead(provider) { it.readSteps(date) }
        if (first.status != HealthReadStatus.UNAVAILABLE) return first

        // Provider availability changed after discovery. Invalidate once and
        // discover again; successful replacement becomes the new persisted path.
        if (dataStore.healthStepsProviderId == provider.id) {
            dataStore.healthStepsProviderId = null
        }
        val replacement = resolveStepsProvider(excludingId = provider.id)
            ?: return first
        return safeRead(replacement) { it.readSteps(date) }
    }

    suspend fun getSleepDetailed(date: LocalDate): HealthRead<SleepResult> {
        val provider = resolveSleepProvider()
            ?: return HealthRead(status = HealthReadStatus.UNAVAILABLE)

        val first = safeRead(provider) { it.readSleep(date) }
        if (first.status != HealthReadStatus.UNAVAILABLE) return first

        if (dataStore.healthSleepProviderId == provider.id) {
            dataStore.healthSleepProviderId = null
        }
        val replacement = resolveSleepProvider(excludingId = provider.id)
            ?: return first
        return safeRead(replacement) { it.readSleep(date) }
    }

    // Compatibility for callers that still expect the original scalar/value shape.
    suspend fun getSteps(date: LocalDate): Int =
        getStepsDetailed(date).value ?: 0

    suspend fun getSleep(date: LocalDate): SleepResult =
        getSleepDetailed(date).value ?: SleepResult(0, emptyList())

    /**
     * Resolve steps once from actual data/capability, not manufacturer.
     *
     * A provider lacking permission is deliberately NOT persisted. That lets the
     * permission flow complete and the next check make the real one-time choice.
     */
    private suspend fun resolveStepsProvider(
        excludingId: String? = null,
    ): HealthProvider? {
        if (excludingId == null) {
            savedProvider(dataStore.healthStepsProviderId, HealthMetric.STEPS)?.let {
                return it
            }
        }

        val healthConnectAvailable =
            healthConnect.id != excludingId && healthConnect.isAvailable()
        val healthConnectHasPermission =
            healthConnectAvailable && healthConnect.hasPermission(HealthMetric.STEPS)
        val healthConnectHasRecentData =
            healthConnectHasPermission && healthConnectHasRecentSteps()

        val localRecordingAvailable =
            localRecordingSteps.id != excludingId && localRecordingSteps.isAvailable()
        val localRecordingHasPermission =
            localRecordingAvailable &&
                localRecordingSteps.hasPermission(HealthMetric.STEPS)

        return when (
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = healthConnectAvailable,
                    healthConnectHasPermission = healthConnectHasPermission,
                    healthConnectHasRecentData = healthConnectHasRecentData,
                    localRecordingAvailable = localRecordingAvailable,
                    localRecordingHasPermission = localRecordingHasPermission,
                    excludedProviderId = excludingId,
                )
            )
        ) {
            StepProviderChoice.HEALTH_CONNECT -> {
                // Persist only after its read permission exists. Before that,
                // leave discovery open so the permission flow can complete.
                if (healthConnectHasPermission) {
                    dataStore.healthStepsProviderId = healthConnect.id
                }
                healthConnect
            }
            StepProviderChoice.LOCAL_RECORDING -> {
                if (localRecordingHasPermission) {
                    dataStore.healthStepsProviderId = localRecordingSteps.id
                }
                localRecordingSteps
            }
            StepProviderChoice.NONE -> null
        }
    }

    private fun resolveSleepProvider(
        excludingId: String? = null,
    ): HealthProvider? {
        if (excludingId == null) {
            savedProvider(dataStore.healthSleepProviderId, HealthMetric.SLEEP)?.let {
                return it
            }
        }

        if (healthConnect.id != excludingId && healthConnect.isAvailable()) {
            dataStore.healthSleepProviderId = healthConnect.id
            return healthConnect
        }

        return null
    }

    private suspend fun healthConnectHasRecentSteps(): Boolean {
        val today = LocalDate.now()
        return (0L..2L).any { daysBack ->
            healthConnect.readSteps(today.minusDays(daysBack)).status == HealthReadStatus.OK
        }
    }

    private fun savedProvider(
        id: String?,
        metric: HealthMetric,
    ): HealthProvider? =
        id?.let(providersById::get)
            ?.takeIf { metric in it.supportedMetrics }
            ?.takeIf { runCatching { it.isAvailable() }.getOrDefault(false) }

    private suspend fun <T> safeRead(
        provider: HealthProvider,
        read: suspend (HealthProvider) -> HealthRead<T>,
    ): HealthRead<T> =
        runCatching { read(provider) }.getOrElse {
            HealthRead(
                status = HealthReadStatus.ERROR,
                providerId = provider.id,
            )
        }

    companion object {
        /**
         * Bump only when discovery semantics/provider order changes. Existing
         * devices then discard the old binding and perform one fresh discovery.
         */
        const val SELECTION_VERSION = 2
    }
}
