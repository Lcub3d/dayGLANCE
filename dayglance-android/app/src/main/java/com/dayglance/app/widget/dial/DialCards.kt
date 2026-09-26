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
                           val showAllDay: Boolean, val allDayChips: Int, val showLegend: Boolean = placement != DialPlacement.DIAL,
                           /** How much the cards are drawn up from their phone size (DayDialCardsBinder). */
                           val scale: Double = 1.0) {
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

        /**
         * The card metrics above are a phone's. A tablet placement has the
         * room for more, and at phone size the cards read as an afterthought
         * under a dial twice as wide (#1830's device test): they scale with
         * the placement, from 1 at a 300dp phone width to 1.6 on a tablet
         * (tall), or with the height, to 1.5 (wide). Only where the widget
         * can resize its views (Android 12+, setViewLayoutHeight and
         * friends); below that the layouts' own dp stand and the scale is 1.
         */
        const val REFERENCE_DP = 300.0
        const val MAX_TALL_SCALE = 1.6
        const val MAX_WIDE_SCALE = 1.5

        private val ASPECT = DialSpec.CANVAS_HEIGHT / DialSpec.CANVAS_WIDTH

        fun choose(widthDp: Double, heightDp: Double, cards: DialCards, resizable: Boolean = true): DialArrangement {
            val dialOnly = DialArrangement(DialPlacement.DIAL, widthDp, heightDp, false, 0)
            if (cards.isEmpty || widthDp <= 0 || heightDp <= 0) return dialOnly
            val hasLegend = cards.legend.isNotEmpty()
            val hasAllDay = cards.allDay.isNotEmpty()
            val tallCap = if (resizable) (widthDp / REFERENCE_DP).coerceIn(1.0, MAX_TALL_SCALE) else 1.0
            val wideCap = if (resizable) (heightDp / REFERENCE_DP).coerceIn(1.0, MAX_WIDE_SCALE) else 1.0

            // Below: the height a width-limited face leaves over. Each card
            // set is tried at the largest scale up to the cap that still
            // fits, so drawing up never costs a card that fits at phone size.
            val spareBelow = heightDp - widthDp * ASPECT
            val allDayBase = TALL_CARD_DP + CARD_GAP_DP
            val legendBase = if (hasLegend) tallLegendDp(cards) + CARD_GAP_DP else 0.0
            val bothBase = legendBase + if (hasAllDay) allDayBase else 0.0
            fun fit(base: Double) = if (base <= 0) tallCap else min(tallCap, spareBelow / base)
            // Beside: the width a height-limited face leaves over.
            val spareBeside = widthDp - heightDp / ASPECT
            val ws = if (cards.legend.isEmpty()) wideCap else min(wideCap, heightDp / wideLegendH(cards))
            val column = WIDE_COLUMN_DP * ws

            return when {
                ws >= 1.0 && spareBeside >= column && spareBeside >= spareBelow && heightDp >= wideLegendH(cards) * ws -> {
                    val room = heightDp - (wideLegendH(cards) + if (hasLegend) CARD_GAP_DP else 0.0) * ws
                    val rows = if (!hasAllDay) 0
                               else floor((room - WIDE_CARD_CHROME_DP * ws) / (WIDE_ROW_DP * ws)).toInt().coerceIn(0, MAX_WIDE_ROWS)
                    DialArrangement(DialPlacement.WIDE, widthDp - column, heightDp, rows > 0, rows, scale = ws)
                }
                hasAllDay && fit(bothBase) >= 1.0 -> {
                    val ts = fit(bothBase)
                    DialArrangement(DialPlacement.TALL, widthDp, heightDp - bothBase * ts, true, tallChips(widthDp, ts), scale = ts)
                }
                // Room for one card: the All Day one, when the day has any. It
                // is the day's context and only there when it matters; the
                // legend is there every day.
                hasAllDay && fit(allDayBase) >= 1.0 -> {
                    val ts = fit(allDayBase)
                    DialArrangement(DialPlacement.TALL, widthDp, heightDp - allDayBase * ts, true, tallChips(widthDp, ts),
                        showLegend = false, scale = ts)
                }
                hasLegend && fit(legendBase) >= 1.0 -> {
                    val ts = fit(legendBase)
                    DialArrangement(DialPlacement.TALL, widthDp, heightDp - legendBase * ts, false, 0, scale = ts)
                }
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

        private fun tallChips(widthDp: Double, scale: Double): Int =
            floor((widthDp - TALL_ALLDAY_CHROME_DP * scale) / (TALL_CHIP_DP * scale)).toInt().coerceIn(1, MAX_TALL_CHIPS)

        /**
         * The widest a tall chip's title may be, in dp, so the chips shown
         * share the row instead of each stopping at a fixed cap: one title
         * alone gets nearly the whole card. [hidden] reserves the "+N".
         */
        fun tallTitleMaxDp(widthDp: Double, scale: Double, shown: Int, hidden: Int): Double {
            if (shown <= 0) return 0.0
            val inner = widthDp - TALL_ALLDAY_CHROME_DP * scale - (if (hidden > 0) 32.0 * scale else 0.0)
            // Each chip also spends its dot, the gap after it and its trailing margin.
            return max(24.0 * scale, inner / shown - 24.0 * scale)
        }

        /** How many of [count] items fit in [slots], and how many are left for "+N". */
        fun overflow(count: Int, slots: Int): Pair<Int, Int> {
            val shown = min(count, max(0, slots))
            return shown to (count - shown)
        }
    }
}
