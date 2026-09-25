package com.dayglance.app.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The month grid's rules, through the live-shaped fixture the JS producers
 * write (dayglance-ios/TestFixtures/widgetSnapshot.live.json — pushed Monday
 * 2026-09-21 in Denver, Monday weeks, a crowded 1 October; served here as a
 * test resource) and through small synthetic windows where a rule needs a
 * shape the fixture does not have. A port of the iOS widget's
 * MonthGridModelTests.swift, case for case, so the two widgets cannot drift.
 *
 * Not ported: the WidgetKit timeline tests. Android has no timeline — the
 * midnight alarm (MidnightRolloverReceiver) re-renders the grid and the
 * coverage rule below decides what it shows.
 */
class MonthGridModelTest {

    companion object {
        val locale: Locale = Locale.US
        private val monthDay = DateTimeFormatter.ofPattern("MMM d", locale)
        val label: (LocalDate) -> String = { it.format(monthDay) }
        /** The fixture's push: 2026-09-21 18:00 UTC (noon in Denver). */
        const val FIXTURE_CAPTURED_AT_MS = 1_790_013_600_000L

        fun fixtureJson(): String =
            MonthGridModelTest::class.java.getResourceAsStream("/widgetSnapshot.live.json")!!
                .bufferedReader().use { it.readText() }

        fun fixture(): Pair<JSONObject, MonthWindowPayload> {
            val json = fixtureJson()
            val root = JSONObject(json)
            val window = MonthWindowStore.decode(json) ?: error("the month window decodes from the live payload")
            return root to window
        }

        fun day(iso: String): LocalDate = LocalDate.parse(iso)

        /** A synthetic 49-day window from [from], with a bar on every day so a
         *  cell can be traced to its date. */
        fun window(from: String, weekStart: Int, count: Int = 49): MonthWindowPayload {
            val start = day(from)
            val days = (0 until count).map { i ->
                MonthWindowDay(date = MonthGrid.isoDay(start.plusDays(i.toLong())), bars = listOf(MonthWindowBar(540.0, 60.0, "#3b82f6")))
            }
            return MonthWindowPayload(from = from, weekStart = weekStart, days = days)
        }
    }

    /** The stored snapshot's freshness as the widgets read it on [today]. */
    private fun pushed(snapshotDate: String?, today: LocalDate, capturedAtMs: Long = FIXTURE_CAPTURED_AT_MS) =
        WidgetFreshnessRules.evaluate(snapshotDate, capturedAtMs, today)

    private fun resolve(snapshotDate: String?, window: MonthWindowPayload?, today: String): MonthGridState? {
        val t = day(today)
        return MonthGridState.resolve(pushed(snapshotDate, t), window, t, label)
    }

    private fun resolveFixture(window: MonthWindowPayload?, today: String): MonthGridState? {
        val (root, _) = fixture()
        return resolve(root.getString("date"), window, today)
    }

    // ── Decoding ─────────────────────────────────────────────────────────────

    @Test
    fun `the fixture window is what the producers built`() {
        val (_, window) = fixture()
        assertEquals("2026-09-21", window.from)
        assertEquals(1, window.weekStart)
        assertEquals("six weeks plus the rollover tail", 49, window.days.size)
        assertEquals("2026-09-21", window.days.first().date)
        assertEquals("2026-11-08", window.days.last().date)
    }

    /** The month window is decoded on its own: a malformed one costs this
     *  widget its grid, never the other widgets their snapshot. */
    @Test
    fun `a malformed window leaves the snapshot alone`() {
        val json = """{"date":"2026-09-21","updatedAt":1,"monthWindow":{"from":"2026-09-21","weekStart":1,"days":"oops"}}"""
        assertEquals("the rest of the payload is untouched", "2026-09-21", JSONObject(json).optString("date"))
        assertNull(MonthWindowStore.decode(json))
        // A day without a date, a non-object day, and no root at all.
        assertNull(MonthWindowStore.decode("""{"monthWindow":{"days":[{"bars":[]}]}}"""))
        assertNull(MonthWindowStore.decode("""{"monthWindow":{"days":[1]}}"""))
        assertNull(MonthWindowStore.decode("not json"))
    }

