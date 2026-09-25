package com.dayglance.app.widget

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// ─────────────────────────────────────────────────────────────────────────────
// Month grid — the model. A port of the iOS widget's MonthGridModel.swift
// (dayglance-ios/DayGlanceWidget/Month), rule for rule: which 42 days to draw
// today, which tier they are in, what each cell says, and where each bar
// lands. Nothing here touches Android — MonthGridWidget.kt and
// MonthGridCellPainter.kt only draw what this returns — so every rule is
// unit-tested (MonthGridModelTest) against the same live-shaped fixture the
// Swift tests use.
//
// THE PAYLOAD is the snapshot's `monthWindow` (src/utils/widgetMonthWindow.js):
// 49 days from the start of the push's week — six grid weeks plus a one-week
// rollover tail — each with bars {s, d, c} and per-day `allDay` / `deadlines`
// colour lists. It is baked at push time; nothing runs JS at midnight.
//
// IT IS DECODED SEPARATELY and leniently, on purpose: a malformed window costs
// this widget its grid and nothing else, and a fractional minute never rejects
// the window (bar minutes are doubles).
//
// WHICH 42: resolveMonthWindow in the JS module is the reference. The grid
// starts on the first day of the week containing TODAY, by the payload's
// `weekStart`, and the days are looked up by date, never by index from "now".
// So a day past a week boundary draws the next six weeks from the tail with
// no push.
//
// STALENESS is coverage, not age. The grid is live on any day whose whole
// six-week grid the stored window covers, and stale from the first day it
// does not. That is deliberately NOT the other widgets' horizon (the last
// projected day, push + 3): with `from` the start of the push's week, a day's
// grid is covered while its week starts no later than from + 7 — live through
// the end of the week AFTER the push's, from + 13, which is 13 days past a
// push on the first day of the week and 7 past one on the last.
//   PUSHED     today is the day the snapshot was built
//   PROJECTED  any other covered day: "Planned as of …"
//   STALE      not covered: the PUSH's own grid, dimmed, labelled, no today
//              marker — never a partial grid
//   UNKNOWN    the snapshot did not say what day it is: drawn as pushed
//
// ONE DIFFERENCE from iOS, by design: a cell keeps `hasAllDay` and
// `hasDeadline` apart, so the painter can show two pips where the cell is
// wide enough (MonthGridMetrics.showsTwoPips) and one combined pip where it
// is not. `hasPip` is the iOS rule and drives the label exactly as there.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Payload

data class MonthWindowBar(
    /** Start, minutes past local midnight. */
    val s: Double,
    /** Duration in minutes. */
    val d: Double,
    /** Resolved hex colour. */
    val c: String,
)

data class MonthWindowDay(
    val date: String,
    /** Start-sorted, already clipped at midnight (an overnight block's
     *  remainder opens the next day at 0). */
    val bars: List<MonthWindowBar> = emptyList(),
    /** One hex per all-day item / deadline. Only presence is drawn here. */
    val allDay: List<String> = emptyList(),
    val deadlines: List<String> = emptyList(),
    /** The day's list for the month agenda widget: at most 12 rows, titles
     *  cut to 48 characters (buildAgenda in the JS module). Empty from an
     *  older push. */
    val agenda: List<MonthAgendaRow> = emptyList(),
    /** Rows beyond the 12 carried. */
    val agendaMore: Int = 0,
)

/**
 * One agenda row, as the iOS XL widget reads it (MonthAgendaRow in
 * MonthGridModel.swift). Every field but the title is optional, so an
 * unexpected shape costs a row's detail, not the day.
 */
data class MonthAgendaRow(
    /** Title, already cleaned of wikilinks and #tags and cut to 48 characters. */
    val t: String,
    /** Resolved hex colour. */
    val c: String? = null,
    /** Start and duration in minutes — timed rows and routines only. */
    val s: Double? = null,
    val d: Double? = null,
    /** Kind: null a timed task or event, "r" a routine (today only), "a" an
     *  all-day item, "l" a deadline. */
    val k: String? = null,
    /** 1 when completed. */
    val x: Int? = null,
) {
    val isCompleted: Boolean get() = x == 1
}

