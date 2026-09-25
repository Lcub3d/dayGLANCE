package com.dayglance.app.widget

import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt

// ─────────────────────────────────────────────────────────────────────────────
// Month + agenda widget — the model. The month grid widget's grid (the same
// MonthGridModel, cells and bitmaps) paired with one day's agenda, paged with
// two arrows. Everything the widget decides is here, free of Android, and
// unit-tested (MonthAgendaModelTest): which day is selected, where the arrows
// go, when the selection resets, which arrangement a size gets, and what the
// agenda lists for the selected day. MonthAgendaWidget.kt only draws it.
//
// The selection rules are the iOS extra-large month widget's
// (MonthDaySelection.swift), ported rule for rule.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Selection

/**
 * The day the agenda shows. Changed only by the arrows, which write it to
 * SharedPreferences per widget instance (MonthAgendaSelectionStore).
 *
 * MIDNIGHT RESET. The record carries the local day it was set on, and a
 * selection read on any other day resolves to today — so the widget cannot
 * sit on a day paged to last week even if nothing ran at 00:00. On top of
 * that, MidnightRolloverReceiver clears the stored selections and redraws, so
 * the reset is visible AT midnight rather than at the next render.
 */
data class MonthDaySelection(
    /** The selected day, 'yyyy-MM-dd'. */
    val date: String,
    /** The local day the selection was made, 'yyyy-MM-dd'. */
    val setOn: String,
) {
    companion object {
        /**
         * The day the agenda shows on local day [today]: the stored selection
         * if it was made today and is on the grid; else today if today is on
         * the grid; else the grid's first day (a stale grid, which draws the
         * push's own six weeks and no longer contains today). Null only for an
         * empty grid.
         */
        fun resolve(stored: MonthDaySelection?, cells: List<MonthGridCell>, today: String): String? {
            val onGrid = cells.mapTo(HashSet()) { it.date }
            if (stored != null && stored.setOn == today && stored.date in onGrid) return stored.date
            if (today in onGrid) return today
            return cells.firstOrNull()?.date
        }

        /**
         * The days the arrows move to, or null at either end of the grid: the
         * arrows page across exactly the 42 days the grid shows, and a null
         * side is drawn disabled.
         */
        /**
         * Whether the header offers "Today": only when the agenda is on
         * another day AND today is on the grid to return to. A stale grid
         * that no longer contains today has nowhere to go, so no button.
         */
        fun showsToday(selected: String?, cells: List<MonthGridCell>, today: String): Boolean =
            selected != today && cells.any { it.date == today }

        fun neighbours(date: String?, cells: List<MonthGridCell>): Pair<String?, String?> {
            val i = cells.indexOfFirst { it.date == date }
            if (i < 0) return null to null
            return cells.getOrNull(i - 1)?.date to cells.getOrNull(i + 1)?.date
        }
    }
}

// MARK: - Arrangement

enum class MonthAgendaArrangement { SIDE_BY_SIDE, STACKED }

/**
 * Which arrangement a size gets, and the grid pane it leaves, in dp.
 *
 * SIDE BY SIDE (grid left, agenda right, equal halves): at least 460dp wide
 * AND at least 1.25 × as wide as tall. 460dp is where each half is ~230dp,
 * the width the grid widget's cells need to stay legible (a 32dp column at its
 * 250dp minimum, less the hairline); the aspect guard keeps a big square
 * placement stacked, where halves would squeeze the grid into a tall strip.
 * Typical: a tablet 8 × 4 or 8 × 6, a phone in landscape.
 *
 * STACKED (grid on top, agenda below): everything else. Below 440dp tall
 * the grid takes 5/8 of the height and the agenda 3/8, so at the provider's
 * 320dp minimum the grid pane is 199dp (cells ~27dp, a track of ~14dp) and
 * the agenda 120dp: its header and two rows. From 440dp the two split
 * evenly — at 440 that is cells ~30dp and an agenda of ~4 rows, where 5/8
 * would leave the agenda two rows under a grid with room to spare. Typical:
 * a phone at 4 × 5 or larger.
 *
 * MINIMUMS: stacked 250 × 320dp (4 × 5 launcher cells, the smallest that holds
 * six grid rows over a usable agenda, and one row shorter than 4 × 6, which
 * does not fit a five-row phone home screen); side by side 460 × 250dp. The
 * provider's minimum is the stacked one (widget_month_agenda_info.xml).
 *
 * Both layouts use layout weights, so these shares hold on every API level;
 * the XML (widget_month_agenda_side / _stacked) and these numbers must agree.
 */
