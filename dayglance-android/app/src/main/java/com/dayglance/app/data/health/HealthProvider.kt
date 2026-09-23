package com.dayglance.app.data.health

import java.time.LocalDate

/**
 * Native health metrics currently consumed by dayGLANCE.
 *
 * Keep provider selection keyed by metric rather than by phone brand so one
 * device may source different metrics from different stores if needed.
 */
enum class HealthMetric(val key: String) {
    STEPS("steps"),
    SLEEP("sleep"),
}

enum class HealthReadStatus(val key: String) {
    OK("ok"),
    NO_DATA("no_data"),
    NO_PERMISSION("no_permission"),
    PROVIDER_UNAVAILABLE("provider_unavailable"),
    ERROR("error"),
}

data class SleepStage(
    val stage: String,
    val durationMinutes: Int,
)

data class SleepResult(
    val durationMinutes: Int,
    val stages: List<SleepStage>,
)

data class HealthRead<T>(
    val status: HealthReadStatus,
    val value: T? = null,
    val providerId: String? = null,
    val message: String? = null,
)

/**
 * Adapter contract for one Android health store.
 *
 * Implementations should report NO_DATA separately from a real zero value.
 * PROVIDER_UNAVAILABLE is reserved for a store/app that cannot currently be
 * reached; the manager uses only that status to invalidate a persisted binding
 * and perform one re-discovery.
 */
interface HealthProvider {
    val id: String
    val displayName: String
    val capabilities: Set<HealthMetric>

    /**
     * Cheap availability probe used only during first discovery/re-discovery,
     * not on every data read.
     */
    fun isAvailable(): Boolean

    /**
     * Cheap provider-specific diagnostics used only by the manual diagnostics
     * panel. Normal reads never call this.
     */
    fun diagnostics(): Map<String, String> = emptyMap()

    /**
     * Android runtime permissions, if this provider uses them. Vendor account
     * SDKs may return an empty set and own their authorization flow separately.
     */
    fun requiredAndroidPermissions(metrics: Set<HealthMetric>): Set<String> = emptySet()

    suspend fun hasPermission(metric: HealthMetric): Boolean

    suspend fun readSteps(date: LocalDate): HealthRead<Int> =
        HealthRead(
            status = HealthReadStatus.ERROR,
            providerId = id,
            message = "steps_not_supported",
        )

    suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> =
        HealthRead(
            status = HealthReadStatus.ERROR,
            providerId = id,
            message = "sleep_not_supported",
        )
}
