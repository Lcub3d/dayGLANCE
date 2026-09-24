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

class HealthConnectProvider(context: Context) : HealthProvider {

    override val id: String = ID
    override val supportedMetrics: Set<HealthMetric> =
        setOf(HealthMetric.STEPS, HealthMetric.SLEEP)

    private val client: HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
            HealthConnectClient.getOrCreate(context)
        } else {
            null
        }

    override fun isAvailable(): Boolean = client != null

    override fun healthConnectPermissions(metrics: Set<HealthMetric>): Set<String> =
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
            val c = client ?: return@withContext unavailable()
            if (!hasPermission(HealthMetric.STEPS)) return@withContext noPermission()

            val zone = ZoneId.systemDefault()
            val start = date.atStartOfDay(zone).toInstant()
            val end = date.plusDays(1).atStartOfDay(zone).toInstant()

            try {
                // Aggregation avoids double-counting overlapping writers.
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
            } catch (_: SecurityException) {
                noPermission()
            } catch (_: Exception) {
                HealthRead(
                    status = HealthReadStatus.ERROR,
                    providerId = id,
                )
            }
        }

    override suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> =
        withContext(Dispatchers.IO) {
            val c = client ?: return@withContext unavailable()
            if (!hasPermission(HealthMetric.SLEEP)) return@withContext noPermission()

            val zone = ZoneId.systemDefault()
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

                val durationMinutes = records.sumOf { session ->
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
                    value = SleepResult(durationMinutes, stages),
                    providerId = id,
                )
            } catch (_: SecurityException) {
                noPermission()
            } catch (_: Exception) {
                HealthRead(
                    status = HealthReadStatus.ERROR,
                    providerId = id,
                )
            }
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

    private fun stageName(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        else -> "unknown"
    }

    companion object {
        const val ID = "health_connect"
    }
}
