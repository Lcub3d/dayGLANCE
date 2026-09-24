package com.dayglance.app.data.health

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.dayglance.app.data.SharedDataStore
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Platform step fallback backed by the Recording API on mobile.
 *
 * This is local sensor recording, not Google Fit cloud history: it needs no
 * Google account OAuth. Once subscribed, Play services records step deltas in
 * the background and keeps up to ten days of local history for this app.
 */
class LocalRecordingStepsProvider(
    context: Context,
    private val dataStore: SharedDataStore,
) : HealthProvider {

    private val appContext = context.applicationContext
    private val client by lazy { FitnessLocal.getLocalRecordingClient(appContext) }

    override val id: String = ID
    override val supportedMetrics: Set<HealthMetric> = setOf(HealthMetric.STEPS)

    override fun isAvailable(): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(
            appContext,
            LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE,
        ) == ConnectionResult.SUCCESS

    override fun runtimePermissions(metrics: Set<HealthMetric>): Set<String> =
        if (HealthMetric.STEPS in metrics && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            setOf(Manifest.permission.ACTIVITY_RECOGNITION)
        } else {
            emptySet()
        }

    override suspend fun hasPermission(metric: HealthMetric): Boolean {
        if (metric != HealthMetric.STEPS) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.ACTIVITY_RECOGNITION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    override suspend fun readSteps(date: LocalDate): HealthRead<Int> =
        withContext(Dispatchers.IO) {
            if (!isAvailable()) return@withContext unavailable()
            if (!hasPermission(HealthMetric.STEPS)) return@withContext noPermission()

            try {
                ensureSubscribed()

                val zone = ZoneId.systemDefault()
                val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
                val end = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                val request = LocalDataReadRequest.Builder()
                    .setTimeRange(start, end, TimeUnit.MILLISECONDS)
                    .read(LocalDataType.TYPE_STEP_COUNT_DELTA)
                    .build()

                val response = Tasks.await(client.readData(request))
                val points = response
                    .getDataSet(LocalDataType.TYPE_STEP_COUNT_DELTA)
                    .dataPoints

                if (points.isEmpty()) {
                    return@withContext HealthRead(
                        status = HealthReadStatus.NO_DATA,
                        providerId = id,
                    )
                }

                val total = points.sumOf { point ->
                    point.getValue(LocalField.FIELD_STEPS).asInt()
                }
                HealthRead(
                    status = HealthReadStatus.OK,
                    value = total,
                    providerId = id,
                )
            } catch (_: SecurityException) {
                noPermission()
            } catch (_: Exception) {
                // A stale local "subscribed" bit must not make failure durable.
                dataStore.localStepsRecordingSubscribed = false
                HealthRead(
                    status = HealthReadStatus.UNAVAILABLE,
                    providerId = id,
                )
            }
        }

    private fun ensureSubscribed() {
        if (dataStore.localStepsRecordingSubscribed) return
        Tasks.await(client.subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA))
        dataStore.localStepsRecordingSubscribed = true
    }

    private fun <T> unavailable(): HealthRead<T> =
        HealthRead(
            status = HealthReadStatus.UNAVAILABLE,
            providerId = id,
        )

    private fun <T> noPermission(): HealthRead<T> =
        HealthRead(
            status = HealthReadStatus.NO_PERMISSION,
            providerId = id,
        )

    companion object {
        const val ID = "local_recording"
    }
}
