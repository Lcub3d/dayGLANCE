package com.dayglance.app.widget.dial

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which block the hub narrates, and the time around it: the iOS HubTests, ported. */
class DialHubTest {

    private fun task(id: String, s: Double, e: Double, title: String? = null, tag: String? = null,
                     kind: DialBlockKind = DialBlockKind.TASK, endsNextDay: Boolean = false, endMinTrue: Double? = null) =
        DialFaceBlock(id, kind, s, e, endsNextDay = endsNextDay, endMinTrue = endMinTrue, title = title ?: id, tag = tag)

    private val sparse = listOf(
        task("sleep", 0.0, 420.0, kind = DialBlockKind.SLEEP), task("r", 420.0, 455.0, kind = DialBlockKind.ROUTINE),
        task("docs", 600.0, 750.0, title = "Write API documentation", tag = "work"),
        task("gym", 1020.0, 1140.0, title = "Gym"), task("night", 1380.0, 1440.0, kind = DialBlockKind.SLEEP),
    )

    @Test fun `the running block is current and sleep never is`() {
        val day = listOf(
            task("sleep", 0.0, 385.0, kind = DialBlockKind.SLEEP),
            task("standup", 480.0, 540.0, title = "Standup", tag = "work"),
            task("docs", 600.0, 750.0, title = "Write API documentation", tag = "work"),
            task("lunch", 750.0, 810.0, title = "Lunch"),
        )
        val s = DialHub.resolve(day, 680.0).current!!
        assertEquals("docs", s.id); assertEquals("work", s.tag); assertEquals(750.0, s.endMin, 0.0); assertEquals(70.0, s.minutesLeft, 0.0)
        assertNull(DialHub.resolve(day, 180.0).current)
        assertNull(DialHub.resolve(day, 570.0).current)
        assertNull(DialHub.resolve(listOf(task("a", 600.0, 660.0)), 660.0).current)
        assertEquals("a", DialHub.resolve(listOf(task("a", 600.0, 660.0)), 600.0).current?.id)
    }

    @Test fun `nested blocks - the latest starting wins, ties keep list order`() {
        val day = listOf(task("container", 540.0, 720.0), task("inner", 600.0, 630.0))
        assertEquals("inner", DialHub.resolve(day, 610.0).current?.id)
        assertEquals("container", DialHub.resolve(day, 650.0).current?.id)
        assertEquals("first", DialHub.resolve(listOf(task("first", 600.0, 700.0), task("second", 600.0, 660.0)), 610.0).current?.id)
    }

    @Test fun `events and routines are narrated too, an empty tag is none`() {
        assertEquals("ev", DialHub.resolve(listOf(task("ev", 480.0, 540.0, kind = DialBlockKind.EVENT)), 500.0).current?.id)
        assertEquals("r", DialHub.resolve(listOf(task("r", 385.0, 420.0, kind = DialBlockKind.ROUTINE)), 400.0).current?.id)
        val s = DialHub.resolve(listOf(DialFaceBlock("x", DialBlockKind.TASK, 600.0, 700.0, tag = "")), 650.0)
        assertNull(s.current?.tag)
        assertEquals("", s.current?.title)
    }

    @Test fun `the countdown runs to the true end across midnight, with no runway`() {
        val late = task("late", 1380.0, 1440.0, endsNextDay = true, endMinTrue = 60.0)
        assertEquals(1500.0, late.trueEndMin, 0.0)
        val s = DialHub.resolve(listOf(late), 1400.0)
        assertEquals(1500.0, s.current!!.endMin, 0.0)
        assertEquals(100.0, s.current!!.minutesLeft, 0.0)
        assertNull(s.runwayMinutes)
    }

    @Test fun `the runway is the gap to the next block when at least thirty minutes`() {
        assertEquals(270.0, DialHub.resolve(sparse, 680.0).runwayMinutes!!, 0.0)
        assertNull(DialHub.resolve(listOf(task("docs", 600.0, 750.0), task("lunch", 750.0, 810.0)), 680.0).runwayMinutes)
        assertEquals(30.0, DialHub.resolve(listOf(task("a", 600.0, 700.0), task("b", 730.0, 800.0)), 650.0).runwayMinutes!!, 0.0)
        assertNull(DialHub.resolve(listOf(task("a", 600.0, 700.0), task("b", 729.0, 800.0)), 650.0).runwayMinutes)
        assertNull(DialHub.resolve(listOf(task("a", 600.0, 700.0)), 650.0).runwayMinutes)
        val evening = DialHub.resolve(listOf(task("a", 1200.0, 1260.0), task("night", 1350.0, 1440.0, kind = DialBlockKind.SLEEP)), 1230.0)
        assertEquals(90.0, evening.runwayMinutes!!, 0.0)
        assertTrue(evening.runwayEndsAtSleep)
        assertFalse(DialHub.resolve(sparse, 680.0).runwayEndsAtSleep)
        assertEquals(60.0, DialHub.resolve(listOf(task("a", 600.0, 700.0), task("b", 650.0, 690.0), task("c", 760.0, 800.0)), 620.0).runwayMinutes!!, 0.0)
        val nested = DialHub.resolve(listOf(task("container", 540.0, 720.0), task("inner", 600.0, 630.0), task("next", 700.0, 760.0)), 610.0)
        assertEquals(70.0, nested.runwayMinutes!!, 0.0)
    }

    @Test fun `open time runs to the next block and names it, or to sleep, or to midnight`() {
        assertEquals(DialHubOpen(240.0, 1020.0, "Gym", false), DialHub.resolve(sparse, 780.0).open)
        assertEquals(DialHubOpen(210.0, 1380.0, null, true), DialHub.resolve(sparse, 1170.0).open)
        assertEquals(DialHubOpen(640.0, null, null, false), DialHub.resolve(listOf(task("a", 600.0, 700.0)), 800.0).open)
    }

    @Test fun `inside sleep the hub says sleep and when it ends`() {
        val morning = DialHub.resolve(sparse, 300.0)
        assertNull(morning.current); assertNull(morning.open)
        assertEquals(DialHubSleep(420.0, 120.0), morning.sleep)
        val night = listOf(task("a", 600.0, 700.0), task("night", 1380.0, 1440.0, kind = DialBlockKind.SLEEP, endsNextDay = true, endMinTrue = 385.0))
        assertEquals(DialHubSleep(1825.0, 425.0), DialHub.resolve(night, 1400.0).sleep)
        val call = DialHub.resolve(listOf(task("night", 1380.0, 1440.0, kind = DialBlockKind.SLEEP), task("call", 1390.0, 1420.0)), 1400.0)
        assertEquals("call", call.current?.id); assertNull(call.sleep)
    }
}