data class MonthWindowPayload(
    /** First day of the push's week, 'yyyy-MM-dd'. */
    val from: String?,
    /** 0 = Sunday, 1 = Monday: the app's week-start setting at push time. */
    val weekStart: Int?,
    val days: List<MonthWindowDay>,
)

object MonthWindowStore {
    /**
     * The window from the stored snapshot text, or null — absent (an app build
     * from before the field), null (not a native push), or malformed. The rest
     * of the snapshot is never touched: the other widgets parse it themselves.
     */
    fun decode(snapshotJson: String?): MonthWindowPayload? {
        if (snapshotJson.isNullOrBlank()) return null
        val root = runCatching { JSONObject(snapshotJson) }.getOrNull() ?: return null
        return decode(root)
    }

    fun decode(root: JSONObject): MonthWindowPayload? {
        val window = root.optJSONObject("monthWindow") ?: return null
        val daysArray = window.optJSONArray("days") ?: return null
        val days = ArrayList<MonthWindowDay>(daysArray.length())
        for (i in 0 until daysArray.length()) {
            val day = daysArray.optJSONObject(i) ?: return null
            // A day without a date cannot be looked up: the window is unusable.
            val date = day.optString("date", "").takeIf { it.isNotBlank() } ?: return null
            days += MonthWindowDay(
                date = date,
                bars = decodeBars(day.optJSONArray("bars")),
                allDay = decodeStrings(day.optJSONArray("allDay")),
                deadlines = decodeStrings(day.optJSONArray("deadlines")),
                agenda = decodeAgenda(day.optJSONArray("agenda")),
                agendaMore = day.optInt("agendaMore", 0).coerceAtLeast(0),
            )
        }
        val weekStart = if (window.has("weekStart") && !window.isNull("weekStart")) window.optInt("weekStart") else null
        val from = window.optString("from", "").takeIf { it.isNotBlank() }
        return MonthWindowPayload(from = from, weekStart = weekStart, days = days)
    }

    /** Like the Swift decoder: one malformed bar drops the day's list, not the window. */
    private fun decodeBars(array: JSONArray?): List<MonthWindowBar> {
        if (array == null) return emptyList()
        val bars = ArrayList<MonthWindowBar>(array.length())
        for (i in 0 until array.length()) {
            val bar = array.optJSONObject(i) ?: return emptyList()
            val s = bar.optDouble("s", Double.NaN)
            val d = bar.optDouble("d", Double.NaN)
            val c = bar.optString("c", "")
            if (s.isNaN() || d.isNaN() || c.isEmpty()) return emptyList()
            bars += MonthWindowBar(s, d, c)
        }
        return bars
    }

    /** A row without a title is skipped; a bad optional field is dropped. */
    private fun decodeAgenda(array: JSONArray?): List<MonthAgendaRow> {
        if (array == null) return emptyList()
        val rows = ArrayList<MonthAgendaRow>(array.length())
        for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            val t = row.opt("t") as? String ?: continue
            fun num(key: String): Double? = (row.opt(key) as? Number)?.toDouble()?.takeIf { !it.isNaN() }
            rows += MonthAgendaRow(
                t = t,
                c = row.opt("c") as? String,
                s = num("s"),
                d = num("d"),
                k = row.opt("k") as? String,
                x = (row.opt("x") as? Number)?.toInt(),
            )
        }
        return rows
    }

    private fun decodeStrings(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        val out = ArrayList<String>(array.length())
        for (i in 0 until array.length()) {
            val v = array.opt(i) as? String ?: return emptyList()
            out += v
        }
        return out
    }
}

// MARK: - Constants

object MonthGrid {
    const val COLUMNS = 7
    const val ROWS = 6
    const val CELL_COUNT = COLUMNS * ROWS

    /** The hours a cell's track maps to its full height, in minutes. The in-app
     *  month cell's window (MONTH_CELL_LAYOUT.window, src/constants/monthView.js),
     *  so a bar sits at the same relative height here as in the app's month view. */
    const val WINDOW_START_MINUTES = 7.0 * 60
    const val WINDOW_END_MINUTES = 21.0 * 60

    /** Bars drawn per day; the rest are reported as `+N`. */
    const val BAR_CAP = 4

    /** A bar never draws thinner than this, in dp, at the reference cell size.
     *  iOS's 2pt: ~5.5% of a ~36pt track, the same share the in-app cell's 4px
     *  minimum is of a phone cell. MonthGridMetrics scales it with the cell. */
    const val MIN_BAR_HEIGHT = 2.0

