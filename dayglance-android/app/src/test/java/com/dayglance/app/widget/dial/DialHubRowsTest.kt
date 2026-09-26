package com.dayglance.app.widget.dial

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The hub's rows by status, which one is live, and what the face key sees:
 * the words are fixed English here (the device's come from string resources).
 */
class DialHubRowsTest {

    object English : DialHubCopy {
        override fun clock(minutesOfDay: Double): String {
            val m = minutesOfDay.toInt() % 1440
            return "%02d:%02d".format(m / 60, m % 60)
        }
        override fun duration(minutes: Double): String {
            val t = minutes.toInt(); val h = t / 60; val m = t % 60
            return listOfNotNull(if (h > 0) "${h}h" else null, if (m > 0 || h == 0) "${m}m" else null).joinToString(" ")
        }
        override fun until(clock: String) = "until $clock"
        override fun left(duration: String) = "$duration left"
        override fun open(duration: String) = "$duration open"
        override fun untilSleepAt(clock: String) = "until sleep at $clock"
        override fun untilAt(title: String, clock: String) = "until $title at $clock"
        override fun nothingElseToday() = "Nothing else today"
        override fun thenOpen(duration: String) = "then $duration open"
        override fun thenUntilSleep(duration: String) = "then $duration until sleep"
        override fun sleep() = "Sleep"
        override fun outdated() = "Outdated"
        override fun zoneChanged() = "Time zone changed"
        override fun openToRefresh() = "Open dayGLANCE to refresh"
        override fun openToSetUp() = "Open dayGLANCE to set up"
    }

    private fun task(id: String, s: Double, e: Double, title: String = id, tag: String? = null, kind: DialBlockKind = DialBlockKind.TASK) =
        DialFaceBlock(id, kind, s, e, title = title, tag = tag)

    private val day = listOf(
        task("sleep", 0.0, 420.0, kind = DialBlockKind.SLEEP),
        task("docs", 600.0, 750.0, title = "Write API documentation", tag = "work"),
        task("lunch", 780.0, 840.0, title = "Lunch"),
        task("gym", 1020.0, 1140.0, title = "Gym"),
    )

    private fun rows(nowMin: Double, blocks: List<DialFaceBlock> = day, planned: String? = null) =
        DialHubRows.build(DialHubStatus.LIVE, DialHub.resolve(blocks, nowMin), English, plannedAsOf = planned)

    @Test fun `a current block with a tag - title, tag, until, the live time left, runway`() {
        val r = rows(680.0, listOf(task("docs", 600.0, 750.0, "Write API documentation", "work"), task("gym", 1020.0, 1140.0)))
        assertEquals("Write API documentation", r.title?.text)
        assertEquals(listOf("#work", "until 12:30", "1h 10m left", "then 4h 30m open"), r.stack.map { it.text })
        assertEquals(DialLiveSlot.ROW2, r.liveSlot)
        assertEquals("1h 10m left", r.liveRow?.text)
    }

    @Test fun `without a tag the live row moves up a slot`() {
        val r = rows(790.0)
        assertEquals("Lunch", r.title?.text)
        assertEquals(listOf("until 14:00", "50m left", "then 3h open"), r.stack.map { it.text })
        assertEquals(DialLiveSlot.ROW1, r.liveSlot)
    }

    @Test fun `open time is a live title and names what ends it`() {
        val r = rows(900.0)
        assertEquals(DialHubRowStyle.TITLE_OPEN, r.title?.style)
        assertEquals("2h open", r.title?.text)
        assertEquals(listOf("until Gym at 17:00"), r.stack.map { it.text })
        assertEquals(DialLiveSlot.TITLE, r.liveSlot)
        assertEquals("Nothing else today", rows(1200.0).stack.single().text)
    }

    @Test fun `sleep is static, muted, and has no live row`() {
        val r = rows(300.0)
        assertEquals("Sleep", r.title?.text)
        assertEquals(DialHubRowStyle.TITLE_SLEEP, r.title?.style)
        assertEquals(listOf("until 07:00"), r.stack.map { it.text })
        assertNull(r.liveSlot)
        assertNull(r.liveRow)
    }

    @Test fun `statuses take the rows and are never live`() {
        val out = DialHubRows.build(DialHubStatus.OUTDATED, DialHubState(), English, outdatedDetail = "as of Mon 8:42 PM")
        assertEquals("Outdated", out.title?.text); assertEquals(DialHubRowStyle.TITLE_STATUS, out.title?.style)
        assertEquals(listOf("as of Mon 8:42 PM"), out.stack.map { it.text })
        assertNull(out.liveSlot)
        val zone = DialHubRows.build(DialHubStatus.ZONE_CHANGED, DialHubState(), English)
        assertEquals(listOf("Time zone changed", "Open dayGLANCE to refresh"), listOfNotNull(zone.title?.text) + zone.stack.map { it.text })
        val setUp = DialHubRows.build(DialHubStatus.SET_UP, DialHubState(), English)
        assertNull(setUp.title); assertEquals("Open dayGLANCE to set up", setUp.stack.single().text)
        val placeholder = DialHubRows.build(DialHubStatus.PLACEHOLDER, DialHubState(), English)
        assertNull(placeholder.title); assertTrue(placeholder.stack.isEmpty())
    }

    @Test fun `the planned note is the lowest row, after the live one`() {
        val r = rows(790.0, planned = "Planned as of Mon 8:42 PM")
        assertEquals(DialHubRowStyle.NOTE, r.stack.last().style)
        assertEquals(DialLiveSlot.ROW1, r.liveSlot)
    }

    @Test fun `the static key ignores the live row's words and nothing else`() {
        // Minute to minute inside one block only the live row changes: no redraw.
        assertEquals(rows(680.0).staticKey, rows(681.0).staticKey)
        assertEquals(rows(900.0).staticKey, rows(960.0).staticKey)
        // A block boundary changes the static rows: a redraw.
        assertNotEquals(rows(749.0).staticKey, rows(750.0).staticKey)
        assertNotEquals(rows(779.0).staticKey, rows(780.0).staticKey)
    }

    @Test fun `the open detail cuts the next title, never the time`() {
        val narrow = { s: String -> s.length * 10.0 }
        val o = DialHubOpen(60.0, 1020.0, "A very long block title that cannot possibly fit", false)
        val text = DialHubRows.openDetail(o, English, narrow)
        assertTrue(text, text.endsWith(" at 17:00"))
        assertTrue(text, text.contains("…"))
        assertFalse(DialHubRows.openDetail(DialHubOpen(60.0, 1020.0, "Gym", false), English, narrow).contains("…"))
        assertEquals("…", DialHubRows.fit("anything", 0.0, narrow))
        assertEquals("Gym", DialHubRows.fit("Gym", 100.0, narrow))
    }

    // The slots in res/layout/widget_day_dial_box.xml are weights in canvas points
    // and must be DialLiveSlot.rect exactly, or the strip lands off its row.
    @Test fun `the layout's live slots are DialLiveSlot's rects`() {
        val xml = File("src/main/res/layout/widget_day_dial_box.xml").readText()
        val ids = mapOf(DialLiveSlot.TITLE to "iv_day_dial_live_title", DialLiveSlot.ROW1 to "iv_day_dial_live_row1", DialLiveSlot.ROW2 to "iv_day_dial_live_row2")
        for ((slot, id) in ids) {
            // The slot's image sits in a horizontal row inside a vertical column.
            val at = xml.indexOf("@+id/$id")
            val row = xml.lastIndexOf("<LinearLayout", at)
            val column = xml.lastIndexOf("<LinearLayout", row - 1)
            val end = xml.indexOf("</LinearLayout>", xml.indexOf("</LinearLayout>", at) + 1)
            val block = xml.substring(column, end)
            val weights = Regex("layout_weight=\"([0-9.]+)\"").findAll(block).map { it.groupValues[1].toDouble() }.toList()
            // top, row, left, slot, right, bottom — in document order.
            val (top, height, left, width) = listOf(weights[0], weights[1], weights[2], weights[3])
            val r = slot.rect
            assertEquals("$slot left", r[0], left, 0.0)
            assertEquals("$slot top", r[1], top, 0.0)
            assertEquals("$slot width", r[2], width, 0.0)
            assertEquals("$slot height", r[3], height, 0.0)
            assertEquals("$slot right", DialSpec.CANVAS_WIDTH - r[0] - r[2], weights[4], 0.0)
            assertEquals("$slot bottom", DialSpec.CANVAS_HEIGHT - r[1] - r[3], weights[5], 0.0)
        }
    }

    @Test fun `a slot is wide enough for its row and tall enough for its type`() {
        for (slot in DialLiveSlot.entries) {
            val r = slot.rect
            assertTrue(r[2] >= DialSpec.Hub.width(slot.baseline, DialSpec.Hub.CHORD_INSET))
            assertTrue(r[1] <= slot.baseline - slot.fontSize)
            assertTrue(r[1] + r[3] >= slot.baseline + slot.fontSize * 0.3)
        }
    }
}