    @Test
    fun `an absent or null window is null`() {
        assertNull(MonthWindowStore.decode("""{"date":"2026-09-21"}"""))
        assertNull(MonthWindowStore.decode("""{"date":"2026-09-21","monthWindow":null}"""))
        assertNull(MonthWindowStore.decode(null))
        assertNull(MonthWindowStore.decode(""))
    }

    @Test
    fun `fractional minutes and missing lists still decode`() {
        val json = """{"monthWindow":{"weekStart":0,"days":[{"date":"2026-09-20","bars":[{"s":540.5,"d":22.5,"c":"#fff000"}]}]}}"""
        val window = MonthWindowStore.decode(json) ?: error("decodes")
        assertEquals(listOf(MonthWindowBar(540.5, 22.5, "#fff000")), window.days[0].bars)
        assertEquals(emptyList<String>(), window.days[0].allDay)
        assertEquals(emptyList<String>(), window.days[0].deadlines)
        assertEquals(0, window.weekStart)
        assertNull(window.from)
    }

    /** As the Swift decoder: one malformed bar drops that day's bars, not the window. */
    @Test
    fun `a malformed bar costs its day the bars and nothing else`() {
        val json = """{"monthWindow":{"weekStart":0,"days":[{"date":"2026-09-20","bars":[{"s":540,"d":30,"c":"#fff000"},{"s":"nine"}],"allDay":["#f00"]},{"date":"2026-09-21","bars":[{"s":600,"d":30,"c":"#000"}]}]}}"""
        val window = MonthWindowStore.decode(json) ?: error("decodes")
        assertEquals(emptyList<MonthWindowBar>(), window.days[0].bars)
        assertEquals(listOf("#f00"), window.days[0].allDay)
        assertEquals(1, window.days[1].bars.size)
    }

    // ── Which 42 days ────────────────────────────────────────────────────────

    @Test
    fun `the grid starts on the payloads week start not Sunday`() {
        val thu = day("2026-09-24")
        assertEquals(day("2026-09-20"), MonthGrid.gridStart(thu, 0))
        assertEquals(day("2026-09-21"), MonthGrid.gridStart(thu, 1))
        // A Sunday with Monday weeks belongs to the week that started six days earlier.
        val sun = day("2026-09-27")
        assertEquals(day("2026-09-21"), MonthGrid.gridStart(sun, 1))
        assertEquals(day("2026-09-27"), MonthGrid.gridStart(sun, 0))
        // Out-of-range week starts wrap like the JS module's modulo.
        assertEquals(MonthGrid.gridStart(thu, 1), MonthGrid.gridStart(thu, 8))
        assertEquals(MonthGrid.gridStart(thu, 6), MonthGrid.gridStart(thu, -1))

        val monday = MonthGrid.weekdayInitials(1, locale)
        assertEquals(7, monday.size)
        assertEquals("Monday first", "M", monday.first())
        assertEquals("Sunday last", "S", monday.last())
        assertEquals("Sunday first", "S", MonthGrid.weekdayInitials(0, locale).first())
        assertEquals("Saturday last", "S", MonthGrid.weekdayInitials(0, locale).last())
        assertEquals(listOf("S", "M", "T", "W", "T", "F", "S"), MonthGrid.weekdayInitials(0, locale))
    }

    /** resolveMonthWindow's contract: the week containing the day, by date. */
    @Test
    fun `days mirror resolveMonthWindow`() {
        val window = window("2026-09-20", 0)
        val sat = MonthGrid.days(window, day("2026-09-26")) ?: error("covered")
        assertEquals("2026-09-20", sat.first().date)
        assertEquals("2026-10-31", sat.last().date)
        // Across the week boundary: the next six weeks, the last row from the tail.
        val sun = MonthGrid.days(window, day("2026-09-27")) ?: error("covered")
        assertEquals(42, sun.size)
        assertEquals("2026-09-27", sun.first().date)
        assertEquals("2026-11-07", sun.last().date)
        // Two boundaries on, or before the window: not covered.
        assertNull(MonthGrid.days(window, day("2026-10-04")))
        assertNull(MonthGrid.days(window, day("2026-09-19")))
        // A window without its tail cannot serve the boundary: never a partial grid.
        val short = window("2026-09-20", 0, count = 42)
        assertNull(MonthGrid.days(short, day("2026-09-27")))
    }

