package com.dayglance.app.widget.dial

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The band and its palette: the iOS PaletteTests, ported case for case. */
class DialPaletteTest {

    private fun tone(kind: DialBlockKind, completed: Boolean = false, past: Boolean, prev: Boolean = false, projected: Boolean = false) =
        DialPalette.tone(kind, completed, past, prev, projected)

    @Test fun `the ten tailwind hexes mute to the study swatches`() {
        val table = listOf(
            "#3b82f6" to "#98b2dd", "#2563eb" to "#98addd", "#ef4444" to "#dd9898", "#22c55e" to "#98ddb1",
            "#a855f7" to "#bb98dd", "#eab308" to "#ddcc98", "#ec4899" to "#dd98ba", "#6366f1" to "#9899dd",
            "#f97316" to "#ddb498", "#14b8a6" to "#98ddd5",
        )
        for ((stored, drawn) in table) assertEquals(stored, drawn, DialPalette.mute(stored))
        assertEquals("#5eead4", DialBand.colorHex(DialFaceBlock("r", DialBlockKind.ROUTINE, 0.0, 15.0)))
        assertEquals("#c4b5fd", DialBand.colorHex(DialFaceBlock("s", DialBlockKind.SLEEP, 0.0, 385.0)))
    }

    @Test fun `mute falls back raw on junk`() {
        for (junk in listOf(null, "", "#abc", "not-a-color", "3b82f6", "#3B82F", "#3b82f6ff")) {
            assertEquals("$junk", "#93c5fd", DialPalette.mute(junk))
        }
        assertEquals("#98b2dd", DialPalette.mute("#3B82F6"))
        assertEquals("#93c5fd", DialBand.colorHex(DialFaceBlock("t", DialBlockKind.TASK, 0.0, 60.0)))
    }

    @Test fun `variant C numbers are the study's`() {
        assertEquals(0.175, DialBandTreatment.fillOpacity(0.0, 1.0), 1e-12)
        assertEquals(0.56, DialBandTreatment.fillOpacity(1.0, 1.0), 1e-12)
        assertEquals(0.3675, DialBandTreatment.fillOpacity(0.5, 1.0), 1e-12)
        assertEquals(1.5, DialBandTreatment.rimWidth(0.0), 1e-12)
        assertEquals(2.5, DialBandTreatment.rimWidth(1.0), 1e-12)
        assertEquals(2.1, DialBandTreatment.rimWidth(0.6), 1e-12)
        assertEquals(0.45, DialBandTreatment.rimOpacity(0.0, 1.0), 1e-12)
        assertEquals(1.0, DialBandTreatment.rimOpacity(1.0, 1.0), 1e-12)
        assertEquals(0.25, DialBandTreatment.rimOpacity(1.0, 0.25), 1e-12)
        assertEquals(1.0, DialBandTreatment.fillOpacity(1.0, 3.0), 0.0)
        assertEquals(1.0, DialPalette.t(600.0), 0.0)
        assertEquals(0.5, DialPalette.t(90.0), 0.0)
        assertEquals(0.0, DialPalette.t(-5.0), 0.0)
    }

    @Test fun `a styled block carries the study's geometry and weights`() {
        val s = DialBand.style(DialFaceBlock("5", DialBlockKind.TASK, 600.0, 750.0, colorHex = "#3b82f6"), 680.0, false)
        val t = 150.0 / 180.0
        assertEquals("#98b2dd", s.colorHex)
        assertEquals(129.0, s.rInner, 0.0); assertEquals(151.0, s.rOuter, 0.0)
        assertEquals((0.05 + 0.11 * t) * 3.5, s.fillOpacity, 1e-12)
        assertEquals(1.5 + t, s.rimWidth, 1e-12)
        assertEquals(151 - s.rimWidth / 2, s.rimRadius, 1e-12)
        assertEquals(0.45 + 0.55 * t, s.rimOpacity, 1e-12)
        assertFalse(s.isPast)
    }

    @Test fun `overlapping blocks take lane bands as the app does`() {
        val sa = DialBand.style(DialFaceBlock("a", DialBlockKind.TASK, 600.0, 720.0, lane = 0, laneCount = 2), 0.0, false)
        val sb = DialBand.style(DialFaceBlock("b", DialBlockKind.TASK, 630.0, 690.0, lane = 1, laneCount = 2), 0.0, false)
        assertEquals(DialBand.laneBand(129.0, 151.0, 0, 2), sa.rInner to sa.rOuter)
        assertEquals(DialBand.laneBand(129.0, 151.0, 1, 2), sb.rInner to sb.rOuter)
        assertTrue("lanes do not overlap", sa.rOuter < sb.rInner)
    }

