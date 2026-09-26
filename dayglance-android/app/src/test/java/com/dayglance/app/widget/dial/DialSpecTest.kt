package com.dayglance.app.widget.dial

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The geometry against the shared vectors (dayglance-ios/TestFixtures/
 * dayDial.vectors.json, produced from dayDial.js by `npm run ios:vectors`):
 * the same contract the iOS port is held to, for the functions the Android
 * widget uses. Plus the spec's own constants and rules.
 */
class DialSpecTest {

    companion object {
        val vectors: JSONObject by lazy {
            JSONObject(DialSpecTest::class.java.getResourceAsStream("/dayDial.vectors.json")!!.bufferedReader().readText())
        }

        fun cases(name: String): List<JSONObject> {
            val arr = vectors.getJSONObject("geometry").getJSONObject(name).getJSONArray("cases")
            return (0 until arr.length()).map { arr.getJSONObject(it) }
        }

        private val coord get() = vectors.getJSONObject("tolerance").getDouble("coordinate")
        private val radians get() = vectors.getJSONObject("tolerance").getDouble("radians")
    }

    @Test fun `fixture is the format this port was written against`() {
        assertEquals("dayDial.vectors/1", vectors.getString("format"))
        assertEquals(1440, vectors.getInt("dayMinutes"))
    }

    @Test fun `dialAngle matches every case`() {
        val list = cases("dialAngle")
        assertTrue(list.isNotEmpty())
        for (c in list) {
            val min = c.getJSONObject("input").getDouble("min")
            assertEquals("angle($min)", c.getJSONObject("expected").getDouble("radians"), DialGeometry.angle(min), radians)
        }
    }

    @Test fun `dialPoint matches every case`() {
        for (c in cases("dialPoint")) {
            val i = c.getJSONObject("input")
            val p = DialGeometry.point(i.getDouble("cx"), i.getDouble("cy"), i.getDouble("r"), i.getDouble("min"))
            val e = c.getJSONObject("expected")
            assertEquals(e.getDouble("x"), p.x, coord)
            assertEquals(e.getDouble("y"), p.y, coord)
        }
    }

    @Test fun `the web tick schedule is dialTicks and the spec's is every fifteen minutes`() {
        val want = cases("dialTicks").first().getJSONArray("expected")
        val got = DialSpec.schedule(5)
        assertEquals(want.length(), got.size)
        for (i in 0 until want.length()) {
            val w = want.getJSONObject(i)
            assertEquals(w.getInt("min"), got[i].minutes)
            assertEquals(w.getString("kind").uppercase(), got[i].kind.name)
        }
        assertEquals(96, DialSpec.ticks.size)
        assertEquals(24, DialSpec.ticks.count { it.kind == DialTickKind.HOUR })
        assertEquals(72, DialSpec.ticks.count { it.kind == DialTickKind.QUARTER })
        assertTrue(DialSpec.ticks.none { it.kind == DialTickKind.MINOR })
    }

    @Test fun `dialLaneBand matches every case to the bit`() {
        for (c in cases("dialLaneBand")) {
            val i = c.getJSONObject("input")
            val (rIn, rOut) = DialBand.laneBand(i.getDouble("rInner"), i.getDouble("rOuter"), i.optInt("lane", 0), i.optInt("laneCount", 1))
            val e = c.getJSONObject("expected")
            assertEquals(c.toString(), e.getDouble("rInner"), rIn, 0.0)
            assertEquals(c.toString(), e.getDouble("rOuter"), rOut, 0.0)
        }
    }

    @Test fun `muteDialColor matches every case`() {
        val list = cases("muteDialColor")
        assertTrue(list.size >= 26)
        for (c in list) {
            val input = c.getJSONObject("input").let { if (it.isNull("hex")) null else it.getString("hex") }
            assertEquals("mute($input)", c.getJSONObject("expected").getString("hex"), DialPalette.mute(input))
        }
    }

