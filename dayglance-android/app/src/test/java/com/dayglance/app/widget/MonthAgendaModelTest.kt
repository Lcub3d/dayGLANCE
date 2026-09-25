package com.dayglance.app.widget

import com.dayglance.app.widget.MonthGridModelTest.Companion.day
import com.dayglance.app.widget.MonthGridModelTest.Companion.fixture
import com.dayglance.app.widget.MonthGridModelTest.Companion.label
import com.dayglance.app.widget.MonthGridModelTest.Companion.window
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * The month + agenda widget's rules: selection, the arrows' bounds, the
 * midnight reset, the arrangement by size, and what the agenda lists for
 * today versus any other day. The selection cases are the iOS extra-large
 * widget's (MonthDaySelectionTests.swift). Through the same live-shaped
 * fixture as MonthGridModelTest: pushed Monday 2026-09-21, Monday weeks, so
 * the grid runs 2026-09-21 … 2026-11-01.
 */
class MonthAgendaModelTest {

    private fun cells(today: String = "2026-09-21"): List<MonthGridCell> {
        val (root, window) = fixture()
        val t = day(today)
        val pushed = WidgetFreshnessRules.evaluate(root.getString("date"), MonthGridModelTest.FIXTURE_CAPTURED_AT_MS, t)
        return MonthGridState.resolve(pushed, window, t, label)!!.cells
    }

    // ── Selection ────────────────────────────────────────────────────────────

    @Test fun `with nothing stored the agenda shows today`() {
        assertEquals("2026-09-21", MonthDaySelection.resolve(null, cells(), "2026-09-21"))
        assertEquals("2026-09-24", MonthDaySelection.resolve(null, cells("2026-09-24"), "2026-09-24"))
    }

    @Test fun `a selection made today is kept`() {
        val stored = MonthDaySelection(date = "2026-10-01", setOn = "2026-09-21")
        assertEquals("2026-10-01", MonthDaySelection.resolve(stored, cells(), "2026-09-21"))
    }

    @Test fun `the selection resets to today at midnight`() {
        // Paged to 1 October on the 21st; the next day it reads as today, so a
        // widget left on a day does not stay there — even if nothing cleared
        // the stored record at 00:00.
        val stored = MonthDaySelection(date = "2026-10-01", setOn = "2026-09-21")
        assertEquals("2026-09-22", MonthDaySelection.resolve(stored, cells("2026-09-22"), "2026-09-22"))
        // A week later, too (the grid has moved on a week by then).
        assertEquals("2026-09-28", MonthDaySelection.resolve(stored, cells("2026-09-28"), "2026-09-28"))
    }

    @Test fun `a selection no longer on the grid falls back to today`() {
        val stored = MonthDaySelection(date = "2026-12-25", setOn = "2026-09-21")
        assertEquals("2026-09-21", MonthDaySelection.resolve(stored, cells(), "2026-09-21"))
    }

    private fun staleCells(today: String): List<MonthGridCell> {
        val (root, window) = fixture()
        val t = day(today)
        val pushed = WidgetFreshnessRules.evaluate(root.getString("date"), MonthGridModelTest.FIXTURE_CAPTURED_AT_MS, t)
        val state = MonthGridState.resolve(pushed, window, t, label)!!
        assertTrue(state.isStale)
        return state.cells
    }

    @Test fun `a stale grid that still contains today selects today`() {
        // 28 days past the push: stale (the window no longer covers today's
        // own grid), but the push's grid, which a stale widget draws, still
        // runs to 1 November. As on iOS, today is selected.
        assertEquals("2026-10-19", MonthDaySelection.resolve(null, staleCells("2026-10-19"), "2026-10-19"))
    }

    @Test fun `a stale grid without today selects its first day`() {
        assertEquals("2026-09-21", MonthDaySelection.resolve(null, staleCells("2026-11-09"), "2026-11-09"))
    }

    @Test fun `an empty grid has no selection`() {
        assertNull(MonthDaySelection.resolve(null, emptyList(), "2026-09-21"))
    }

    // ── Arrows ───────────────────────────────────────────────────────────────

    @Test fun `the arrows step one day either way`() {
        assertEquals("2026-09-30" to "2026-10-02", MonthDaySelection.neighbours("2026-10-01", cells()))
    }

    @Test fun `the arrows stop at both ends of the 42 visible days`() {
        val c = cells()
        assertEquals(42, c.size)
        assertEquals(null to "2026-09-22", MonthDaySelection.neighbours(c.first().date, c))
        assertEquals("2026-10-31" to null, MonthDaySelection.neighbours(c.last().date, c))
        assertEquals("2026-11-01", c.last().date)
    }

    @Test fun `paging every day from one end reaches the other in 41 steps`() {
        val c = cells()
        var at: String? = c.first().date
        var steps = 0
        // Capped, so an arrow that wraps fails here rather than looping forever.
        while (steps <= c.size) {
            val next = MonthDaySelection.neighbours(at, c).second ?: break
            at = next; steps++
        }
        assertEquals(41, steps)
        assertEquals(c.last().date, at)
    }

