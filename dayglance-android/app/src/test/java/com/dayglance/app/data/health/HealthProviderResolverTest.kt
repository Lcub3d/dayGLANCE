package com.dayglance.app.data.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HealthProviderResolverTest {

    private class FakeProvider(
        override val id: String,
        override val supportedMetrics: Set<HealthMetric>,
        private val available: Boolean = true,
    ) : HealthProvider {
        override fun isAvailable(): Boolean = available
        override suspend fun hasPermission(metric: HealthMetric): Boolean = true
    }

    @Test
    fun selectsFirstAvailableProviderInRegistryOrder() {
        val selected = selectHealthProvider(
            metric = HealthMetric.STEPS,
            providers = listOf(
                FakeProvider("preferred", setOf(HealthMetric.STEPS), available = true),
                FakeProvider("fallback", setOf(HealthMetric.STEPS), available = true),
            ),
        )

        assertEquals("preferred", selected?.id)
    }

    @Test
    fun skipsUnavailableAndUnsupportedProviders() {
        val selected = selectHealthProvider(
            metric = HealthMetric.SLEEP,
            providers = listOf(
                FakeProvider("steps-only", setOf(HealthMetric.STEPS)),
                FakeProvider("unavailable", setOf(HealthMetric.SLEEP), available = false),
                FakeProvider("sleep", setOf(HealthMetric.SLEEP)),
            ),
        )

        assertEquals("sleep", selected?.id)
    }

    @Test
    fun exclusionEnablesSingleFailoverWithoutReusingFailedProvider() {
        val selected = selectHealthProvider(
            metric = HealthMetric.STEPS,
            providers = listOf(
                FakeProvider("failed", setOf(HealthMetric.STEPS)),
                FakeProvider("fallback", setOf(HealthMetric.STEPS)),
            ),
            excludingId = "failed",
        )

        assertEquals("fallback", selected?.id)
    }

    @Test
    fun returnsNullWhenNoProviderCanServeMetric() {
        val selected = selectHealthProvider(
            metric = HealthMetric.SLEEP,
            providers = listOf(
                FakeProvider("steps-only", setOf(HealthMetric.STEPS)),
            ),
        )

        assertNull(selected)
    }
}
