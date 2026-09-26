package com.dayglance.app.widget.dial

import com.dayglance.app.widget.dial.DialFaceInput.Companion.num
import com.dayglance.app.widget.dial.DialFaceInput.Companion.str
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// ─────────────────────────────────────────────────────────────────────────────
// The two cards a roomy placement shows beside the dial: the in-app dial's
// All Day pill and its legend (DayDial.jsx), built from the day's `dial`
// fields (`allDay`, `totals`, the routine blocks) that projectDialSnapshot
// sends for the pushed day and every projected one. And where they go: below
// the dial when the placement is taller than the face, beside it when wider,
// nowhere when the face already fills it. Pure.
// ─────────────────────────────────────────────────────────────────────────────

data class DialAllDayItem(val id: String, val title: String, val completed: Boolean, val colorHex: String?)

enum class DialLegendKey { EFFORT, RESTORE, SLEEP, UNBLOCKED, ROUTINES }

/** One legend entry: a duration, or for routines a done/total count. */
data class DialLegendItem(val key: DialLegendKey, val minutes: Double? = null, val done: Int = 0, val total: Int = 0)

data class DialCards(val allDay: List<DialAllDayItem>, val legend: List<DialLegendItem>) {
    val isEmpty: Boolean get() = allDay.isEmpty() && legend.isEmpty()

    /** What the cards draw, for the face key: a push that changes them redraws. */
    val key: String
        get() = buildList {
            allDay.forEach { add("a:${it.id}|${it.title}|${it.completed}|${it.colorHex}") }
            legend.forEach { add("l:${it.key}|${it.minutes}|${it.done}/${it.total}") }
        }.joinToString("\n")

    companion object {
        val NONE = DialCards(emptyList(), emptyList())

        /**
         * From one day's fields. A payload from an app build before the cards
         * existed has no `totals`: no legend then, rather than zeros that
         * would read as an empty day. Sleep and unblocked appear only when the
         * day has a declared window, as in the app; routines only when there
         * are any on the ring.
         */
        fun from(fields: JSONObject?, blocks: List<DialFaceBlock>): DialCards {
            val dial = fields?.optJSONObject("dial") ?: return NONE
            val allDay = ArrayList<DialAllDayItem>()
            val arr = dial.optJSONArray("allDay")
            for (i in 0 until (arr?.length() ?: 0)) {
                val a = arr?.optJSONObject(i) ?: continue
                val title = a.str("title") ?: continue
                allDay += DialAllDayItem(a.str("id") ?: "allday-$i", title, a.optBoolean("completed", false), a.str("colorHex"))
            }
            val totals = dial.optJSONObject("totals")
            val legend = ArrayList<DialLegendItem>()
            if (totals != null) {
                legend += DialLegendItem(DialLegendKey.EFFORT, totals.num("effortMinutes") ?: 0.0)
                legend += DialLegendItem(DialLegendKey.RESTORE, totals.num("restoreMinutes") ?: 0.0)
                totals.num("sleepMinutes")?.let { legend += DialLegendItem(DialLegendKey.SLEEP, it) }
                totals.num("unblockedMinutes")?.let { legend += DialLegendItem(DialLegendKey.UNBLOCKED, it) }
                val routines = blocks.filter { it.kind == DialBlockKind.ROUTINE }
                if (routines.isNotEmpty()) {
                    legend += DialLegendItem(DialLegendKey.ROUTINES, done = routines.count { it.completed }, total = routines.size)
                }
            }
            return DialCards(allDay, legend)
        }
    }
}

enum class DialPlacement { DIAL, TALL, WIDE }

/**
 * Where the cards go for a widget of [widthDp] × [heightDp] (inside its
 * padding), and the box the dial then has. The cards only ever take room the
 * face could not use: tall means the space below a width-limited face, wide
 * the space beside a height-limited one, so the dial is never smaller for
 * having them. All sizes in dp; the card metrics are the layouts'
 * (widget_day_dial_tall.xml, widget_day_dial_wide.xml).
 */