    private val ISO = DateTimeFormatter.ISO_LOCAL_DATE

    fun isoDay(date: LocalDate): String = date.format(ISO)

    /** First day of the week containing [day], by [weekStart] (0 = Sunday) —
     *  monthWindowStart in the JS module. Calendar days, never seconds. */
    fun gridStart(day: LocalDate, weekStart: Int): LocalDate {
        val weekday0 = day.dayOfWeek.value % 7   // 0 = Sunday
        val ws = ((weekStart % 7) + 7) % 7
        val back = (weekday0 - ws + 7) % 7
        return day.minusDays(back.toLong())
    }

    /** The 42 days to draw on local day [day], or null when the window does not
     *  cover that day's whole grid — resolveMonthWindow in the JS module. */
    fun days(window: MonthWindowPayload, day: LocalDate): List<MonthWindowDay>? {
        val start = isoDay(gridStart(day, window.weekStart ?: 0))
        val i = window.days.indexOfFirst { it.date == start }
        if (i < 0 || i + CELL_COUNT > window.days.size) return null
        return window.days.subList(i, i + CELL_COUNT)
    }

    /** Day-of-week initials in grid order, starting at [weekStart] (0 = Sunday). */
    fun weekdayInitials(weekStart: Int, locale: Locale): List<String> {
        val ws = ((weekStart % 7) + 7) % 7
        return (0 until 7).map { i ->
            val weekday0 = (ws + i) % 7
            val dow = if (weekday0 == 0) DayOfWeek.SUNDAY else DayOfWeek.of(weekday0)
            dow.getDisplayName(TextStyle.NARROW_STANDALONE, locale)
        }
    }

    /** Where a tap on a cell goes: the app's `day` route with `view=month`,
     *  which opens MONTH with the day selected — its sheet on a phone, the
     *  docked panel on a wide screen — or the default view when MONTH is off
     *  (src/utils/dayLink.js). */
    fun tapUrl(date: String): String = "dayglance://day?date=$date&view=month"

    /**
     * A bar's vertical frame in a track [trackHeight] tall. The item is clipped
     * to the hour window first, so one that starts before 7:00 or ends after
     * 21:00 keeps its in-window part; one wholly outside clamps to the nearest
     * edge at the minimum height. Never taller than the track, never out of it.
     */
    fun barFrame(bar: MonthWindowBar, trackHeight: Double, minHeight: Double = MIN_BAR_HEIGHT): MonthBarFrame {
        if (trackHeight <= 0) return MonthBarFrame(0.0, 0.0)
        val span = WINDOW_END_MINUTES - WINDOW_START_MINUTES
        val start = bar.s
        val end = bar.s + max(0.0, bar.d)
        val clippedStart = min(max(start, WINDOW_START_MINUTES), WINDOW_END_MINUTES)
        val clippedEnd = min(max(end, WINDOW_START_MINUTES), WINDOW_END_MINUTES)
        val top = (clippedStart - WINDOW_START_MINUTES) / span * trackHeight
        val natural = (clippedEnd - clippedStart) / span * trackHeight
        val height = min(trackHeight, max(minHeight, natural))
        val y = max(0.0, min(top, trackHeight - height))
        return MonthBarFrame(y, height)
    }

    /** "Oct 1" with the JVM's own abbreviations. The widget passes a formatter
     *  from Android's locale skeleton instead (day/month order follows the device). */
    fun defaultMonthDayLabel(locale: Locale): (LocalDate) -> String {
        val f = DateTimeFormatter.ofPattern("MMM d", locale)
        return { it.format(f) }
    }
}

/** Top of the bar from the top of the track, and its height, in dp. */
data class MonthBarFrame(val y: Double, val height: Double)

// MARK: - Cells

