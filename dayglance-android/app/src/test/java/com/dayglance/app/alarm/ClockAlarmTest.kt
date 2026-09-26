package com.dayglance.app.alarm

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClockAlarmTest {
    @Test fun `alarms from the Google and Samsung clocks count`() {
        assertTrue(ClockAlarm.isClockApp("com.google.android.deskclock"))
        assertTrue(ClockAlarm.isClockApp("com.sec.android.app.clockpackage"))
    }

    @Test fun `a calendar's alarm, another app's, or an unknown creator does not`() {
        assertFalse(ClockAlarm.isClockApp("com.google.android.calendar"))
        assertFalse(ClockAlarm.isClockApp("com.samsung.android.calendar"))
        assertFalse(ClockAlarm.isClockApp("com.dayglance.app"))
        assertFalse(ClockAlarm.isClockApp(null))
        assertFalse(ClockAlarm.isClockApp(""))
    }

    @Test fun `with no package named, the creator uid's packages decide`() {
        assertTrue(ClockAlarm.isClockApp(null, listOf("com.google.android.deskclock")))
        assertFalse(ClockAlarm.isClockApp(null, listOf("com.google.android.calendar")))
        assertFalse(ClockAlarm.isClockApp(null, emptyList()))
    }
}
