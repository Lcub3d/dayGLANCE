package com.dayglance.app.widget.dial

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The All Day card and the legend, and where a placement puts them. */
class DialCardsTest {

    private val root: JSONObject by lazy {
        JSONObject(DialCardsTest::class.java.getResourceAsStream("/widgetSnapshot.live.json")!!.bufferedReader().readText())
    }

    private fun fields(allDay: String = "[]", totals: String? = """{"effortMinutes":200,"restoreMinutes":170,"sleepMinutes":480,"unblockedMinutes":590}""",
                       blocks: String = "[]") =
        JSONObject("""{"dial":{"blocks":$blocks,"allDay":$allDay${if (totals != null) ""","totals":$totals""" else ""}}}""")

    private fun cards(f: JSONObject) = DialCards.from(f, DialFaceInput.from(f, false).blocks)

    @Test fun `the fixture's pushed day carries the legend, in the app's order`() {
        val c = DialCards.from(root, DialFaceInput.from(root, false).blocks)
        assertEquals(listOf(DialLegendKey.EFFORT, DialLegendKey.RESTORE, DialLegendKey.SLEEP, DialLegendKey.UNBLOCKED), c.legend.map { it.key })
        assertEquals(200.0, c.legend[0].minutes!!, 0.0)
        assertEquals(590.0, c.legend[3].minutes!!, 0.0)
        assertTrue(c.allDay.isEmpty())
        // Every projected day has its own.
        val day = root.getJSONArray("days").getJSONObject(0)
        assertEquals(4, DialCards.from(day, DialFaceInput.from(day, true).blocks).legend.size)
    }

    @Test fun `no declared window means no sleep and no unblocked, as in the app`() {
        val c = cards(fields(totals = """{"effortMinutes":60,"restoreMinutes":0,"sleepMinutes":null,"unblockedMinutes":null}"""))
        assertEquals(listOf(DialLegendKey.EFFORT, DialLegendKey.RESTORE), c.legend.map { it.key })
    }

    @Test fun `routines are counted off the ring, done over total`() {
        val c = cards(fields(blocks = """[{"type":"routine","id":"r1","startMin":420,"durationMin":15,"completed":true},
            {"type":"routine","id":"r2","startMin":1260,"durationMin":30,"completed":false}]"""))
        val r = c.legend.last()
        assertEquals(DialLegendKey.ROUTINES, r.key)
        assertEquals(1, r.done); assertEquals(2, r.total)
    }

    @Test fun `an app build without totals draws no legend rather than an empty day`() {
        val c = cards(fields(allDay = """[{"id":"a","title":"Holiday","completed":false,"colorHex":"#ef4444"}]""", totals = null))
        assertTrue(c.legend.isEmpty())
        assertEquals(listOf("Holiday"), c.allDay.map { it.title })
        assertTrue(DialCards.from(JSONObject("{}"), emptyList()).isEmpty)
    }

    @Test fun `all-day items keep their order, completion and colour`() {
        val c = cards(fields(allDay = """[{"id":"a","title":"Holiday","completed":false,"colorHex":"#ef4444"},
            {"id":"b","title":"Water plants","completed":true,"colorHex":null}]"""))
        assertEquals(listOf("Holiday", "Water plants"), c.allDay.map { it.title })
        assertFalse(c.allDay[0].completed); assertTrue(c.allDay[1].completed)
        assertEquals(null, c.allDay[1].colorHex)
    }

    @Test fun `the card key changes with what the cards draw`() {
        val a = cards(fields()).key
        assertEquals(a, cards(fields()).key)
        assertFalse(a == cards(fields(totals = """{"effortMinutes":201,"restoreMinutes":170,"sleepMinutes":480,"unblockedMinutes":590}""")).key)
    }

    // ── placement ──

    private val both = DialCards(
        listOf(DialAllDayItem("a", "Holiday", false, "#ef4444")),
        listOf(DialLegendItem(DialLegendKey.EFFORT, 60.0), DialLegendItem(DialLegendKey.RESTORE, 30.0)),
    )
    private val legendOnly = both.copy(allDay = emptyList())

    @Test fun `a square-ish placement is the dial alone`() {
        assertEquals(DialPlacement.DIAL, DialArrangement.choose(300.0, 315.0, both).placement)
        assertEquals(DialPlacement.DIAL, DialArrangement.choose(300.0, 340.0, both).placement)
    }