data class MonthGridCell(
    val date: String,
    val dayOfMonth: Int,
    /** "Oct 1" in the widget's locale — shown only when [showsMonthLabel]. */
    val monthDayLabel: String,
    val isToday: Boolean,
    val isFirstOfMonth: Boolean,
    /** The first cell of the displayed grid. */
    val isWindowFirst: Boolean,
    /** Anything in the day's `allDay` list. */
    val hasAllDay: Boolean,
    /** Anything in the day's `deadlines` list. */
    val hasDeadline: Boolean,
    /** At most [MonthGrid.BAR_CAP], earliest first. */
    val bars: List<MonthWindowBar>,
    /** Bars beyond the cap, drawn as `+N`. */
    val overflow: Int,
    /** Every bar the day has, for the content description. */
    val totalBars: Int,
    /** The day's agenda rows and how many more there are (month agenda widget). */
    val agenda: List<MonthAgendaRow> = emptyList(),
    val agendaMore: Int = 0,
) {
    /** Anything in `allDay` or `deadlines`: the iOS rule, one pip whatever the
     *  count or kind. The label rule below reads this, never the split. */
    val hasPip: Boolean get() = hasAllDay || hasDeadline
    /** Bold weight: the first of a month and the grid's first day. */
    val isBold: Boolean get() = isFirstOfMonth || isWindowFirst
    /** Those two carry the month ("Oct 1") unless the header is already busy
     *  with a pip or a `+N` — then the bare number, and the weight carries it. */
    val showsMonthLabel: Boolean get() = isBold && !hasPip && overflow == 0
    val label: String get() = if (showsMonthLabel) monthDayLabel else dayOfMonth.toString()
    val url: String get() = MonthGrid.tapUrl(date)

    companion object {
        fun make(day: MonthWindowDay, index: Int, today: String?, monthDayLabel: (LocalDate) -> String): MonthGridCell {
            val parsed = WidgetFreshnessRules.parseDay(day.date)
            val dom = parsed?.dayOfMonth ?: day.date.takeLast(2).toIntOrNull() ?: 0
            val label = parsed?.let(monthDayLabel) ?: dom.toString()
            val shown = day.bars.sortedBy { it.s }.take(MonthGrid.BAR_CAP)
            return MonthGridCell(
                date = day.date,
                dayOfMonth = dom,
                monthDayLabel = label,
                isToday = day.date == today,
                isFirstOfMonth = dom == 1,
                isWindowFirst = index == 0,
                hasAllDay = day.allDay.isNotEmpty(),
                hasDeadline = day.deadlines.isNotEmpty(),
                bars = shown,
                overflow = max(0, day.bars.size - MonthGrid.BAR_CAP),
                totalBars = day.bars.size,
                agenda = day.agenda,
                agendaMore = day.agendaMore,
            )
        }
    }
}

// MARK: - Resolution

enum class MonthGridTier { PUSHED, PROJECTED, STALE, UNKNOWN }

data class MonthGridState(
    val tier: MonthGridTier,
    /** Freshness of what is drawn: stale only for [MonthGridTier.STALE]. */
    val freshness: WidgetFreshness,
    val weekStart: Int,
    val cells: List<MonthGridCell>,
) {
    val isStale: Boolean get() = tier == MonthGridTier.STALE
    val isProjected: Boolean get() = tier == MonthGridTier.PROJECTED

    companion object {
        /**
         * The grid for [today], or null when there is nothing to draw (no window).
         *
         * @param pushed  the stored snapshot's freshness as the other widgets
         *                read it (snapshotFreshness): its day and capture time.
         */
        fun resolve(
            pushed: WidgetFreshness,
            window: MonthWindowPayload?,
            today: LocalDate,
            monthDayLabel: (LocalDate) -> String = MonthGrid.defaultMonthDayLabel(Locale.getDefault()),
        ): MonthGridState? {
            if (window == null || window.days.isEmpty()) return null
            val weekStart = window.weekStart ?: 0

            fun state(tier: MonthGridTier, freshness: WidgetFreshness, days: List<MonthWindowDay>, marker: LocalDate?): MonthGridState {
                val todayStr = marker?.let(MonthGrid::isoDay)
                val cells = days.mapIndexed { i, day -> MonthGridCell.make(day, i, todayStr, monthDayLabel) }
                return MonthGridState(tier, freshness, weekStart, cells)
            }

            // The push's own grid: what a stale widget shows, dimmed.
            fun pushGrid(): List<MonthWindowDay> {
                val day = pushed.snapshotDate
                if (day != null) MonthGrid.days(window, day)?.let { return it }
                return window.days.take(MonthGrid.CELL_COUNT)
            }

            // Live for as long as the stored window covers today's whole grid —
            // nothing else ages it. Never a partial grid.
            val days = MonthGrid.days(window, today)
            if (days != null) {
                val snapshotDay = pushed.snapshotDate ?: return state(MonthGridTier.UNKNOWN, pushed, days, today)
                if (today == snapshotDay) return state(MonthGridTier.PUSHED, pushed, days, today)
                val fresh = WidgetFreshness(isStale = false, daysOld = 0, snapshotDate = today, capturedAtMs = pushed.capturedAtMs)
                return state(MonthGridTier.PROJECTED, fresh, days, today)
            }
            val stale = WidgetFreshness(isStale = true, daysOld = pushed.daysOld, snapshotDate = pushed.snapshotDate, capturedAtMs = pushed.capturedAtMs)
            return state(MonthGridTier.STALE, stale, pushGrid(), null)
        }

        /** The pre-data grid: this week's six weeks, dates only. */
        fun placeholder(
            today: LocalDate,
            weekStart: Int,
            monthDayLabel: (LocalDate) -> String = MonthGrid.defaultMonthDayLabel(Locale.getDefault()),
        ): MonthGridState {
            val start = MonthGrid.gridStart(today, weekStart)
            val days = (0 until MonthGrid.CELL_COUNT).map { MonthWindowDay(date = MonthGrid.isoDay(start.plusDays(it.toLong()))) }
            val todayStr = MonthGrid.isoDay(today)
            val cells = days.mapIndexed { i, day -> MonthGridCell.make(day, i, todayStr, monthDayLabel) }
            return MonthGridState(MonthGridTier.UNKNOWN, WidgetFreshness.UNKNOWN, weekStart, cells)
        }
    }
}

