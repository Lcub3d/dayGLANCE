package com.dayglance.app.data.health

import java.time.LocalDate

/**
 * Health capabilities currently consumed by dayGLANCE.
 *
 * Providers are selected per metric rather than per device: a phone may source
 * steps and sleep from different stores without changing the web data model.
 */
enum class HealthMetric {
    STEPS,
    SLEEP,
}

enum class HealthReadStatus(val wireValue: String) {
    OK("ok"),
    NO_DATA("no_data"),
    NO_PERMISSION("no_permission"),
    UNAVAILABLE("unavailable"),
    ERROR("error"),
}

data class HealthRead<T>(
    val status: HealthReadStatus,
    val value: T? = null,
    val providerId: String? = null,
)

data class SleepResult(
    val durationMinutes: Int,
    val stages: List<SleepStage>,
)

data class SleepStage(
    val stage: String,
    val durationMinutes: Int,
)

/**
 * One native health-store adapter.
 *
 * Provider discovery is not a read-time operation. The resolver persists the
 * selected provider id per metric and normal reads return directly to that
 * provider until it explicitly reports [HealthReadStatus.UNAVAILABLE].
 */
interface HealthProvider {
    val id: String
    val supportedMetrics: Set<HealthMetric>

    fun isAvailable(): Boolean

    fun requiredAndroidPermissions(metrics: Set<HealthMetric>): Set<String> = emptySet()

    suspend fun hasPermission(metric: HealthMetric): Boolean

    suspend fun readSteps(date: LocalDate): HealthRead<Int> =
        HealthRead(
            status = HealthReadStatus.UNAVAILABLE,
            providerId = id,
        )

    suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> =
        HealthRead(
            status = HealthReadStatus.UNAVAILABLE,
            providerId = id,
        )
}