    // ── DST ──────────────────────────────────────────────────────────────────
    //
    // The model picks its 42 days by date string and slices by index, and its
    // one piece of date arithmetic — the grid start — is done on LocalDate,
    // in calendar days. A transition inside the grid, or inside the week the
    // start is subtracted across, cannot move anything. Denver leaves DST on
    // Sunday 1 Nov 2026; Cairo springs forward at midnight into Friday 24
    // April 2026, midweek, where a seconds-based subtraction would land a day
    // early.

    @Test
    fun `a grid containing the DST change is forty-two consecutive days`() {
        val window = window("2026-10-18", 0)
        val days = MonthGrid.days(window, day("2026-10-20")) ?: error("covered")
        assertEquals(42, days.size)
        assertEquals("2026-10-18", days.first().date)
        assertEquals("2026-11-01", days[14].date)
        assertEquals("2026-11-28", days.last().date)
        val parsed = days.map { day(it.date) }
        parsed.zipWithNext().forEach { (a, b) -> assertEquals("$a → $b", a.plusDays(1), b) }
    }

    @Test
    fun `the grid start is calendar days across a spring forward`() {
        val sat = day("2026-04-25")
        assertEquals(day("2026-04-19"), MonthGrid.gridStart(sat, 0))
        val window = MonthWindowPayload("2026-04-19", 0, (0 until 49).map { MonthWindowDay(MonthGrid.isoDay(day("2026-04-19").plusDays(it.toLong()))) })
        assertEquals("2026-04-19", MonthGrid.days(window, sat)?.first()?.date)
    }

    @Test
    fun `the day after the fall back draws the right today`() {
        val window = window("2026-10-25", 0)   // Sunday weeks
        val state = resolve("2026-10-31", window, "2026-11-02") ?: error("covered")
        assertEquals("2026-11-02", state.cells.first { it.isToday }.date)
        assertEquals(MonthGridTier.PROJECTED, state.tier)
    }

    // ── Tiers and rollover ───────────────────────────────────────────────────

    @Test
    fun `the fixture across its days`() {
        // Pushed Monday 21 Sep, Monday weeks: the window is 21 Sep … 8 Nov,
        // so grids starting 21 Sep and 28 Sep are covered — live through
        // Sunday 4 Oct, thirteen days past the push.
        val (_, window) = fixture()

        val mon = resolveFixture(window, "2026-09-21") ?: error("drawn")
        assertEquals(MonthGridTier.PUSHED, mon.tier)
        assertEquals(42, mon.cells.size)
        assertEquals(0, mon.cells.indexOfFirst { it.isToday })
        assertFalse(mon.freshness.isStale)
        assertEquals(1, mon.weekStart)

        // Every later day of the push's week: the same grid, today moving.
        for (offset in 1..6) {
            val d = day("2026-09-21").plusDays(offset.toLong())
            val s = resolveFixture(window, MonthGrid.isoDay(d)) ?: error("drawn $d")
            assertEquals("$d", MonthGridTier.PROJECTED, s.tier)
            assertFalse(s.freshness.isStale)
            assertEquals(d, s.freshness.snapshotDate)
            assertEquals(FIXTURE_CAPTURED_AT_MS, s.freshness.capturedAtMs)
            assertEquals("2026-09-21", s.cells.first().date)
            assertEquals(offset, s.cells.indexOfFirst { it.isToday })
        }
        // The next week: the grid moves down a row, the last row from the tail.
        val nextMon = resolveFixture(window, "2026-09-28") ?: error("drawn")
        assertEquals(MonthGridTier.PROJECTED, nextMon.tier)
        assertEquals("2026-09-28", nextMon.cells.first().date)
        assertEquals("2026-11-08", nextMon.cells.last().date)
        // Past the other widgets' horizon (they go Outdated on the 25th) and still live.
        assertEquals(MonthGridTier.PROJECTED, resolveFixture(window, "2026-09-25")?.tier)
        val lastLive = resolveFixture(window, "2026-10-04") ?: error("drawn")
        assertEquals(MonthGridTier.PROJECTED, lastLive.tier)
        assertEquals(6, lastLive.cells.indexOfFirst { it.isToday })

        // The first day whose grid the window cannot cover: stale, and the
        // push's own grid, not a partial one.
        val stale = resolveFixture(window, "2026-10-05") ?: error("drawn")
        assertEquals(MonthGridTier.STALE, stale.tier)
        assertTrue(stale.freshness.isStale)
        assertEquals(14, stale.freshness.daysOld)
        assertEquals(day("2026-09-21"), stale.freshness.snapshotDate)
        assertEquals(42, stale.cells.size)
        assertEquals("2026-09-21", stale.cells.first().date)
        assertEquals(-1, stale.cells.indexOfFirst { it.isToday })

        // Clock moved back before the window: stale too.
        assertEquals(MonthGridTier.STALE, resolveFixture(window, "2026-09-20")?.tier)
    }