object MonthAgendaLayout {
    const val SIDE_MIN_WIDTH = 460.0
    const val SIDE_MIN_ASPECT = 1.25
    /** The grid's share of the height when stacked: 5 : 3 below
     *  [STACKED_EVEN_MIN_HEIGHT] (widget_month_agenda_stacked), 1 : 1 from it
     *  (widget_month_agenda_stacked_even). */
    const val STACKED_GRID_SHARE = 5.0 / 8.0
    const val STACKED_EVEN_GRID_SHARE = 1.0 / 2.0
    const val STACKED_EVEN_MIN_HEIGHT = 440.0
    /** The hairline between the panes. */
    const val DIVIDER = 1.0

    const val MIN_WIDTH = 250.0
    const val MIN_HEIGHT = 320.0

    fun arrangement(widthDp: Double, heightDp: Double): MonthAgendaArrangement =
        if (widthDp >= SIDE_MIN_WIDTH && widthDp >= heightDp * SIDE_MIN_ASPECT) MonthAgendaArrangement.SIDE_BY_SIDE
        else MonthAgendaArrangement.STACKED

    /** The grid pane's size, in dp: what MonthGridMetrics is given for the cells. */
    fun gridPane(widthDp: Double, heightDp: Double): Pair<Double, Double> =
        when (arrangement(widthDp, heightDp)) {
            MonthAgendaArrangement.SIDE_BY_SIDE -> (widthDp - DIVIDER) / 2 to heightDp
            MonthAgendaArrangement.STACKED -> widthDp to floor((heightDp - DIVIDER) * stackedGridShare(heightDp))
        }

    /** Whether a stacked placement splits evenly (a tall one) or 5 : 3. */
    fun stackedIsEven(heightDp: Double): Boolean = heightDp >= STACKED_EVEN_MIN_HEIGHT

    fun stackedGridShare(heightDp: Double): Double =
        if (stackedIsEven(heightDp)) STACKED_EVEN_GRID_SHARE else STACKED_GRID_SHARE
}

// MARK: - Content

/** Where the agenda's rows come from for a selected day. */
enum class MonthAgendaSource {
    /** Today: the Today widget's own list (DayGlanceWidgetListFactory), minus
     *  habits — routines, free time in frames, overdue, goals, GLANCEahead
     *  and all. */
    TODAY_WIDGET,
    /** Any other day: that day's rows from the snapshot's monthWindow — its
     *  tasks, events, all-day items and deadlines, nothing that exists only
     *  for today. */
    WINDOW_ROWS,
}

/** One line of a non-today agenda, before Android styles it with the Today
 *  widget's row layouts. */
sealed class MonthAgendaLine {
    /** A section header, by the Today widget's key ("ALL DAY", "SCHEDULED"). */
    data class Section(val key: String) : MonthAgendaLine()
    /** A task row. [badge] is a Today-widget badge key ("ALL DAY", "DUE") or
     *  empty; [time] is the Today widget's time line, empty for none. */
    data class Item(
        val title: String,
        val colorHex: String,
        val badge: String,
        val time: String,
        val completed: Boolean,
    ) : MonthAgendaLine()
    /** "+N more": rows past the 12 the payload carries. */
    data class More(val count: Int) : MonthAgendaLine()
    /** The day has nothing. */
    object Nothing : MonthAgendaLine()
}

object MonthAgendaContent {
    /** Habits are left out of this widget entirely, today included. */
    const val INCLUDES_HABITS = false

