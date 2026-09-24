package com.dayglance.app.data.health

import android.content.Context
import android.os.Build
import com.hihonor.mcs.fitness.health.HealthKit
import com.hihonor.mcs.fitness.health.constants.DataType
import com.hihonor.mcs.fitness.health.data.HonorSignInAccount
import com.hihonor.mcs.fitness.health.datastore.QueryRequest
import com.hihonor.mcs.fitness.health.datastruct.SleepField
import com.hihonor.mcs.fitness.health.datastruct.StepStatisticField
import kotlinx.coroutines.suspendCancellableCoroutine
import java.time.LocalDate
import java.time.ZoneId
import kotlin.coroutines.resume

class HonorHealthProvider(
    context: Context,
    private val appId: String,
    private val tokenExchangeUrl: String,
) : HealthProvider {

    override val id = ID
    override val metrics = setOf(HealthMetric.STEPS, HealthMetric.SLEEP)
    override val authorization = HealthAuthorization.PROVIDER

    private val appContext = context.applicationContext
    private val credentials = HonorHealthCredentialStore(appContext)
    private val tokenClient = HonorTokenClient(tokenExchangeUrl)

    override fun isAvailable(): Boolean =
        Build.MANUFACTURER.equals("HONOR", ignoreCase = true) &&
            appId.isNotBlank() &&
            tokenExchangeUrl.isNotBlank()

    override suspend fun hasPermission(metric: HealthMetric): Boolean =
        credentials.load() != null

    override suspend fun readSteps(date: LocalDate): HealthRead<Int> {
        val account = account() ?: return HealthRead(HealthReadStatus.AUTH_REQUIRED)
        val zone = ZoneId.systemDefault()
        val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val request = QueryRequest(DataType.SAMPLE_STEPS_STATISTIC, start, end)

        return suspendCancellableCoroutine { continuation ->
            HealthKit.getDataStoreClient(appContext)
                .querySampleData(account, request)
                .addOnSuccessListener { response ->
                    if (!continuation.isActive) return@addOnSuccessListener
                    val rows = response.dataList
                    if (rows.isNullOrEmpty()) {
                        continuation.resume(HealthRead(HealthReadStatus.NO_DATA))
                        return@addOnSuccessListener
                    }
                    // SAMPLE_STEPS_STATISTIC is already HONOR's cumulative
                    // total for the requested day. Do not sum statistic rows again.
                    val steps = rows.firstNotNullOfOrNull {
                        it.getInteger(StepStatisticField.FIELD_STEP_NAME)
                    }
                    if (steps == null) {
                        continuation.resume(HealthRead(HealthReadStatus.NO_DATA))
                    } else {
                        continuation.resume(HealthRead(HealthReadStatus.OK, steps))
                    }
                }
                .addOnFailureListener {
                    if (continuation.isActive) {
                        continuation.resume(HealthRead(HealthReadStatus.ERROR))
                    }
                }
        }
    }

    override suspend fun readSleep(date: LocalDate): HealthRead<SleepResult> {
        val account = account() ?: return HealthRead(HealthReadStatus.AUTH_REQUIRED)
        val zone = ZoneId.systemDefault()
        val start = date.minusDays(1).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        val end = date.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        val request = QueryRequest(DataType.RECORD_SLEEP, start, end)

        return suspendCancellableCoroutine { continuation ->
            HealthKit.getDataStoreClient(appContext)
                .querySampleRecord(account, request)
                .addOnSuccessListener { response ->
                    if (!continuation.isActive) return@addOnSuccessListener
                    val records = response.dataList
                    if (records.isNullOrEmpty()) {
                        continuation.resume(HealthRead(HealthReadStatus.NO_DATA))
                        return@addOnSuccessListener
                    }

                    var deep = 0
                    var light = 0
                    var rem = 0
                    var awake = 0
                    var naps = 0
                    var fallbackMinutes = 0

                    records.forEach { record ->
                        val summary = record.summary
                        val recordDeep = summary?.getInteger(SleepField.FIELD_DEEP_SLEEP_NAME) ?: 0
                        val recordLight = summary?.getInteger(SleepField.FIELD_LIGHT_SLEEP_NAME) ?: 0
                        val recordRem = summary?.getInteger(SleepField.FIELD_REM_SLEEP_NAME) ?: 0
                        val recordAwake = summary?.getInteger(SleepField.FIELD_WIDE_AWAKE_NAME) ?: 0
                        val recordNaps = summary?.getInteger(SleepField.FIELD_SPORADIC_NAPS_NAME) ?: 0

                        deep += recordDeep
                        light += recordLight
                        rem += recordRem
                        awake += recordAwake
                        naps += recordNaps

                        if (recordDeep + recordLight + recordRem + recordNaps == 0) {
                            val sleepAt = summary?.getLong(SleepField.FIELD_SLEEP_TIMESTAMP_NAME)
                                ?: record.startTime
                            val wakeAt = summary?.getLong(SleepField.FIELD_WAKEUP_TIMESTAMP_NAME)
                                ?: record.endTime
                            fallbackMinutes += ((wakeAt - sleepAt).coerceAtLeast(0L) / 60_000L).toInt()
                        }
                    }

                    val stages = buildList {
                        if (awake > 0) add(SleepStage("awake", awake))
                        if (light > 0) add(SleepStage("light", light))
                        if (deep > 0) add(SleepStage("deep", deep))
                        if (rem > 0) add(SleepStage("rem", rem))
                        if (naps > 0) add(SleepStage("sleeping", naps))
                    }
                    val measuredMinutes = deep + light + rem + naps
                    val totalMinutes = if (measuredMinutes > 0) measuredMinutes else fallbackMinutes

                    continuation.resume(
                        HealthRead(
                            HealthReadStatus.OK,
                            SleepResult(totalMinutes, stages),
                        )
                    )
                }
                .addOnFailureListener {
                    if (continuation.isActive) {
                        continuation.resume(HealthRead(HealthReadStatus.ERROR))
                    }
                }
        }
    }

    private suspend fun account(): HonorSignInAccount? {
        val current = credentials.load() ?: return null
        val now = System.currentTimeMillis()
        val usable = if (current.expiresAtMillis - now > REFRESH_MARGIN_MS) {
            current
        } else {
            tokenClient.refresh(current)?.also(credentials::save)
                ?: current.takeIf { it.expiresAtMillis > now }
        }
        return usable?.let {
            HonorSignInAccount(appId, it.openId, it.accessToken)
        }
    }

    companion object {
        const val ID = "honor_health"
        private const val REFRESH_MARGIN_MS = 2 * 60 * 1000L
    }
}
