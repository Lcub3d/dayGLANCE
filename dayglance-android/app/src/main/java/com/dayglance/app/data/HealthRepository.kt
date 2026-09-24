package com.dayglance.app.data

import android.content.Context
import com.dayglance.app.data.health.AndroidHealthProviders
import com.dayglance.app.data.health.HealthMetric
import com.dayglance.app.data.health.HealthProvider
import com.dayglance.app.data.health.HealthProviderResolver
import com.dayglance.app.data.health.HealthRead
import com.dayglance.app.data.health.HealthReadStatus
import com.dayglance.app.data.health.SleepResult
import java.time.LocalDate

/**
 * Stable Android health facade used by the WebView bridge and widgets.
 *
 * Concrete stores live behind HealthProvider. Provider resolution happens once
 * per metric and is persisted in SharedDataStore; normal reads return directly
 * to the saved provider instead of re-probing the device.
 */
class HealthRepository(context: Context) {

    private val appContext = context.applicationContext
    private val resolver = HealthProviderResolver(
        dataStore = SharedDataStore(appContext),
        providers = AndroidHealthProviders.create(appContext),
    )

    /**
     * Runtime permissions required by the providers selected for dayGLANCE's
     * current native health metrics. Vendor account authorization is deliberately
     * not modelled as an Android runtime permission.
     */
    val requiredPermissions: Set<String>
        get() {
            val byProvider = HealthMetric.entries
                .mapNotNull { metric -> resolver.providerFor(metric)?.let { it to metric } }
                .groupBy({ it.first }, { it.second })

            return byProvider.entries.flatMapTo(mutableSetOf()) { (provider, metrics) ->
                provider.requiredAndroidPermissions(metrics.toSet())
            }
        }

    suspend fun hasPermissions(): Boolean =
        hasStepsPermission() && hasSleepPermission()

    suspend fun hasStepsPermission(): Boolean =
        hasPermission(HealthMetric.STEPS)

    suspend fun hasSleepPermission(): Boolean =
        hasPermission(HealthMetric.SLEEP)

    suspend fun getStepsDetailed(date: LocalDate): HealthRead<Int> =
        readWithFailover(HealthMetric.STEPS) { it.readSteps(date) }

    suspend fun getSleepDetailed(date: LocalDate): HealthRead<SleepResult> =
        readWithFailover(HealthMetric.SLEEP) { it.readSleep(date) }

    // Legacy callers such as WidgetUpdateWorker still expect a scalar. The
    // bridge uses the detailed methods so "no data" is no longer serialized as
    // a successful zero into the web habit log.
    suspend fun getSteps(date: LocalDate): Int =
        getStepsDetailed(date).value ?: 0

    suspend fun getSleep(date: LocalDate): SleepResult =
        getSleepDetailed(date).value ?: SleepResult(0, emptyList())

    private suspend fun hasPermission(metric: HealthMetric): Boolean {
        val provider = resolver.providerFor(metric) ?: return false
        return runCatching { provider.hasPermission(metric) }.getOrDefault(false)
    }

    private suspend fun <T> readWithFailover(
        metric: HealthMetric,
        read: suspend (HealthProvider) -> HealthRead<T>,
    ): HealthRead<T> {
        val provider = resolver.providerFor(metric)
            ?: return HealthRead(status = HealthReadStatus.UNAVAILABLE)

        val first = runCatching { read(provider) }.getOrElse {
            HealthRead(
                status = HealthReadStatus.ERROR,
                providerId = provider.id,
            )
        }
        if (first.status != HealthReadStatus.UNAVAILABLE) return first

        // A selected provider became unavailable. Forget only that metric and
        // try the next concrete adapter once; future reads then use the new
        // persisted choice directly.
        resolver.invalidate(metric, provider.id)
        val replacement = resolver.providerFor(metric, excludingId = provider.id)
            ?: return first

        return runCatching { read(replacement) }.getOrElse {
            HealthRead(
                status = HealthReadStatus.ERROR,
                providerId = replacement.id,
            )
        }
    }
}