data class DialArrangement(val placement: DialPlacement, val dialWidthDp: Double, val dialHeightDp: Double,
                           val showAllDay: Boolean, val allDayChips: Int, val showLegend: Boolean = placement != DialPlacement.DIAL) {
    companion object {
        /** The All Day card's height in the tall layout, and the gap above each card. */
        const val TALL_CARD_DP = 56.0
        const val CARD_GAP_DP = 6.0
        /** The tall legend: a 40dp row per three totals, 16dp of padding. */
        const val TALL_LEGEND_ROW_DP = 40.0
        const val TALL_LEGEND_CHROME_DP = 16.0
        /** The side column's width in the wide layout, and its gap. */
        const val WIDE_COLUMN_DP = 168.0
        /** One all-day row in the wide column, and the card's fixed part. */
        const val WIDE_ROW_DP = 20.0
        const val WIDE_CARD_CHROME_DP = 40.0
        /** One legend row in the wide column. */
        const val WIDE_LEGEND_ROW_DP = 34.0
        /** A chip's room in the tall all-day row, beyond the card's icon and padding. */
        const val TALL_CHIP_DP = 104.0
        const val TALL_ALLDAY_CHROME_DP = 64.0
        /** The most chips / rows the layouts carry. */
        const val MAX_TALL_CHIPS = 3
        const val MAX_WIDE_ROWS = 5

        private val ASPECT = DialSpec.CANVAS_HEIGHT / DialSpec.CANVAS_WIDTH

        fun choose(widthDp: Double, heightDp: Double, cards: DialCards): DialArrangement {
            val dialOnly = DialArrangement(DialPlacement.DIAL, widthDp, heightDp, false, 0)
            if (cards.isEmpty || widthDp <= 0 || heightDp <= 0) return dialOnly
            val hasLegend = cards.legend.isNotEmpty()
            val hasAllDay = cards.allDay.isNotEmpty()

            // Below: the height a width-limited face leaves over.
            val spareBelow = heightDp - widthDp * ASPECT
            val legendH = if (hasLegend) tallLegendDp(cards) + CARD_GAP_DP else 0.0
            val bothH = legendH + if (hasAllDay) TALL_CARD_DP + CARD_GAP_DP else 0.0
            // Beside: the width a height-limited face leaves over.
            val spareBeside = widthDp - heightDp / ASPECT

            return when {
                spareBeside >= WIDE_COLUMN_DP && spareBeside >= spareBelow && heightDp >= wideLegendH(cards) -> {
                    val room = heightDp - wideLegendH(cards) - (if (hasLegend) CARD_GAP_DP else 0.0)
                    val rows = if (!hasAllDay) 0
                               else floor((room - WIDE_CARD_CHROME_DP) / WIDE_ROW_DP).toInt().coerceIn(0, MAX_WIDE_ROWS)
                    DialArrangement(DialPlacement.WIDE, widthDp - WIDE_COLUMN_DP, heightDp, rows > 0, rows)
                }
                hasAllDay && spareBelow >= bothH ->
                    DialArrangement(DialPlacement.TALL, widthDp, heightDp - bothH, true, tallChips(widthDp))
                // Room for one card: the All Day one, when the day has any. It
                // is the day's context and only there when it matters; the
                // legend is there every day.
                hasAllDay && spareBelow >= TALL_CARD_DP + CARD_GAP_DP ->
                    DialArrangement(DialPlacement.TALL, widthDp, heightDp - TALL_CARD_DP - CARD_GAP_DP, true, tallChips(widthDp),
                        showLegend = false)
                hasLegend && spareBelow >= legendH ->
                    DialArrangement(DialPlacement.TALL, widthDp, heightDp - legendH, false, 0)
                else -> dialOnly
            }
        }

        /** Whether the tall legend's second row (unblocked, routines) shows. */
        fun tallLegendSecondRow(cards: DialCards): Boolean =
            cards.legend.any { it.key == DialLegendKey.UNBLOCKED || it.key == DialLegendKey.ROUTINES }

        /** The legend card's height in the tall layout: one row or two. */
        fun tallLegendDp(cards: DialCards): Double =
            TALL_LEGEND_CHROME_DP + TALL_LEGEND_ROW_DP * (if (tallLegendSecondRow(cards)) 2 else 1)

        /** The legend card's height in the wide column: a row per entry. */
        private fun wideLegendH(cards: DialCards): Double =
            if (cards.legend.isEmpty()) 0.0 else cards.legend.size * WIDE_LEGEND_ROW_DP + WIDE_CARD_CHROME_DP / 2

        private fun tallChips(widthDp: Double): Int =
            floor((widthDp - TALL_ALLDAY_CHROME_DP) / TALL_CHIP_DP).toInt().coerceIn(1, MAX_TALL_CHIPS)

        /** How many of [count] items fit in [slots], and how many are left for "+N". */
        fun overflow(count: Int, slots: Int): Pair<Int, Int> {
            val shown = min(count, max(0, slots))
            return shown to (count - shown)
        }
    }
}