    @Test fun `a tall placement puts the cards below, never shrinking the dial`() {
        val a = DialArrangement.choose(300.0, 450.0, both)
        assertEquals(DialPlacement.TALL, a.placement)
        assertTrue(a.showAllDay)
        assertEquals(300.0, a.dialWidthDp, 0.0)
        assertTrue("the dial's box still fits a width-limited face", a.dialHeightDp >= 300.0 * 382 / 364)
        // Room for one card only: the All Day one wins it; the legend when there is none.
        val one = DialArrangement.choose(300.0, 380.0, both)
        assertEquals(DialPlacement.TALL, one.placement)
        assertTrue(one.showAllDay); assertFalse(one.showLegend)
        val legend = DialArrangement.choose(300.0, 380.0, legendOnly)
        assertFalse(legend.showAllDay); assertTrue(legend.showLegend)
        assertEquals(380.0 - 62.0, legend.dialHeightDp, 0.0)
        // Chips by width, capped by the layout's three.
        assertEquals(2, DialArrangement.choose(300.0, 450.0, both).allDayChips)
        assertEquals(3, DialArrangement.choose(600.0, 900.0, both).allDayChips)
    }

    @Test fun `the tall legend takes a second row only for unblocked or routines`() {
        assertEquals(56.0, DialArrangement.tallLegendDp(legendOnly), 0.0)
        val full = legendOnly.copy(legend = legendOnly.legend + DialLegendItem(DialLegendKey.UNBLOCKED, 90.0))
        assertEquals(96.0, DialArrangement.tallLegendDp(full), 0.0)
        // A taller legend needs more spare height before it is placed.
        assertEquals(DialPlacement.TALL, DialArrangement.choose(300.0, 380.0, legendOnly).placement)
        assertEquals(DialPlacement.DIAL, DialArrangement.choose(300.0, 380.0, full).placement)
    }

    @Test fun `a wide placement puts the cards beside`() {
        val a = DialArrangement.choose(520.0, 300.0, both)
        assertEquals(DialPlacement.WIDE, a.placement)
        assertEquals(520.0 - DialArrangement.WIDE_COLUMN_DP, a.dialWidthDp, 0.0)
        assertTrue("the dial's box still fits a height-limited face", a.dialWidthDp >= 300.0 * 364 / 382)
        assertTrue(a.showAllDay)
        // Too short for the legend column: not wide.
        assertEquals(DialPlacement.DIAL, DialArrangement.choose(400.0, 80.0, legendOnly).placement)
    }

    @Test fun `nothing to show is the dial alone at any size`() {
        assertEquals(DialPlacement.DIAL, DialArrangement.choose(300.0, 600.0, DialCards.NONE).placement)
        assertEquals(DialPlacement.DIAL, DialArrangement.choose(700.0, 300.0, DialCards.NONE).placement)
    }

    @Test fun `overflow shows what fits and counts the rest`() {
        assertEquals(2 to 3, DialArrangement.overflow(5, 2))
        assertEquals(1 to 0, DialArrangement.overflow(1, 3))
        assertEquals(0 to 4, DialArrangement.overflow(4, 0))
    }

    // The binder touches only ids a placement's layout carries: this pins the
    // layouts to what DayDialCardsBinder assumes.
    @Test fun `each placement's layout carries exactly the views its binder touches`() {
        fun ids(name: String) = Regex("@\\+id/([a-z0-9_]+)").findAll(File("src/main/res/layout/$name.xml").readText()).map { it.groupValues[1] }.toSet()
        val box = ids("widget_day_dial_box")
        for ((placement, file) in listOf(DialPlacement.DIAL to "widget_day_dial", DialPlacement.TALL to "widget_day_dial_tall", DialPlacement.WIDE to "widget_day_dial_wide")) {
            val all = ids(file) + box
            assertTrue(file, "day_dial_root" in all && "iv_day_dial_face" in all && "iv_day_dial_needle" in all)
            assertTrue(file, File("src/main/res/layout/$file.xml").readText().contains("@layout/widget_day_dial_box"))
            val chips = (1..10).count { "ll_day_dial_allday_chip_$it" in all }
            assertEquals(file, chipsExpected(placement), chips)
            for (n in 1..chips) assertTrue("$file chip $n", "iv_day_dial_allday_dot_$n" in all && "tv_day_dial_allday_title_$n" in all)
            val cards = placement != DialPlacement.DIAL
            assertEquals(file, cards, "ll_day_dial_allday" in all && "tv_day_dial_allday_more" in all && "ll_day_dial_legend" in all)
            assertEquals("$file row2", placement == DialPlacement.TALL, "ll_day_dial_legend_row2" in all)
            for (k in DialLegendKey.entries.map { it.name.lowercase() }) {
                assertEquals("$file $k", cards, "ll_day_dial_legend_$k" in all && "tv_day_dial_legend_${k}_value" in all)
            }
        }
    }

    private fun chipsExpected(p: DialPlacement) = when (p) {
        DialPlacement.DIAL -> 0
        DialPlacement.TALL -> DialArrangement.MAX_TALL_CHIPS
        DialPlacement.WIDE -> DialArrangement.MAX_WIDE_ROWS
    }
}
