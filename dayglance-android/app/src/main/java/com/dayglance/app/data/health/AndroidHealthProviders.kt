package com.dayglance.app.data.health

import android.content.Context

/**
 * The single registration point for Android health stores.
 *
 * Keep this list concrete: an adapter belongs here only when its SDK,
 * authorization path, and read implementation are usable. Do not register
 * vendor placeholders just because a manufacturer exists.
 */
object AndroidHealthProviders {
    fun create(context: Context): List<HealthProvider> =
        listOf(
            HealthConnectProvider(context.applicationContext),
        )
}
