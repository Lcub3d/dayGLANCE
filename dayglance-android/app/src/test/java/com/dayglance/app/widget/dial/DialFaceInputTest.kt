package com.dayglance.app.widget.dial

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * The face's input from the live-shaped snapshot fixture (the JS producers'
 * real output, dayglance-ios/TestFixtures/widgetSnapshot.live.json), and the
 * widget's small pure rules: the needle's level, the tick, the zone check.
 */
class DialFaceInputTest {

    private val root: JSONObject by lazy {
        JSONObject(DialFaceInputTest::class.java.getResourceAsStream("/widgetSnapshot.live.json")!!.bufferedReader().readText())
    }

    @Test fun `the pushed day's blocks, sky and glyphs come off the fixture`() {
        val input = DialFaceInput.from(root, projectedDay = false)
        val blocks = root.getJSONObject("dial").getJSONArray("blocks")
        assertEquals(blocks.length(), input.blocks.size)
        val sleep = input.blocks.first()
        assertEquals(DialBlockKind.SLEEP, sleep.kind)
        assertEquals(0.0, sleep.startMin, 0.0); assertEquals(390.0, sleep.endMin, 0.0)
        assertNull("sleep has no title", sleep.title)
        val run = input.blocks.first { it.id == "2026-09-21-run" }
        assertEquals("Run", run.title); assertEquals("health", run.tag); assertTrue(run.completed)
        assertEquals(400.0, run.startMin, 0.0); assertEquals(435.0, run.endMin, 0.0)
        // An explicit JSON null tag is no tag, not the text "null".
        assertNull(input.blocks.first { it.id == "2026-09-21-standup" }.tag)
        assertEquals(24, input.sky.size)
        assertEquals(406.0, input.sunriseMin!!, 0.0); assertEquals(1138.0, input.sunsetMin!!, 0.0)
        assertFalse(input.projectedDay)
    }

    @Test fun `a projected day reads its own entry and marks the tier`() {
        val day = root.getJSONArray("days").getJSONObject(0)
        val input = DialFaceInput.from(day, projectedDay = true)
        assertTrue(input.projectedDay)
        assertTrue(input.blocks.isNotEmpty())
        assertNotEquals(DialFaceInput.from(root, false).seed, input.seed)
    }

    @Test fun `no dial and no sky is an empty day with an unlit ring`() {
        val input = DialFaceInput.from(JSONObject("""{"dial":null,"sky":null}"""), false)
        assertTrue(input.blocks.isEmpty()); assertTrue(input.sky.isEmpty()); assertNull(input.moon)
        assertTrue(DialFaceInput.from(null, false).blocks.isEmpty())
    }

    @Test fun `zero-length blocks never reach the ring`() {
        val input = DialFaceInput.from(JSONObject("""{"dial":{"blocks":[{"type":"task","id":"z","startMin":600,"durationMin":0}]}}"""), false)
        assertTrue(input.blocks.isEmpty())
    }

    @Test fun `the seed ignores the hub's words and sees the ring's`() {
        val a = DialFaceInput.from(JSONObject("""{"dial":{"blocks":[{"type":"task","id":"a","title":"One","startMin":600,"durationMin":60,"colorHex":"#3b82f6"}]}}"""), false)
        val retitled = DialFaceInput.from(JSONObject("""{"dial":{"blocks":[{"type":"task","id":"a","title":"Two","startMin":600,"durationMin":60,"colorHex":"#3b82f6"}]}}"""), false)
        val moved = DialFaceInput.from(JSONObject("""{"dial":{"blocks":[{"type":"task","id":"a","title":"One","startMin":615,"durationMin":60,"colorHex":"#3b82f6"}]}}"""), false)
        assertEquals(a.seed, retitled.seed)
        assertNotEquals(a.seed, moved.seed)
        assertEquals(DialFaceInput.digest(a.seed), DialFaceInput.digest(retitled.seed))
        assertEquals(20, DialFaceInput.digest("x").length)
    }

    @Test fun `the placeholder is a sky with glyphs and no blocks`() {
        val p = DialFaceInput.PLACEHOLDER
        assertTrue(p.blocks.isEmpty()); assertEquals(24, p.sky.size)
        assertEquals(337.0, p.sunriseMin!!, 0.0); assertEquals(1231.0, p.sunsetMin!!, 0.0)
    }

    @Test fun `the needle's level is the minute's share of 10000`() {
        assertEquals(0, DialNeedle.level(0.0))
        assertEquals(2500, DialNeedle.level(360.0))
        assertEquals(5000, DialNeedle.level(720.0))
        assertEquals(3159, DialNeedle.level(455.0))
        assertEquals(10000, DialNeedle.level(1440.0))
    }

    @Test fun `the tick lands a second after the next minute boundary`() {
        assertEquals(61_000L, DayDialTicker.nextTickMillis(0L))
        assertEquals(61_000L, DayDialTicker.nextTickMillis(59_999L))
        assertEquals(121_000L, DayDialTicker.nextTickMillis(60_000L))
    }

    @Test fun `the zone has changed only when the offset now differs`() {
        val denver = ZonedDateTime.of(2026, 9, 21, 12, 0, 0, 0, ZoneId.of("America/Denver"))
        assertFalse(DialZone.changed("America/Denver", denver))
        assertFalse("same offset, another name", DialZone.changed("America/Boise", denver))
        assertTrue(DialZone.changed("America/New_York", denver))
        assertFalse(DialZone.changed(null, denver))
        assertFalse(DialZone.changed("", denver))
        assertFalse(DialZone.changed("Not/AZone", denver))
    }
}
