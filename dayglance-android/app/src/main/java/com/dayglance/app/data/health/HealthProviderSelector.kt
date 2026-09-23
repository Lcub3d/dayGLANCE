package com.dayglance.app.data.health

/**
 * First-run provider ordering.
 *
 * Manufacturer is only a discovery hint. The chosen provider id is persisted
 * per metric afterwards, so normal reads do not keep re-checking phone brand
 * or probing every installed health store.
 *
 * Direct OEM ids are intentionally listed even before every adapter ships:
 * adding an adapter later only requires registering it; selection semantics do
 * not need to change.
 */
object HealthProviderSelector {

    const val HEALTH_CONNECT = "health_connect"
    const val HONOR_HEALTH = "honor_health"
    const val HUAWEI_HEALTH = "huawei_health"
    const val SAMSUNG_HEALTH = "samsung_health"

    fun orderedProviderIds(manufacturer: String): List<String> {
        val maker = manufacturer.trim().uppercase()
        return when {
            maker.contains("HONOR") ->
                listOf(HONOR_HEALTH, HEALTH_CONNECT, SAMSUNG_HEALTH, HUAWEI_HEALTH)
            maker.contains("HUAWEI") ->
                listOf(HUAWEI_HEALTH, HEALTH_CONNECT, HONOR_HEALTH, SAMSUNG_HEALTH)
            maker.contains("SAMSUNG") ->
                listOf(SAMSUNG_HEALTH, HEALTH_CONNECT, HONOR_HEALTH, HUAWEI_HEALTH)
            else ->
                listOf(HEALTH_CONNECT, SAMSUNG_HEALTH, HONOR_HEALTH, HUAWEI_HEALTH)
        }
    }

    fun select(
        metric: HealthMetric,
        manufacturer: String,
        providers: Collection<HealthProvider>,
        excludedProviderId: String? = null,
    ): HealthProvider? {
        val order = orderedProviderIds(manufacturer)
        val rank = order.withIndex().associate { it.value to it.index }

        return providers
            .asSequence()
            .filter { it.id != excludedProviderId }
            .filter { metric in it.capabilities }
            .filter { runCatching { it.isAvailable() }.getOrDefault(false) }
            .sortedWith(
                compareBy<HealthProvider> { rank[it.id] ?: Int.MAX_VALUE }
                    .thenBy { it.id }
            )
            .firstOrNull()
    }
}
