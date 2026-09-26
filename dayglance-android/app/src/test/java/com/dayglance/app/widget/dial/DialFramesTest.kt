package com.dayglance.app.widget.dial

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Frames against the shared vectors: the iOS FramesTests, ported case for case. */
class DialFramesTest {

    private fun cases(name: String): List<JSONObject> {
        val arr = DialSpecTest.vectors.getJSONObject("geometry").getJSONObject(name).getJSONArray("cases")
        return (0 until arr.length()).map { arr.getJSONObject(it) }
    }

    @Test fun `the frame mute matches every case`() {
        val list = cases("muteDialFrameColor")
        assertTrue(list.size >= 13)
        for (c in list) {
            val input = c.getJSONObject("input").let { if (it.isNull("hex")) null else it.getString("hex") }
            assertEquals("muteFrame($input)", c.getJSONObject("expected").getString("hex"), DialPalette.muteFrame(input))
        }
    }

    @Test fun `the ring is softer than the title, and mute is the parameterised one`() {
        assertNotEquals(DialPalette.mute("#f43f5e"), DialPalette.muteFrame("#f43f5e"))
        for (hex in listOf("#3b82f6", "#ef4444", "#22c55e")) assertEquals(DialPalette.mute(hex), DialPalette.mute(hex, 0.5, 0.73))
    }

    @Test fun `radii match every case`() {
        val list = cases("dialFrameRadii")
        assertEquals(6, list.size)
        for (c in list) {
            val i = c.getJSONObject("input")
            val e = c.getJSONObject("expected")
            val r = DialFrames.radii(i.getDouble("rInner"), i.getDouble("rOuter"), i.getInt("depth"))
            assertEquals(e.getDouble("inner"), r.inner, 1e-9)
            assertEquals(e.getDouble("outer"), r.outer, 1e-9)
            assertEquals(e.getDouble("width"), r.width, 1e-9)
        }
    }

    @Test fun `the widget band is the spec`() {
        val top = DialFrames.radii(0)
        assertEquals(126.0, top.inner, 1e-9)
        assertEquals(153.0, top.outer, 1e-9)
        assertEquals(1.2, top.width, 1e-9)
        assertEquals(DialFrames.radii(1), DialFrames.radii(4))
    }

    @Test fun `current frame matches every case`() {
        for (c in cases("dialCurrentFrame")) {
            val i = c.getJSONObject("input")
            val arr = i.getJSONArray("frames")
            val frames = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
                DialFrame(it.getString("name"), null, it.getDouble("startMin"), it.getDouble("endMin"), it.getInt("depth"))
            }
            val e = c.getJSONObject("expected")
            val want = if (e.isNull("name")) null else e.getString("name")
            assertEquals("now ${i.getDouble("nowMin")}", want, DialFrames.current(frames, i.getDouble("nowMin"))?.name)
        }
    }

    @Test fun `available minutes match every case`() {
        for (c in cases("dialFrameAvailableMinutes")) {
            val i = c.getJSONObject("input")
            val arr = i.getJSONArray("slots")
            val slots = (0 until arr.length()).map { arr.getJSONArray(it) }.map { it.getDouble(0) to it.getDouble(1) }
            val frame = DialFrame("", null, 0.0, 1440.0, 0, slots)
            assertEquals(c.getJSONObject("expected").getDouble("minutes"), DialFrames.availableMinutes(frame, i.getDouble("nowMin")), 1e-9)
        }
    }

    @Test fun `a short frame is not drawn`() {
        assertFalse(DialFrames.drawn(DialFrame("", null, 600.0, 609.0)))
        assertTrue(DialFrames.drawn(DialFrame("", null, 600.0, 610.0)))
    }
}
