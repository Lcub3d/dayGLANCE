package com.dayglance.app.data

import android.content.Context
import com.dayglance.app.data.health.HealthMetric
import com.dayglance.app.data.health.HealthProviderManager
import com.dayglance.app.data.health.HealthProviderSnapshot
import com.dayglance.app.data.health.HealthRead
import com.dayglance.app.data.health.SleepResult
import java.time.LocalDate

/**
 * Stable facade used by the existing bridge/widget code.
 *
 * Provider discovery/binding lives in [HealthProviderManager]. This class keeps
 * the old getSteps()/getSleep() return shape for compatibility while exposing
 * detailed reads so the bridge can distinguish a real zero from no data,
 * missing permission, or an unavailable provider.
 */
class HealthRepository(context: Context) {

    private val manager = HealthProviderManager(context.applicationContext)

    val requiredPermissions: Set<String>
        get() = manager.requiredAndroidPermissions()

    suspend fun hasPermissions(): Boolean =
        hasStepsPermission() && hasSleepPermission()

    suspend fun hasStepsPermission(): Boolean =
        manager.hasPermission(HealthMetric.STEPS)

    suspend fun hasSleepPermission(): Boolean =
        manager.hasPermission(HealthMetric.SLEEP)

    suspend fun getStepsDetailed(date: LocalDate): HealthRead<Int> =
        manager.readSteps(date)

    suspend fun getSleepDetailed(date: LocalDate): HealthRead<SleepResult> =
        manager.readSleep(date)

    /**
     * Legacy compatibility for callers such as the widget worker.
     * Detailed status remains available through getStepsDetailed().
     */
    suspend fun getSteps(date: LocalDate): Int =
        getStepsDetailed(date).value ?: 0

    /**
     * Legacy compatibility for the existing JS payload shape.
     * Detailed status remains available through getSleepDetailed().
     */
    suspend fun getSleep(date: LocalDate): SleepResult =
        getSleepDetailed(date).value ?: SleepResult(0, emptyList())

    fun getProviderSnapshot(): HealthProviderSnapshot =
        manager.snapshot()

    fun resetProviderSelection() =
        manager.resetSelection()
}