    /** How long the grid stays live depends only on where in its week the
     *  push landed: through the end of the NEXT week, so 13 days past a push
     *  on the first day of the week down to 7 past one on the last. Every
     *  weekday, both week starts. */
    @Test
    fun `the grid lives until the end of the week after the push`() {
        for ((weekStart, from) in listOf(0 to "2026-09-20", 1 to "2026-09-21")) {
            val window = window(from, weekStart)
            val w0 = day(from)
            for (k in 0..6) {
                val pushDay = w0.plusDays(k.toLong())
                val pushStr = MonthGrid.isoDay(pushDay)
                var live = 0
                var d = pushDay
                while (resolve(pushStr, window, MonthGrid.isoDay(d))?.tier != MonthGridTier.STALE && live < 60) {
                    live += 1
                    d = d.plusDays(1)
                }
                val label = "weekStart $weekStart, push on day $k of the week"
                // Across the week boundary the grid moves down a row, its last
                // row from the rollover tail.
                val nextWeek = w0.plusDays(7)
                val rolled = resolve(pushStr, window, MonthGrid.isoDay(nextWeek)) ?: error(label)
                assertEquals(label, MonthGrid.isoDay(nextWeek), rolled.cells.first().date)
                assertEquals(label, window.days.last().date, rolled.cells.last().date)
                assertEquals(label, 0, rolled.cells.indexOfFirst { it.isToday })
                assertEquals("$label: days live past the push", 13 - k, live - 1)
                assertEquals("$label: stale from the Monday/Sunday two weeks on", w0.plusDays(14), d)
            }
        }
    }

    @Test
    fun `a snapshot that did not say its day is drawn as pushed`() {
        val window = window("2026-09-20", 0)
        val s = resolve(null, window, "2026-09-23") ?: error("drawn")
        assertEquals(MonthGridTier.UNKNOWN, s.tier)
        assertEquals(3, s.cells.indexOfFirst { it.isToday })
        assertFalse(s.freshness.isStale)
        // …and once uncovered, stale with the window's first 42 days.
        val stale = resolve(null, window, "2026-10-04") ?: error("drawn")
        assertEquals(MonthGridTier.STALE, stale.tier)
        assertEquals("2026-09-20", stale.cells.first().date)
        assertEquals(0, stale.freshness.daysOld)
    }

    @Test
    fun `no window means nothing to draw`() {
        val (root, _) = fixture()
        assertNull(resolve(root.getString("date"), null, "2026-09-21"))
        assertNull(resolve(root.getString("date"), MonthWindowPayload(null, 0, emptyList()), "2026-09-21"))
    }

    @Test
    fun `the placeholder is this weeks six weeks with today marked`() {
        val p = MonthGridState.placeholder(day("2026-09-24"), 1, label)
        assertEquals(MonthGridTier.UNKNOWN, p.tier)
        assertEquals(42, p.cells.size)
        assertEquals("2026-09-21", p.cells.first().date)
        assertEquals("2026-11-01", p.cells.last().date)
        assertEquals(3, p.cells.indexOfFirst { it.isToday })
        assertTrue(p.cells.all { it.bars.isEmpty() && !it.hasPip })
        assertEquals(1, p.weekStart)
    }

    // ── Cells ────────────────────────────────────────────────────────────────