    /** The badge keys; the list factory localizes them. */
    const val BADGE_ALL_DAY = "ALL DAY"
    const val BADGE_DUE = "DUE"
    const val SECTION_ALL_DAY = "ALL DAY"
    const val SECTION_SCHEDULED = "SCHEDULED"

    /**
     * Today reads the Today widget's list; every other day the window's rows.
     * On a STALE grid today reads the window too: the Today widget's list is
     * then the push's own day (its stale root), which would put another day's
     * content under today's date, while the window row is what the dimmed
     * grid draws for that date — the push's plan for it, labelled Outdated.
     */
    fun sourceFor(selected: String?, today: String, gridIsStale: Boolean = false): MonthAgendaSource =
        if (selected == today && !gridIsStale) MonthAgendaSource.TODAY_WIDGET else MonthAgendaSource.WINDOW_ROWS

    /**
     * A non-today day's lines, in the Today widget's order and vocabulary:
     * ALL DAY (section, then its items badged ALL DAY), deadlines (badged DUE —
     * the Today widget's "DUE TODAY" would be false on another day), then
     * SCHEDULED (section, then timed rows with the Today widget's time line).
     * Completed rows stay, flagged. Routines never appear: the payload has
     * them for today only, and today is not read from here. The payload's
     * order within each group is kept (start time for timed rows).
     */
    fun windowLines(
        rows: List<MonthAgendaRow>,
        more: Int,
        use24Hour: Boolean,
        locale: Locale = Locale.getDefault(),
    ): List<MonthAgendaLine> {
        val allDay = rows.filter { it.k == "a" }
        val deadlines = rows.filter { it.k == "l" }
        val timed = rows.filter { it.k == null && it.s != null }
        val out = ArrayList<MonthAgendaLine>()
        if (allDay.isNotEmpty()) {
            out += MonthAgendaLine.Section(SECTION_ALL_DAY)
            allDay.forEach { out += item(it, BADGE_ALL_DAY, "") }
        }
        deadlines.forEach { out += item(it, BADGE_DUE, "") }
        if (timed.isNotEmpty()) {
            out += MonthAgendaLine.Section(SECTION_SCHEDULED)
            timed.forEach { out += item(it, "", timeLine(it.s!!, it.d ?: 0.0, use24Hour, locale)) }
        }
        if (more > 0) out += MonthAgendaLine.More(more)
        if (out.isEmpty()) out += MonthAgendaLine.Nothing
        return out
    }

    private fun item(row: MonthAgendaRow, badge: String, time: String) = MonthAgendaLine.Item(
        title = row.t,
        colorHex = row.c ?: DEFAULT_COLOR,
        badge = badge,
        time = time,
        completed = row.isCompleted,
    )

    private const val DEFAULT_COLOR = "#3b82f6"

    /**
     * The Today widget's time line (DayGlanceWidgetListFactory.buildTimeStr),
     * from payload minutes: "9:00 – 10:30 AM" (12-hour) or "9:00 – 10:30",
     * the start alone when there is no duration. An end past midnight wraps.
     * [locale] is the device's, as the Today widget formats (its AM/PM).
     */
    fun timeLine(startMinutes: Double, durationMinutes: Double, use24Hour: Boolean, locale: Locale = Locale.getDefault()): String {
        val twelve = DateTimeFormatter.ofPattern("h:mm a", locale)
        val twelveShort = DateTimeFormatter.ofPattern("h:mm", locale)
        val twentyFour = DateTimeFormatter.ofPattern("H:mm", locale)
        val start = startMinutes.roundToInt().coerceIn(0, 24 * 60 - 1)
        val duration = durationMinutes.roundToInt().coerceAtLeast(0)
        val s = LocalTime.of(start / 60, start % 60)
        if (duration <= 0) return s.format(if (use24Hour) twentyFour else twelve)
        val end = (start + duration) % (24 * 60)
        val e = LocalTime.of(end / 60, end % 60)
        return "${s.format(if (use24Hour) twentyFour else twelveShort)} – ${e.format(if (use24Hour) twentyFour else twelve)}"
    }
}