    @Test fun `moonPhasePath matches every case`() {
        for (c in cases("moonPhasePath")) {
            val i = c.getJSONObject("input")
            val g = MoonPhase.geometry(i.getDouble("r"), i.getDouble("fraction"), i.getBoolean("waxing"), i.optBoolean("mirror", false))
            val e = c.getJSONObject("expected")
            assertEquals(c.toString(), e.getInt("limbSweep"), g.limbSweep)
            assertEquals(c.toString(), e.getInt("terminatorSweep"), g.terminatorSweep)
            assertEquals(c.toString(), e.getDouble("terminatorRx"), g.terminatorRx, 0.0)
        }
    }

    @Test fun `spec constants are the handoff's`() {
        assertEquals(364.0, DialSpec.CANVAS_WIDTH, 0.0); assertEquals(382.0, DialSpec.CANVAS_HEIGHT, 0.0)
        assertEquals(182.0, DialSpec.CX, 0.0); assertEquals(189.0, DialSpec.CY, 0.0)
        assertEquals(129.0, DialSpec.BLOCK_INNER_RADIUS, 0.0); assertEquals(151.0, DialSpec.BLOCK_OUTER_RADIUS, 0.0)
        assertEquals(116.0, DialSpec.Hub.RADIUS, 0.0)
        assertEquals(DialSpec.CY, DialSpec.Hub.RULE_Y, 0.0)
        assertEquals(227.0, DialSpec.Hub.rowBaseline(0), 0.0)
        assertEquals(291.0, DialSpec.Hub.rowBaseline(4), 0.0)
        assertEquals(listOf("00", "03", "09", "12", "15", "21"), DialSpec.hourLabels.map { it.text })
    }

    @Test fun `the canvas angle is the dial angle from the plus-x axis`() {
        assertEquals(-90.0, DialGeometry.canvasDegrees(0.0), 1e-12)
        assertEquals(0.0, DialGeometry.canvasDegrees(360.0), 1e-12)
        assertEquals(90.0, DialGeometry.canvasDegrees(720.0), 1e-12)
        assertEquals(180.0, DialGeometry.canvasDegrees(1080.0), 1e-12)
    }

    @Test fun `the hub's usable width is the chord of the sky ring's inner edge`() {
        val h = DialSpec.Hub
        assertEquals(116.0, h.halfWidth(DialSpec.CY), 1e-9)
        assertEquals(113.9, h.halfWidth(h.TITLE_Y), 0.05)
        assertEquals(h.halfWidth(h.TITLE_Y) - 6, h.halfWidth(h.TITLE_Y, 6.0), 1e-9)
        assertEquals(0.0, h.halfWidth(DialSpec.CY + 116), 0.0)
        assertEquals(0.0, h.halfWidth(DialSpec.CY + 115.9, 50.0), 0.0)
        assertTrue(h.width(h.rowBaseline(4), 6.0) >= 95)
    }

    @Test fun `separators only where blocks touch`() {
        assertEquals(listOf(600.0), DialSpec.separatorMinutes(listOf(540.0 to 600.0, 600.0 to 660.0, 661.0 to 700.0)))
        assertEquals(emptyList<Double>(), DialSpec.separatorMinutes(listOf(540.0 to 600.0)))
    }

    @Test fun `sky segments pick the stronger body and the spec's opacity`() {
        val segs = DialSpec.skySegments(listOf(0.5 to 0.2, 0.0 to 0.4, null to null, 0.3 to 0.3))
        assertEquals(DialSpec.SkyBody.SUN, segs[0].body); assertEquals(0.10 + 0.5 * 0.66, segs[0].opacity, 1e-12)
        assertEquals(DialSpec.SkyBody.MOON, segs[1].body); assertEquals(0.09 + 0.4 * 0.52, segs[1].opacity, 1e-12)
        assertEquals(DialSpec.SkyBody.SUN, segs[2].body); assertEquals(0.10, segs[2].opacity, 1e-12)
        assertEquals("a tie is the sun's", DialSpec.SkyBody.SUN, segs[3].body)
        assertEquals(180.0, segs[3].startMin, 0.0); assertEquals(240.0, segs[3].endMin, 0.0)
        assertEquals(24, DialSpec.skySegments(List(30) { 0.1 to 0.0 }).size)
    }
}