    @Test
    fun `the fixtures cells`() {
        val (_, window) = fixture()
        val cells = (resolveFixture(window, "2026-09-21") ?: error("drawn")).cells

        // Sep 21: today AND the window's first day, six bars → capped, +2,
        // so the label drops to the bare number and the weight carries it.
        val first = cells[0]
        assertTrue(first.isToday); assertTrue(first.isWindowFirst); assertTrue(first.isBold)
        assertEquals(4, first.bars.size)
        assertEquals("five tasks and today's placed routine", 2, first.overflow)
        assertEquals(6, first.totalBars)
        assertEquals("21", first.label)
        assertFalse(first.showsMonthLabel)

        // Oct 1: the crowded first of the month — seven bars, an all-day item
        // and a deadline. One pip (both kinds), +3, bare number, bold.
        val oct1 = cells.first { it.date == "2026-10-01" }
        assertTrue(oct1.isFirstOfMonth); assertTrue(oct1.isBold)
        assertTrue(oct1.hasPip); assertTrue(oct1.hasAllDay); assertTrue(oct1.hasDeadline)
        assertEquals("the four earliest", listOf(510.0, 600.0, 690.0, 810.0), oct1.bars.map { it.s })
        assertEquals(3, oct1.overflow)
        assertEquals("1", oct1.label)
        assertEquals("dayglance://day?date=2026-10-01&view=month", oct1.url)

        // Nov 1: a quiet first of the month keeps its month.
        val nov1 = cells.first { it.date == "2026-11-01" }
        assertTrue(nov1.isFirstOfMonth)
        assertFalse(nov1.hasPip)
        assertEquals(0, nov1.overflow)
        assertEquals("Nov 1", nov1.label)

        // An all-day item alone is a pip; so is a deadline alone — and the
        // split the two-pip layout reads says which.
        val allDay = cells.first { it.date == "2026-09-24" }
        assertTrue("all-day", allDay.hasPip); assertTrue(allDay.hasAllDay); assertFalse(allDay.hasDeadline)
        val due = cells.first { it.date == "2026-09-27" }
        assertTrue("deadline", due.hasPip); assertFalse(due.hasAllDay); assertTrue(due.hasDeadline)
        // An ordinary day: plain weight, no month, no pip.
        val plain = cells.first { it.date == "2026-09-28" }
        assertFalse(plain.isBold); assertFalse(plain.hasPip); assertEquals("28", plain.label)
        // No other cell is marked first-of-window.
        assertEquals(1, cells.count { it.isWindowFirst })
    }

    @Test
    fun `a quiet window-first day carries the month`() {
        val d = MonthWindowDay(date = "2026-09-20", bars = listOf(MonthWindowBar(540.0, 30.0, "#fff000")))
        val cell = MonthGridCell.make(d, 0, null, label)
        assertTrue(cell.isBold)
        assertFalse("the window's first day gets no box", cell.isFirstOfMonth)
        assertEquals("Sep 20", cell.label)
        assertFalse(cell.isToday)
    }

    @Test
    fun `bars are sorted before the cap`() {
        val d = MonthWindowDay(date = "2026-09-22", bars = listOf(
            MonthWindowBar(900.0, 30.0, "#1"), MonthWindowBar(480.0, 30.0, "#2"), MonthWindowBar(600.0, 30.0, "#3"),
            MonthWindowBar(1200.0, 30.0, "#4"), MonthWindowBar(540.0, 30.0, "#5"),
        ))
        val cell = MonthGridCell.make(d, 3, "2026-09-22", label)
        assertEquals(listOf(480.0, 540.0, 600.0, 900.0), cell.bars.map { it.s })
        assertEquals(1, cell.overflow)
        assertTrue(cell.isToday)
        assertFalse(cell.isBold)
    }

    @Test
    fun `an unparseable date still yields a cell`() {
        val cell = MonthGridCell.make(MonthWindowDay(date = "oops-07"), 0, null, label)
        assertEquals(7, cell.dayOfMonth)
        assertEquals("7", cell.label)
    }

    @Test
    fun `tap URL opens the day in month`() {
        assertEquals("dayglance://day?date=2026-10-01&view=month", MonthGrid.tapUrl("2026-10-01"))
    }

