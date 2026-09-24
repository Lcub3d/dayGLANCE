package com.dayglance.app.data.health

import java.time.LocalDate

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
 * One concrete native health source.
 *
 * dayGLANCE selects a provider per metric and persists that choice locally.
 * Normal reads therefore do not re-probe every installed health source.
 */
interface HealthProvider {
    val id: String
    val supportedMetrics: Set<HealthMetric>

    fun isAvailable(): Boolean

    fun healthConnectPermissions(metrics: Set<HealthMetric>): Set<String> = emptySet()

    fun runtimePermissions(metrics: Set<HealthMetric>): Set<String> = emptySet()

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