    @Test fun `state multipliers on the pushed day`() {
        assertEquals(DialTone(1.0, 1.0), tone(DialBlockKind.TASK, past = false))
        assertEquals(DialTone(1.0, 1.0), tone(DialBlockKind.EVENT, past = false))
        assertEquals(DialTone(0.6, 0.25), tone(DialBlockKind.TASK, completed = true, past = true))
        assertEquals(DialTone(0.6, 0.25), tone(DialBlockKind.TASK, completed = true, past = false))
        assertEquals(DialTone(0.35, 1.0), tone(DialBlockKind.TASK, past = true))
        assertEquals(DialTone(0.6, 0.6), tone(DialBlockKind.EVENT, past = true))
        assertEquals(DialTone(0.6, 0.6), tone(DialBlockKind.TASK, past = true, prev = true))
        assertEquals(DialTone(1.0, 1.0), tone(DialBlockKind.TASK, past = false, prev = true))
    }

    @Test fun `sleep is context not schedule`() {
        assertEquals(DialTone(0.6, 0.6), tone(DialBlockKind.SLEEP, past = false))
        val past = tone(DialBlockKind.SLEEP, past = true)
        assertEquals(0.36, past.fill, 1e-12); assertEquals(0.36, past.edge, 1e-12)
        assertEquals(past, tone(DialBlockKind.SLEEP, past = true, projected = true))
    }

    @Test fun `routines are rim only`() {
        assertEquals(DialTone(0.0, 0.5), tone(DialBlockKind.ROUTINE, past = false))
        assertEquals(DialTone(0.0, 0.5), tone(DialBlockKind.ROUTINE, past = true))
        assertEquals(DialTone(0.0, 0.18), tone(DialBlockKind.ROUTINE, completed = true, past = false))
        val s = DialBand.style(DialFaceBlock("r", DialBlockKind.ROUTINE, 385.0, 420.0, completed = true), 0.0, false)
        assertEquals(0.0, s.fillOpacity, 0.0)
        assertEquals(0.18, s.rimOpacity, 0.0)
        assertEquals("#5eead4", s.colorHex)
        assertEquals(1.5 + 35.0 / 180.0, s.rimWidth, 1e-12)
    }

    @Test fun `a projected day never marks past work as undone`() {
        assertEquals(DialTone(0.35, 1.0), tone(DialBlockKind.TASK, past = true, projected = false))
        assertEquals(DialTone(0.6, 0.6), tone(DialBlockKind.TASK, past = true, projected = true))
        assertEquals(DialTone(1.0, 1.0), tone(DialBlockKind.TASK, past = false, projected = true))
        assertEquals(DialTone(0.6, 0.6), tone(DialBlockKind.TASK, completed = true, past = true, projected = true))
        assertEquals(DialTone(1.0, 1.0), tone(DialBlockKind.TASK, completed = true, past = false, projected = true))
        assertEquals(DialTone(0.0, 0.18), tone(DialBlockKind.ROUTINE, past = true, projected = true))
        assertEquals(DialTone(0.0, 0.5), tone(DialBlockKind.ROUTINE, completed = true, past = false, projected = true))
    }

    @Test fun `past is at or after the end and never across midnight`() {
        val b = DialFaceBlock("b", DialBlockKind.TASK, 540.0, 600.0)
        assertFalse(DialBand.isPast(b, 599.0))
        assertTrue(DialBand.isPast(b, 600.0))
        assertFalse(DialBand.isPast(DialFaceBlock("o", DialBlockKind.TASK, 1380.0, 1440.0, endsNextDay = true), 1440.0))
        assertTrue(DialBand.isPast(DialFaceBlock("c", DialBlockKind.TASK, 0.0, 30.0, startedPrevDay = true), 30.0))
    }

    @Test fun `the past bucket steps once at each end and is a complete key for the band`() {
        val day = listOf(
            DialFaceBlock("sleep", DialBlockKind.SLEEP, 0.0, 385.0),
            DialFaceBlock("r", DialBlockKind.ROUTINE, 385.0, 420.0),
            DialFaceBlock("a", DialBlockKind.TASK, 435.0, 480.0),
            DialFaceBlock("b", DialBlockKind.EVENT, 480.0, 540.0),
            DialFaceBlock("c", DialBlockKind.TASK, 540.0, 600.0),
            DialFaceBlock("d", DialBlockKind.TASK, 600.0, 750.0),
            DialFaceBlock("night", DialBlockKind.SLEEP, 1350.0, 1440.0),
        )
        assertEquals(0, DialBand.pastBucket(day, 384.0))
        assertEquals(1, DialBand.pastBucket(day, 385.0))
        assertEquals(5, DialBand.pastBucket(day, 680.0))
        assertEquals(7, DialBand.pastBucket(day, 1440.0))
        val seen = HashMap<Int, List<DialBlockStyle>>()
        for (minute in 0..1440) {
            val bucket = DialBand.pastBucket(day, minute.toDouble())
            val styles = DialBand.styles(day, minute.toDouble(), false)
            seen[bucket]?.let { assertEquals("bucket $bucket at $minute", it, styles) } ?: seen.put(bucket, styles)
        }
    }
}