    // ── Bars ─────────────────────────────────────────────────────────────────

    private fun frame(s: Double, d: Double, track: Double = 140.0) =
        MonthGrid.barFrame(MonthWindowBar(s, d, "#000000"), track)

    /** Frames compare to a hair: 120/840 × 140 is not exactly 20 in binary. */
    private fun assertFrame(f: MonthBarFrame, y: Double, h: Double) {
        assertEquals("y", y, f.y, 1e-9)
        assertEquals("height", h, f.height, 1e-9)
    }

    @Test
    fun `bars map the hour window to the track`() {
        // 14 hours on a 140dp track: 10dp per hour.
        assertFrame(frame(7.0 * 60, 60.0), 0.0, 10.0)
        assertFrame(frame(9.0 * 60, 120.0), 20.0, 20.0)
        assertFrame(frame(20.0 * 60, 60.0), 130.0, 10.0)
    }

    @Test
    fun `short items keep the minimum height`() {
        assertFrame(frame(12.0 * 60, 15.0), 50.0, 2.5)
        assertFrame(frame(12.0 * 60, 5.0), 50.0, MonthGrid.MIN_BAR_HEIGHT)
        assertFrame(frame(12.0 * 60, 0.0), 50.0, MonthGrid.MIN_BAR_HEIGHT)
        // The minimum never pushes a bar out of the bottom.
        assertFrame(frame(21.0 * 60 - 5, 5.0), 140.0 - MonthGrid.MIN_BAR_HEIGHT, MonthGrid.MIN_BAR_HEIGHT)
        // A scaled minimum (the metrics pass one) is honoured the same way.
        assertFrame(MonthGrid.barFrame(MonthWindowBar(12.0 * 60, 5.0, "#0"), 140.0, minHeight = 3.0), 50.0, 3.0)
    }

    @Test
    fun `items outside the window clamp to the edges`() {
        // Wholly before 7:00 → a minimum bar at the top.
        assertFrame(frame(6.0 * 60, 45.0), 0.0, MonthGrid.MIN_BAR_HEIGHT)
        // Wholly after 21:00 → a minimum bar at the bottom.
        assertFrame(frame(22.0 * 60 + 30, 90.0), 140.0 - MonthGrid.MIN_BAR_HEIGHT, MonthGrid.MIN_BAR_HEIGHT)
        // Straddling 7:00 keeps its in-window part.
        assertFrame(frame(6.0 * 60, 120.0), 0.0, 10.0)
        // Straddling 21:00 likewise.
        assertFrame(frame(20.0 * 60 + 30, 120.0), 135.0, 5.0)
        // All day long → the whole track.
        assertFrame(frame(0.0, 1440.0), 0.0, 140.0)
        // A negative duration is a zero one.
        assertFrame(frame(12.0 * 60, -30.0), 50.0, MonthGrid.MIN_BAR_HEIGHT)
    }

    @Test
    fun `a zero track draws nothing`() {
        assertFrame(frame(540.0, 60.0, track = 0.0), 0.0, 0.0)
    }

    // ── Geometry ─────────────────────────────────────────────────────────────

    @Test
    fun `the reference cell scales to one`() {
        // The iPhone systemLarge canvas the metrics are taken from.
        val m = MonthGridMetrics(364.0, 382.0)
        assertEquals(MonthGridMetrics.REF_CELL_WIDTH, m.cellWidth, 1e-9)
        assertEquals(57.0, m.cellHeight, 1e-9)   // floored from 57.67
        assertEquals(1.0, m.scale, 0.02)
        assertEquals(14.0, m.headerHeight, 0.3)
        assertEquals(10.0, m.dateFontSize, 0.2)
        assertEquals(2.0, m.minBarHeight, 0.05)
        assertTrue(m.showsTwoPips)
    }