    @Test fun `Today shows only when paged away and today is on the grid`() {
        assertFalse(MonthDaySelection.showsToday("2026-09-21", cells(), "2026-09-21"))
        assertTrue(MonthDaySelection.showsToday("2026-10-01", cells(), "2026-09-21"))
        // A stale grid without today: nowhere to return to.
        assertFalse(MonthDaySelection.showsToday("2026-09-21", staleCells("2026-11-09"), "2026-11-09"))
    }

    @Test fun `a day off the grid has no arrows`() {
        assertEquals(null to null, MonthDaySelection.neighbours("2026-12-25", cells()))
        assertEquals(null to null, MonthDaySelection.neighbours(null, cells()))
    }

    // ── Arrangement ──────────────────────────────────────────────────────────

    @Test fun `phones stack and tablets go side by side`() {
        // Phone 4 × 5 and 5 × 6 portrait placements.
        assertEquals(MonthAgendaArrangement.STACKED, MonthAgendaLayout.arrangement(250.0, 320.0))
        assertEquals(MonthAgendaArrangement.STACKED, MonthAgendaLayout.arrangement(330.0, 460.0))
        // Tablet 8 × 4 and 8 × 6; a phone in landscape.
        assertEquals(MonthAgendaArrangement.SIDE_BY_SIDE, MonthAgendaLayout.arrangement(530.0, 250.0))
        assertEquals(MonthAgendaArrangement.SIDE_BY_SIDE, MonthAgendaLayout.arrangement(530.0, 390.0))
        assertEquals(MonthAgendaArrangement.SIDE_BY_SIDE, MonthAgendaLayout.arrangement(600.0, 230.0))
    }

    @Test fun `the side-by-side thresholds`() {
        assertEquals(MonthAgendaArrangement.SIDE_BY_SIDE, MonthAgendaLayout.arrangement(460.0, 368.0))
        // Just under the width, or just under the aspect: stacked.
        assertEquals(MonthAgendaArrangement.STACKED, MonthAgendaLayout.arrangement(459.0, 250.0))
        assertEquals(MonthAgendaArrangement.STACKED, MonthAgendaLayout.arrangement(460.0, 369.0))
        // A big square stays stacked.
        assertEquals(MonthAgendaArrangement.STACKED, MonthAgendaLayout.arrangement(600.0, 600.0))
    }

    @Test fun `the grid pane is half the width side by side and five eighths of the height stacked`() {
        assertEquals(264.5 to 250.0, MonthAgendaLayout.gridPane(530.0, 250.0))
        assertEquals(250.0 to 199.0, MonthAgendaLayout.gridPane(250.0, 320.0))
    }

    @Test fun `a tall stacked placement splits evenly`() {
        assertFalse(MonthAgendaLayout.stackedIsEven(439.0))
        assertTrue(MonthAgendaLayout.stackedIsEven(440.0))
        assertEquals(320.0 to 273.0, MonthAgendaLayout.gridPane(320.0, 439.0))
        assertEquals(320.0 to 219.0, MonthAgendaLayout.gridPane(320.0, 440.0))
    }

    @Test fun `every minimum still holds six legible rows`() {
        for ((w, h) in listOf(
            MonthAgendaLayout.MIN_WIDTH to MonthAgendaLayout.MIN_HEIGHT,
            MonthAgendaLayout.SIDE_MIN_WIDTH to 250.0,
            // The first even split, the narrowest phone width.
            MonthAgendaLayout.MIN_WIDTH to MonthAgendaLayout.STACKED_EVEN_MIN_HEIGHT,
        )) {
            val (pw, ph) = MonthAgendaLayout.gridPane(w, h)
            // With the note line shown, the tightest case.
            val m = MonthGridMetrics(pw, ph, MonthGridMetrics.NOTE_HEIGHT)
            assertTrue("cell height at ${w}x$h: ${m.cellHeight}", m.cellHeight >= 24)
            assertTrue("track at ${w}x$h: ${m.trackHeight}", m.trackHeight >= 10)
            assertTrue("rows fit at ${w}x$h", m.cellHeight * MonthGrid.ROWS <= m.gridHeight)
        }
    }

    // ── Content: today versus any other day ─────────────────────────────────

    @Test fun `today reads the Today widget list and every other day the window rows`() {
        assertEquals(MonthAgendaSource.TODAY_WIDGET, MonthAgendaContent.sourceFor("2026-09-21", "2026-09-21"))
        assertEquals(MonthAgendaSource.WINDOW_ROWS, MonthAgendaContent.sourceFor("2026-09-22", "2026-09-21"))
        // The push's day on a stale grid is not today any more.
        assertEquals(MonthAgendaSource.WINDOW_ROWS, MonthAgendaContent.sourceFor("2026-09-21", "2026-10-19", gridIsStale = true))
        // And today itself on a stale grid reads the window: the Today list
        // would be the push's day under today's date.
        assertEquals(MonthAgendaSource.WINDOW_ROWS, MonthAgendaContent.sourceFor("2026-10-19", "2026-10-19", gridIsStale = true))
        assertFalse(MonthAgendaContent.INCLUDES_HABITS)
    }

