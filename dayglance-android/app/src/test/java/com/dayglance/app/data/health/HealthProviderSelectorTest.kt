package com.dayglance.app.data.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HealthProviderSelectorTest {

    private class FakeProvider(
        override val id: String,
        override val capabilities: Set<HealthMetric>,
        private val available: Boolean = true,
    ) : HealthProvider {
        override val displayName: String = id
        override fun isAvailable(): Boolean = available
        override suspend fun hasPermission(metric: HealthMetric): Boolean = true
    }

    @Test
    fun honor_prefers_native_provider_once_registered() {
        val selected = HealthProviderSelector.select(
            metric = HealthMetric.STEPS,
            manufacturer = "HONOR",
            providers = listOf(
                FakeProvider(HealthProviderSelector.HEALTH_CONNECT, setOf(HealthMetric.STEPS)),
                FakeProvider(HealthProviderSelector.HONOR_HEALTH, setOf(HealthMetric.STEPS)),
            ),
        )

        assertEquals(HealthProviderSelector.HONOR_HEALTH, selected?.id)
    }

    @Test
    fun honor_falls_back_to_health_connect_when_native_provider_is_unavailable() {
        val selected = HealthProviderSelector.select(
            metric = HealthMetric.SLEEP,
            manufacturer = "HONOR",
            providers = listOf(
                FakeProvider(
                    HealthProviderSelector.HONOR_HEALTH,
                    setOf(HealthMetric.SLEEP),
                    available = false,
                ),
                FakeProvider(
                    HealthProviderSelector.HEALTH_CONNECT,
                    setOf(HealthMetric.SLEEP),
                ),
            ),
        )

        assertEquals(HealthProviderSelector.HEALTH_CONNECT, selected?.id)
    }

    @Test
    fun selection_is_capability_specific() {
        val selected = HealthProviderSelector.select(
            metric = HealthMetric.SLEEP,
            manufacturer = "SAMSUNG",
            providers = listOf(
                FakeProvider(
                    HealthProviderSelector.SAMSUNG_HEALTH,
                    setOf(HealthMetric.STEPS),
                ),
                FakeProvider(
                    HealthProviderSelector.HEALTH_CONNECT,
                    setOf(HealthMetric.STEPS, HealthMetric.SLEEP),
                ),
            ),
        )

        assertEquals(HealthProviderSelector.HEALTH_CONNECT, selected?.id)
    }

    @Test
    fun unknown_manufacturer_prefers_generic_health_connect() {
        val selected = HealthProviderSelector.select(
            metric = HealthMetric.STEPS,
            manufacturer = "ACME",
            providers = listOf(
                FakeProvider(HealthProviderSelector.SAMSUNG_HEALTH, setOf(HealthMetric.STEPS)),
                FakeProvider(HealthProviderSelector.HEALTH_CONNECT, setOf(HealthMetric.STEPS)),
            ),
        )

        assertEquals(HealthProviderSelector.HEALTH_CONNECT, selected?.id)
    }

    @Test
    fun no_available_provider_returns_null() {
        val selected = HealthProviderSelector.select(
            metric = HealthMetric.SLEEP,
            manufacturer = "HUAWEI",
            providers = listOf(
                FakeProvider(
                    HealthProviderSelector.HUAWEI_HEALTH,
                    setOf(HealthMetric.SLEEP),
                    available = false,
                ),
            ),
        )

        assertNull(selected)
    }
}