    @Test
    fun `six rows always fit the grid`() {
        for (w in listOf(250.0, 300.0, 340.0, 411.0, 600.0)) for (h in listOf(250.0, 300.0, 380.0, 560.0, 720.0)) {
            for (note in listOf(0.0, MonthGridMetrics.NOTE_HEIGHT)) {
                val m = MonthGridMetrics(w, h, note)
                assertTrue("$w×$h note $note", m.cellHeight * MonthGrid.ROWS <= m.gridHeight + 1e-9)
                assertTrue("$w×$h: a track remains", m.trackHeight > 0)
                assertTrue("$w×$h: the header fits the cell", m.headerHeight < m.cellHeight)
                assertEquals("$w×$h: the note comes off the grid", MonthGridMetrics.PADDING * 2 + MonthGridMetrics.WEEKDAY_ROW_HEIGHT + note + m.gridHeight, h, 1e-9)
            }
        }
    }

    /** At the provider's minimum: 32.6dp cells, scaled to the floor, one pip. */
    @Test
    fun `the minimum widget still draws a legible cell`() {
        val m = MonthGridMetrics(MonthGridMetrics.MIN_WIDGET_WIDTH, MonthGridMetrics.MIN_WIDGET_HEIGHT)
        assertEquals(228.0 / 7, m.cellWidth, 1e-9)
        assertEquals(35.0, m.cellHeight, 1e-9)
        assertEquals(MonthGridMetrics.MIN_SCALE, m.scale, 1e-9)
        assertEquals(7.5, m.dateFontSize, 1e-9)
        assertEquals(1.5, m.minBarHeight, 1e-9)
        assertTrue("a bar of an hour is still visible", m.trackHeight / 14 >= 1.0)
        assertFalse("one combined pip below 44dp", m.showsTwoPips)
        // With the note shown the cells lose 16dp between them and still fit.
        val noted = MonthGridMetrics(MonthGridMetrics.MIN_WIDGET_WIDTH, MonthGridMetrics.MIN_WIDGET_HEIGHT, MonthGridMetrics.NOTE_HEIGHT)
        assertEquals(33.0, noted.cellHeight, 1e-9)
        assertTrue(noted.trackHeight > 0)
    }

    @Test
    fun `two pips from a 44dp cell`() {
        // 4 launcher columns on a 5-column phone (~300dp): one pip.
        assertFalse(MonthGridMetrics(300.0, 400.0).showsTwoPips)
        assertEquals(44.0 * 7 + 22, MonthGridMetrics(44.0 * 7 + 22, 400.0).cellWidth * 7 + 22, 1e-9)
        assertTrue(MonthGridMetrics(44.0 * 7 + 22, 400.0).showsTwoPips)
        assertFalse(MonthGridMetrics(44.0 * 7 + 21, 400.0).showsTwoPips)
        // Full width on a 4-column phone (~360dp) or 5 columns (~380dp): two.
        assertTrue(MonthGridMetrics(360.0, 400.0).showsTwoPips)
        assertTrue(MonthGridMetrics(380.0, 500.0).showsTwoPips)
    }

    @Test
    fun `the scale is clamped both ways`() {
        assertEquals(MonthGridMetrics.MAX_SCALE, MonthGridMetrics(900.0, 1200.0).scale, 1e-9)
        assertEquals(MonthGridMetrics.MIN_SCALE, MonthGridMetrics(100.0, 100.0).scale, 1e-9)
        // The smaller ratio rules: a wide, short widget scales by its height.
        val wide = MonthGridMetrics(600.0, 300.0)
        assertEquals(wide.cellHeight / MonthGridMetrics.REF_CELL_HEIGHT, wide.scale, 1e-9)
        // Nothing goes negative on a nonsense size.
        val tiny = MonthGridMetrics(10.0, 10.0)
        assertEquals(0.0, tiny.gridWidth, 1e-9); assertEquals(0.0, tiny.trackHeight, 1e-9)
    }

    @Test
    fun `sizes pair the options the documented way and fall back to the minimum`() {
        val s = MonthWidgetSizes.fromOptions(minWidth = 300, maxWidth = 640, minHeight = 260, maxHeight = 560)
        assertEquals(300, s.portraitWidth); assertEquals(560, s.portraitHeight)
        assertEquals(640, s.landscapeWidth); assertEquals(260, s.landscapeHeight)
        val none = MonthWidgetSizes.fromOptions(0, 0, 0, 0)
        assertEquals(250, none.portraitWidth); assertEquals(250, none.portraitHeight)
        assertEquals(250, none.landscapeWidth); assertEquals(250, none.landscapeHeight)
    }
}
