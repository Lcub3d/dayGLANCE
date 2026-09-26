package com.dayglance.app.widget.dial

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/** The alarm mark: the same cases as dialAlarmMark's in src/utils/nextAlarm.test.js. */
class DialAlarmTest {
    private val zone = ZoneId.of("America/Denver")
    private fun at(day: Int, h: Int, m: Int) = LocalDateTime.of(2026, 8, 2 + day, h, m).atZone(zone).toInstant().toEpochMilli()
    private val from = 18 * 60
    private fun mark(now: Long, alarm: Long?, fromMin: Int = from) = DialAlarm.mark(now, alarm, fromMin, zone)

    @Test fun `tomorrow morning - nothing during the day, the 00 mark from the evening on`() {
        assertNull(mark(at(0, 14, 0), at(1, 6, 30)))
        assertNull(mark(at(0, 17, 59), at(1, 6, 30)))
        assertEquals(DialAlarmMark(DialAlarmMode.TOMORROW, 0.0, 390.0), mark(at(0, 18, 0), at(1, 6, 30)))
        assertEquals(DialAlarmMark(DialAlarmMode.TOMORROW, 0.0, 390.0), mark(at(0, 23, 1), at(1, 6, 30)))
    }

    @Test fun `after midnight the mark moves to the real time until it rings`() {
        assertEquals(DialAlarmMark(DialAlarmMode.TODAY, 390.0, 390.0), mark(at(1, 0, 40), at(1, 6, 30)))
        assertEquals(DialAlarmMark(DialAlarmMode.TODAY, 390.0, 390.0), mark(at(1, 6, 29), at(1, 6, 30)))
        assertNull(mark(at(1, 6, 30), at(1, 6, 30)))
    }

    @Test fun `an alarm later today shows at its time, whatever the hour`() {
        assertEquals(DialAlarmMark(DialAlarmMode.TODAY, 855.0, 855.0), mark(at(0, 10, 0), at(0, 14, 15)))
    }

    @Test fun `always shows tomorrow's all day, further out never shows`() {
        assertEquals(DialAlarmMark(DialAlarmMode.TOMORROW, 0.0, 390.0), mark(at(0, 9, 0), at(1, 6, 30), 0))
        assertNull(mark(at(0, 22, 0), at(2, 6, 30), 0))
    }

    @Test fun `no alarm, or one already rung, is no mark`() {
        assertNull(mark(at(0, 22, 0), null))
        assertNull(mark(at(0, 22, 0), at(0, 21, 0)))
    }

    @Test fun `prefs come from the snapshot, defaulting to the app's`() {
        assertEquals(DialAlarmPrefs(true, 1080), DialAlarmPrefs.from(null))
        assertEquals(DialAlarmPrefs(true, 1080), DialAlarmPrefs.from(JSONObject("{}")))
        assertEquals(DialAlarmPrefs(false, 1260), DialAlarmPrefs.from(JSONObject("""{"dialAlarm":{"on":false,"fromMin":1260}}""")))
        assertEquals(DialAlarmPrefs(true, 1080), DialAlarmPrefs.from(JSONObject("""{"dialAlarm":{"on":true,"fromMin":9999}}""")))
        val fixture = JSONObject(DialAlarmTest::class.java.getResourceAsStream("/widgetSnapshot.live.json")!!.bufferedReader().readText())
        assertEquals(DialAlarmPrefs(true, 1080), DialAlarmPrefs.from(fixture))
    }

    @Test fun `an hour label gives way only to an alarm at its real time`() {
        val nine = DialAlarmMark(DialAlarmMode.TODAY, 530.0, 530.0)
        assertTrue(DialAlarm.labelYields(540, nine))
        assertFalse(DialAlarm.labelYields(720, nine))
        assertFalse(DialAlarm.labelYields(0, DialAlarmMark(DialAlarmMode.TOMORROW, 0.0, 390.0)))
        assertTrue(DialAlarm.labelYields(0, DialAlarmMark(DialAlarmMode.TODAY, 1435.0, 1435.0)))
    }
}
