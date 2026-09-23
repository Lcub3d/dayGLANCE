package com.dayglance.app.data.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

/**
 * Generic Android provider backed by Health Connect.
 *
 * This remains the broad default because many OEM health apps can publish into
 * Health Connect. OEM-native adapters can be registered alongside it for
 * devices/regions where Health Connect is absent or does not receive the
 * vendor's data.
 */
class HealthConnectProvider(context: Context) : HealthProvider {

    override val id: String = HealthProviderSelector.HEALTH_CONNECT
    override val displayName: String = "Health Connect"
    override val capabilities: Set<HealthMetric> =
        setOf(HealthMetric.STEPS, HealthMetric.SLEEP)

    private val sdkStatus: Int = HealthConnectClient.getSdkStatus(context)

    private val client: HealthConnectClient? = if (
        sdkStatus == HealthConnectClient.SDK_AVAILABLE
    ) {
        HealthConnectClient.getOrCreate(context)
    } else {
        null
    }

    override fun isAvailable(): Boolean = client != null

    override fun diagnostics(): Map<String, String> = mapOf(
        "sdkStatus" to sdkStatus.toString(),
        "sdkAvailable" to (sdkStatus == HealthConnectClient.SDK_AVAILABLE).toString(),
    )

    override fun requiredAndroidPermissions(metrics: Set<HealthMetric>): Set<String> =
        buildSet {
            if (HealthMetric.STEPS in metrics) {
                add(HealthPermission.getReadPermission(StepsRecord::class))
            }
            if (HealthMetric.SLEEP in metrics) {
                add(HealthPermission.getReadPermission(SleepSessionRecord::class))
            }
        }

    override suspend fun hasPermission(metric: HealthMetric): Boolean =
        withContext(Dispatchers.IO) {
            val c = client ?: return@withContext false
            val permission = when (metric) {
                HealthMetric.STEPS -> HealthPermission.getReadPermission(StepsRecord::class)
                HealthMetric.SLEEP -> HealthPermission.getReadPermission(SleepSessionRecord::class)
            }
            try {
                permission in c.permissionController.getGrantedPermissions()
            } catch (_: Exception) {
                false
            }
        }

    override suspend fun readSteps(date: LocalDate): HealthRead<Int> =
        withContext(Dispatchers.IO) {
            val c = client ?: return@withContext HealthRead(
                status = HealthReadStatus.PROVIDER_UNAVAILABLE,
                providerId = id,
            )
            if (!hasPermission(HealthMetric.STEPS)) {
                return@withContext HealthRead(
                    status = HealthReadStatus.NO_PERMISSION,
                    providerId = id,
                )
            }

            val zone = ZoneId.systemDefault()
            val start = date.atStartOfDay(zone).toInstant()
            val end = date.plusDays(1).atStartOfDay(zone).toInstant()

            try {
                // Aggregate prevents double-counting overlapping source records.
                val response = c.aggregate(
                    AggregateRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                    )
                )
                val value = response[StepsRecord.COUNT_TOTAL]?.toInt()
                if (value == null) {
                    HealthRead(
                        status = HealthReadStatus.NO_DATA,
                        providerId = id,
                    )
                } else {
                    HealthRead(
                        status = HealthReadStatus.OK,
                        value = value,
                        providerId = id,
                    )
                }
            } catch (e: SecurityException) {
                HealthRead(
                    status = HealthReadStatus.NO_PERMISSION,
                    providerId = id,
                    message = e.message,
                )
            } catch (e: Exception) {
                HealthRead(
                    status = HealthReadStatus.ERROR,
                    providerId = id,
                    message = e.message,
                )
            }
        }

    override suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> =
        withContext(Dispatchers.IO) {
            val c = client ?: return@withContext HealthRead(
                status = HealthReadStatus.PROVIDER_UNAVAILABLE,
                providerId = id,
            )
            if (!hasPermission(HealthMetric.SLEEP)) {
                return@withContext HealthRead(
                    status = HealthReadStatus.NO_PERMISSION,
                    providerId = id,
                )
            }

            val zone = ZoneId.systemDefault()
            // Capture the night leading into date: previous noon -> date noon.
            val start = date.minusDays(1).atTime(12, 0).atZone(zone).toInstant()
            val end = date.atTime(12, 0).atZone(zone).toInstant()

            try {
                val records = c.readRecords(
                    ReadRecordsRequest(
                        SleepSessionRecord::class,
                        TimeRangeFilter.between(start, end),
                    )
                ).records

                if (records.isEmpty()) {
                    return@withContext HealthRead(
                        status = HealthReadStatus.NO_DATA,
                        providerId = id,
                    )
                }

                val totalMinutes = records.sumOf { session ->
                    (session.endTime.epochSecond - session.startTime.epochSecond) / 60
                }.toInt()
                val stages = records.flatMap { session ->
                    session.stages.map { stage ->
                        SleepStage(
                            stage = stageName(stage.stage),
                            durationMinutes =
                                ((stage.endTime.epochSecond - stage.startTime.epochSecond) / 60).toInt(),
                        )
                    }
                }

                HealthRead(
                    status = HealthReadStatus.OK,
                    value = SleepResult(totalMinutes, stages),
                    providerId = id,
                )
            } catch (e: SecurityException) {
                HealthRead(
                    status = HealthReadStatus.NO_PERMISSION,
                    providerId = id,
                    message = e.message,
                )
            } catch (e: Exception) {
                HealthRead(
                    status = HealthReadStatus.ERROR,
                    providerId = id,
                    message = e.message,
                )
            }
        }

    private fun stageName(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        else -> "unknown"
    }
}
