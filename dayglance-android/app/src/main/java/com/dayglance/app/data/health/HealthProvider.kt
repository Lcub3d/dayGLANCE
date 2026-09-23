package com.dayglance.app.data.health

import java.time.LocalDate

enum class HealthMetric { STEPS, SLEEP }

enum class HealthAuthorization { ANDROID_PERMISSION, PROVIDER }

enum class HealthReadStatus {
    OK,
    NO_DATA,
    NO_PERMISSION,
    AUTH_REQUIRED,
    UNAVAILABLE,
    ERROR,
}

data class HealthRead<T>(
    val status: HealthReadStatus,
    val value: T? = null,
)

data class SleepResult(
    val durationMinutes: Int,
    val stages: List<SleepStage>,
)

data class SleepStage(
    val stage: String,
    val durationMinutes: Int,
)

interface HealthProvider {
    val id: String
    val metrics: Set<HealthMetric>
    val authorization: HealthAuthorization

    fun isAvailable(): Boolean

    fun requiredAndroidPermissions(metrics: Set<HealthMetric>): Set<String> = emptySet()

    suspend fun hasPermission(metric: HealthMetric): Boolean

    suspend fun readSteps(date: LocalDate): HealthRead<Int>

    suspend fun readSleep(date: LocalDate): HealthRead<SleepResult>
}
