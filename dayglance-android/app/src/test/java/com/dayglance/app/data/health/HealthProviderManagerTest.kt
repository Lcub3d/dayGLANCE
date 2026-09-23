package com.dayglance.app.data.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class HealthProviderManagerTest {

    @Test
    fun selection_uses_first_available_provider_for_metric() {
        val first = FakeProvider("first", setOf(HealthMetric.STEPS), available = false)
        val second = FakeProvider("second", setOf(HealthMetric.STEPS))

        assertEquals(
            second,
            selectHealthProvider(HealthMetric.STEPS, listOf(first, second)),
        )
    }

    @Test
    fun selection_skips_unsupported_and_excluded_providers() {
        val stepsOnly = FakeProvider("steps", setOf(HealthMetric.STEPS))
        val sleep = FakeProvider("sleep", setOf(HealthMetric.SLEEP))
        val fallback = FakeProvider("fallback", setOf(HealthMetric.SLEEP))

        assertEquals(
            fallback,
            selectHealthProvider(
                HealthMetric.SLEEP,
                listOf(stepsOnly, sleep, fallback),
                excludedId = "sleep",
            ),
        )
    }

    @Test
    fun selection_returns_null_when_no_provider_is_available() {
        assertNull(
            selectHealthProvider(
                HealthMetric.SLEEP,
                listOf(FakeProvider("steps", setOf(HealthMetric.STEPS))),
            ),
        )
    }

    private class FakeProvider(
        override val id: String,
        override val metrics: Set<HealthMetric>,
        private val available: Boolean = true,
    ) : HealthProvider {
        override fun isAvailable(): Boolean = available
        override suspend fun hasPermission(metric: HealthMetric): Boolean = true
        override suspend fun readSteps(date: LocalDate) =
            HealthRead(HealthReadStatus.NO_DATA)
        override suspend fun readSleep(date: LocalDate) =
            HealthRead<SleepResult>(HealthReadStatus.NO_DATA)
    }
}