// MARK: - Geometry

/**
 * The iOS widget's measurements (MonthGridWidget.swift: 11pt padding, a 14pt
 * day-of-week row, a 14pt cell header, the track from 15pt to 2pt above the
 * cell's bottom) and the cell geometry they leave at a widget size, in dp.
 *
 * iOS draws at a handful of fixed sizes; an Android widget is whatever the
 * launcher's grid and the user's resize make it, so the header, fonts, pip and
 * minimum bar height SCALE with the cell, by the smaller of the cell's two
 * ratios to the iPhone systemLarge cell (48.9 × 57.7pt at 364 × 382). The
 * bars need no scaling: they are a share of the track by construction. The
 * day-of-week row and the cell inset stay fixed, like the padding.
 *
 * The minimum size (widget_month_info.xml) is 4 × 4 launcher cells, 250dp
 * each way. Below that six rows do not fit: at 250dp tall the cells are 36dp,
 * a 14dp header over a 19dp track where an hour is 1.4dp and the minimum bar
 * covers more than one, and at 250dp wide a cell is 32.6dp, so the scaled
 * 8dp digits and a pip still fit but a fifth column of launcher cells is the
 * first size where the grid reads as one.
 */
data class MonthGridMetrics(
    val widgetWidth: Double,
    val widgetHeight: Double,
    /** Height of the note above the day-of-week row (stale banner or
     *  "Planned as of"), 0 when none is shown. */
    val noteHeight: Double = 0.0,
) {
    companion object {
        const val PADDING = 11.0
        const val WEEKDAY_ROW_HEIGHT = 14.0
        const val WEEKDAY_FONT_SIZE = 9.0
        const val NOTE_HEIGHT = 16.0
        const val CELL_INSET = 2.0
        const val BOX_RADIUS = 4.0
        const val TRACK_BOTTOM_INSET = 2.0

        // Reference values at the reference cell; each scales.
        const val REF_HEADER_HEIGHT = 14.0
        const val REF_DATE_FONT_SIZE = 10.0
        const val REF_OVERFLOW_FONT_SIZE = 8.0
        const val REF_TRACK_TOP = 15.0
        const val REF_PIP_SIZE = 4.0
        const val REF_PIP_GAP = 3.0
        const val REF_BAR_RADIUS = 1.5
        const val REF_TODAY_FILL_HEIGHT = 12.0
        const val REF_TODAY_MIN_WIDTH = 14.0
        const val REF_TODAY_PADDING = 3.0

        /** The iPhone systemLarge cell: (364 − 22) / 7 by (382 − 22 − 14) / 6. */
        const val REF_CELL_WIDTH = 342.0 / 7
        const val REF_CELL_HEIGHT = 346.0 / 6
        const val MIN_SCALE = 0.75
        const val MAX_SCALE = 1.5

        /** The provider's minimum, dp: 4 × 4 launcher cells (70n − 30). */
        const val MIN_WIDGET_WIDTH = 250.0
        const val MIN_WIDGET_HEIGHT = 250.0

        /**
         * From this cell width, an all-day item and a deadline get a pip each;
         * narrower, one combined pip (the iOS rule). The header at a pipped
         * cell holds a two-digit number (12dp), the gap, two pips (11dp), the
         * 2dp minimum before a `+N` (10dp) and the insets: 43dp at the
         * reference scale, so 44 is the first width where both fit without
         * the `+N` touching a pip.
         */
        const val TWO_PIP_MIN_CELL_WIDTH = 44.0
    }

    val gridWidth: Double get() = max(0.0, widgetWidth - 2 * PADDING)
    val gridHeight: Double get() = max(0.0, widgetHeight - 2 * PADDING - WEEKDAY_ROW_HEIGHT - noteHeight)
    val cellWidth: Double get() = gridWidth / MonthGrid.COLUMNS
    /** Whole dp, so six rows never sum past the grid and scroll it. */
    val cellHeight: Double get() = floor(gridHeight / MonthGrid.ROWS)

    val scale: Double get() = min(MAX_SCALE, max(MIN_SCALE, min(cellWidth / REF_CELL_WIDTH, cellHeight / REF_CELL_HEIGHT)))

    val headerHeight: Double get() = REF_HEADER_HEIGHT * scale
    val dateFontSize: Double get() = REF_DATE_FONT_SIZE * scale
    val overflowFontSize: Double get() = REF_OVERFLOW_FONT_SIZE * scale
    val trackTop: Double get() = REF_TRACK_TOP * scale
    val pipSize: Double get() = REF_PIP_SIZE * scale
    val pipGap: Double get() = REF_PIP_GAP * scale
    val barRadius: Double get() = REF_BAR_RADIUS * scale
    val todayFillHeight: Double get() = REF_TODAY_FILL_HEIGHT * scale
    val todayMinWidth: Double get() = REF_TODAY_MIN_WIDTH * scale
    val todayPadding: Double get() = REF_TODAY_PADDING * scale
    /** iOS's 2pt, as the same share of the track at every cell size. */
    val minBarHeight: Double get() = MonthGrid.MIN_BAR_HEIGHT * scale

    val trackWidth: Double get() = max(0.0, cellWidth - 2 * CELL_INSET)
    val trackHeight: Double get() = max(0.0, cellHeight - trackTop - TRACK_BOTTOM_INSET)

    /** Two pips (all-day, deadline) or the one combined pip. */
    val showsTwoPips: Boolean get() = cellWidth >= TWO_PIP_MIN_CELL_WIDTH
}

