package com.dayglance.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * The midnight alarm's two pure decisions — when to fire and whether it may
 * be exact — and the bridge's reload-flag reader. Arming itself needs an
 * AlarmManager and is exercised on device.
 */
class MidnightRolloverTest {

    private val chicago: ZoneId = ZoneId.of("America/Chicago")

    private fun at(iso: String) = ZonedDateTime.parse(iso)

    @Test
    fun `fires a few seconds after the next local midnight`() {
        val now = at("2026-09-18T21:30:00-05:00[America/Chicago]")
        val fire = Instant.ofEpochMilli(MidnightRolloverReceiver.nextFireMillis(now)).atZone(chicago)
        assertEquals(at("2026-09-19T00:00:05-05:00[America/Chicago]").toInstant(), fire.toInstant())
    }

    @Test
    fun `just after midnight arms for the FOLLOWING midnight, not this one`() {
        val now = at("2026-09-19T00:00:06-05:00[America/Chicago]")
        val fire = Instant.ofEpochMilli(MidnightRolloverReceiver.nextFireMillis(now)).atZone(chicago)
        assertEquals(20, fire.dayOfMonth)
        assertEquals(0, fire.hour)
    }

    @Test
    fun `DST end - the night is 25 hours and the alarm still lands on local 00_00`() {
        // 2026-11-01 02:00 CDT → 01:00 CST in Chicago.
        val now = at("2026-10-31T22:00:00-05:00[America/Chicago]")
        val fire = Instant.ofEpochMilli(MidnightRolloverReceiver.nextFireMillis(now)).atZone(chicago)
        assertEquals(1, fire.dayOfMonth)
        assertEquals(0, fire.hour)
        assertEquals(0, fire.minute)
        assertEquals(5, fire.second)
    }

    @Test
    fun `DST start - the night is 23 hours and the alarm still lands on local 00_00`() {
        // 2026-03-08 02:00 CST → 03:00 CDT in Chicago.
        val now = at("2026-03-07T23:30:00-06:00[America/Chicago]")
        val fire = Instant.ofEpochMilli(MidnightRolloverReceiver.nextFireMillis(now)).atZone(chicago)
        assertEquals(8, fire.dayOfMonth)
        assertEquals(0, fire.hour)
        // 30 minutes to midnight, not 24 h 30 m: built from the local date.
        assertEquals(30 * 60_000L + 5_000L, MidnightRolloverReceiver.nextFireMillis(now) - now.toInstant().toEpochMilli())
    }

    @Test
    fun `exact below Android 12 regardless of the permission callback`() {
        assertTrue(MidnightRolloverReceiver.useExact(30) { false })
    }

    @Test
    fun `on Android 12+ the permission is asked at arm time and decides`() {
        assertTrue(MidnightRolloverReceiver.useExact(31) { true })
        assertFalse(MidnightRolloverReceiver.useExact(31) { false })
        assertFalse(MidnightRolloverReceiver.useExact(35) { false })
    }

    // ── reload flag ──────────────────────────────────────────────────────────

    @Test
    fun `reload unless the snapshot explicitly says not to`() {
        assertTrue(WidgetSnapshotEnvelope.wantsReload(null))
        assertTrue(WidgetSnapshotEnvelope.wantsReload("{}"))
        assertTrue(WidgetSnapshotEnvelope.wantsReload("""{"date":"2026-09-18","reloadWidgets":true}"""))
        assertTrue(WidgetSnapshotEnvelope.wantsReload("not json at all"))
    }

    @Test
    fun `reloadWidgets false suppresses the redraw, whitespace or not`() {
        assertFalse(WidgetSnapshotEnvelope.wantsReload("""{"date":"2026-09-18","reloadWidgets":false}"""))
        assertFalse(WidgetSnapshotEnvelope.wantsReload("""{"reloadWidgets" : false , "date":"2026-09-18"}"""))
    }
}
