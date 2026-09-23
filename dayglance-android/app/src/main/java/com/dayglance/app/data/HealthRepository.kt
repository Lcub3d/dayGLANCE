package com.dayglance.app.data

import android.content.Context
import com.dayglance.app.data.health.HealthMetric
import com.dayglance.app.data.health.HealthProviderManager
import com.dayglance.app.data.health.HealthReadStatus
import com.dayglance.app.data.health.SleepResult
import java.time.LocalDate

class HealthRepository(context: Context) {

    private val providers = HealthProviderManager(context.applicationContext)

    val requiredPermissions: Set<String>
        get() = providers.requiredPermissions

    suspend fun hasPermissions(): Boolean =
        hasStepsPermission() && hasSleepPermission()

    suspend fun hasStepsPermission(): Boolean =
        providers.hasPermission(HealthMetric.STEPS)

    suspend fun hasSleepPermission(): Boolean =
        providers.hasPermission(HealthMetric.SLEEP)

    fun providerAuthorizationIds(): Set<String> =
        providers.providerAuthorizationIds()

    suspend fun getSteps(date: LocalDate): Int {
        val result = providers.readSteps(date)
        return if (result.status == HealthReadStatus.OK) result.value ?: 0 else 0
    }

    suspend fun getSleep(date: LocalDate): SleepResult {
        val result = providers.readSleep(date)
        return if (result.status == HealthReadStatus.OK) {
            result.value ?: SleepResult(0, emptyList())
        } else {
            SleepResult(0, emptyList())
        }
    }

}