/**
 * The two sizes a widget instance is drawn at, in dp, from the host's
 * AppWidgetOptions: portrait is min width × max height, landscape max width ×
 * min height (the documented pairing). A missing or zero option — a host that
 * reports none, or a widget placed before the app was updated — falls back to
 * the provider's minimum, so a cell is always drawn at a real size.
 */
data class MonthWidgetSizes(
    val portraitWidth: Int,
    val portraitHeight: Int,
    val landscapeWidth: Int,
    val landscapeHeight: Int,
) {
    companion object {
        fun fromOptions(
            minWidth: Int,
            maxWidth: Int,
            minHeight: Int,
            maxHeight: Int,
            /** The provider's minimum, for a host that reports nothing. */
            fallbackWidth: Double = MonthGridMetrics.MIN_WIDGET_WIDTH,
            fallbackHeight: Double = MonthGridMetrics.MIN_WIDGET_HEIGHT,
        ): MonthWidgetSizes {
            fun or(value: Int, fallback: Double): Int = if (value > 0) value else fallback.toInt()
            val w = fallbackWidth
            val h = fallbackHeight
            return MonthWidgetSizes(
                portraitWidth = or(minWidth, w), portraitHeight = or(maxHeight, h),
                landscapeWidth = or(maxWidth, w), landscapeHeight = or(minHeight, h),
            )
        }
    }
}