    private fun lines(date: String, use24: Boolean = false): List<MonthAgendaLine> {
        val cell = cells().first { it.date == date }
        return MonthAgendaContent.windowLines(cell.agenda, cell.agendaMore, use24, Locale.US)
    }

    @Test fun `another day lists all-day items, deadlines and scheduled rows in the Today widget's order`() {
        assertEquals(
            listOf(
                MonthAgendaLine.Section("ALL DAY"),
                MonthAgendaLine.Item("Rent due", "#ef4444", "ALL DAY", "", false),
                MonthAgendaLine.Item("Submit expense report", "#ef4444", "DUE", "", false),
                MonthAgendaLine.Section("SCHEDULED"),
                MonthAgendaLine.Item("Standup", "#3b82f6", "", "8:30 – 9:00 AM", false),
            ),
            lines("2026-10-01").take(5),
        )
        assertEquals(9 + 2, lines("2026-10-01").size)
    }

    @Test fun `completed items stay and are flagged`() {
        val sept25 = lines("2026-09-25")
        val dentist = sept25.filterIsInstance<MonthAgendaLine.Item>().first { it.title == "Dentist" }
        assertTrue(dentist.completed)
        assertEquals(7, sept25.filterIsInstance<MonthAgendaLine.Item>().size)
        assertEquals(1, sept25.filterIsInstance<MonthAgendaLine.Item>().count { it.completed })
    }

    @Test fun `routines never appear from the window, not even on the pushed day`() {
        // The pushed day's payload carries today's routine ("Stretch"), but
        // today reads the Today widget; were it ever read from here, the
        // routine would still be left out.
        val pushedDay = lines("2026-09-21")
        assertFalse(pushedDay.filterIsInstance<MonthAgendaLine.Item>().any { it.title == "Stretch" })
        assertEquals(5, pushedDay.filterIsInstance<MonthAgendaLine.Item>().size)
    }

    @Test fun `a day with nothing says so`() {
        assertEquals(listOf(MonthAgendaLine.Nothing), lines("2026-09-26"))
    }

    @Test fun `rows past the twelve carried end in a more line`() {
        val rows = (0 until 12).map { MonthAgendaRow(t = "Item $it", c = "#3b82f6", s = 480.0 + it * 30, d = 30.0) }
        val out = MonthAgendaContent.windowLines(rows, more = 5, use24Hour = true, locale = Locale.US)
        assertEquals(MonthAgendaLine.More(5), out.last())
        assertEquals(12, out.count { it is MonthAgendaLine.Item })
    }

    @Test fun `time lines match the Today widget`() {
        assertEquals("9:00 – 10:30 AM", MonthAgendaContent.timeLine(540.0, 90.0, false, Locale.US))
        assertEquals("9:00 – 10:30", MonthAgendaContent.timeLine(540.0, 90.0, true, Locale.US))
        assertEquals("12:15 – 1:00 PM", MonthAgendaContent.timeLine(735.0, 45.0, false, Locale.US))
        assertEquals("9:00 AM", MonthAgendaContent.timeLine(540.0, 0.0, false, Locale.US))
        // Past midnight wraps (the fixture's 22:30 block on the 22nd).
        assertEquals("22:30 – 0:30", MonthAgendaContent.timeLine(1350.0, 120.0, true, Locale.US))
        // Fractional minutes round.
        assertEquals("9:01 AM", MonthAgendaContent.timeLine(540.6, 0.0, false, Locale.US))
    }

    @Test fun `the agenda rows decode from the live payload`() {
        val (_, window) = fixture()
        val oct1 = window.days.first { it.date == "2026-10-01" }
        assertEquals(9, oct1.agenda.size)
        assertEquals("a", oct1.agenda[0].k)
        assertEquals("l", oct1.agenda[1].k)
        assertEquals(510.0, oct1.agenda[2].s!!, 0.0)
        val pushed = window.days.first { it.date == "2026-09-21" }
        assertTrue(pushed.agenda.first().isCompleted)
        assertEquals("r", pushed.agenda.first().k)
    }

    @Test fun `a push from before the agenda decodes with empty lists`() {
        val w = window("2026-09-21", 1)
        assertTrue(w.days.all { it.agenda.isEmpty() && it.agendaMore == 0 })
        val json = """{"monthWindow":{"from":"2026-09-21","weekStart":1,"days":[{"date":"2026-09-21","bars":[],"agenda":[{"t":"A"},{"c":"#fff"},{"t":"B","s":"bad","x":1}]}]}}"""
        val decoded = MonthWindowStore.decode(json)!!.days.single()
        assertEquals(listOf("A", "B"), decoded.agenda.map { it.t })
        assertNull(decoded.agenda[1].s)
        assertTrue(decoded.agenda[1].isCompleted)
    }
}
