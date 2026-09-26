package com.dayglance.app.widget.dial

import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import com.dayglance.app.R

/**
 * Fills the All Day card and the legend in the tall and wide layouts
 * (widget_day_dial_tall.xml, widget_day_dial_wide.xml) from [DialCards], in
 * the in-app dial's tones: an incomplete all-day item at white 90 %, a done
 * one at 40 %, each with its muted colour dot.
 *
 * It only ever touches ids the arrangement's layout carries: the tall row
 * has three chips, the wide list five, the dial-only layout none. A
 * RemoteViews action on a view that is not there fails the whole widget.
 */
internal object DayDialCardsBinder {
    private class Chip(val row: Int, val dot: Int, val title: Int)

    private val CHIPS = listOf(
        Chip(R.id.ll_day_dial_allday_chip_1, R.id.iv_day_dial_allday_dot_1, R.id.tv_day_dial_allday_title_1),
        Chip(R.id.ll_day_dial_allday_chip_2, R.id.iv_day_dial_allday_dot_2, R.id.tv_day_dial_allday_title_2),
        Chip(R.id.ll_day_dial_allday_chip_3, R.id.iv_day_dial_allday_dot_3, R.id.tv_day_dial_allday_title_3),
        Chip(R.id.ll_day_dial_allday_chip_4, R.id.iv_day_dial_allday_dot_4, R.id.tv_day_dial_allday_title_4),
        Chip(R.id.ll_day_dial_allday_chip_5, R.id.iv_day_dial_allday_dot_5, R.id.tv_day_dial_allday_title_5),
    )

    private val LEGEND = mapOf(
        DialLegendKey.EFFORT to (R.id.ll_day_dial_legend_effort to R.id.tv_day_dial_legend_effort_value),
        DialLegendKey.RESTORE to (R.id.ll_day_dial_legend_restore to R.id.tv_day_dial_legend_restore_value),
        DialLegendKey.SLEEP to (R.id.ll_day_dial_legend_sleep to R.id.tv_day_dial_legend_sleep_value),
        DialLegendKey.UNBLOCKED to (R.id.ll_day_dial_legend_unblocked to R.id.tv_day_dial_legend_unblocked_value),
        DialLegendKey.ROUTINES to (R.id.ll_day_dial_legend_routines to R.id.tv_day_dial_legend_routines_value),
    )

    private val TEXT_ON = Color.argb((0.90 * 255).toInt(), 255, 255, 255)
    private val TEXT_DONE = Color.argb((0.40 * 255).toInt(), 255, 255, 255)

    /** How many chips a placement's layout carries. */
    fun chipsIn(placement: DialPlacement): Int = when (placement) {
        DialPlacement.DIAL -> 0
        DialPlacement.TALL -> DialArrangement.MAX_TALL_CHIPS
        DialPlacement.WIDE -> DialArrangement.MAX_WIDE_ROWS
    }

    fun bind(views: RemoteViews, arrangement: DialArrangement, cards: DialCards, copy: DialHubCopy) {
        if (arrangement.placement == DialPlacement.DIAL) return

        val slots = if (arrangement.showAllDay) arrangement.allDayChips else 0
        val (shown, hidden) = DialArrangement.overflow(cards.allDay.size, slots)
        views.setViewVisibility(R.id.ll_day_dial_allday, if (shown > 0) View.VISIBLE else View.GONE)
        for ((i, chip) in CHIPS.take(chipsIn(arrangement.placement)).withIndex()) {
            val item = cards.allDay.getOrNull(i)
            if (i >= shown || item == null) {
                views.setViewVisibility(chip.row, View.GONE)
                continue
            }
            views.setViewVisibility(chip.row, View.VISIBLE)
            views.setTextViewText(chip.title, item.title)
            views.setTextColor(chip.title, if (item.completed) TEXT_DONE else TEXT_ON)
            views.setInt(chip.dot, "setColorFilter", runCatching { Color.parseColor(DialPalette.mute(item.colorHex)) }.getOrDefault(Color.WHITE))
        }
        if (hidden > 0) {
            views.setViewVisibility(R.id.tv_day_dial_allday_more, View.VISIBLE)
            views.setTextViewText(R.id.tv_day_dial_allday_more, "+$hidden")
        } else {
            views.setViewVisibility(R.id.tv_day_dial_allday_more, View.GONE)
        }

        val legend = arrangement.showLegend && cards.legend.isNotEmpty()
        views.setViewVisibility(R.id.ll_day_dial_legend, if (legend) View.VISIBLE else View.GONE)
        // The tall grid's second row (unblocked, routines); the wide list has none.
        if (arrangement.placement == DialPlacement.TALL) {
            views.setViewVisibility(R.id.ll_day_dial_legend_row2,
                if (DialArrangement.tallLegendSecondRow(cards)) View.VISIBLE else View.GONE)
        }
        for ((key, ids) in LEGEND) {
            val item = cards.legend.firstOrNull { it.key == key }
            views.setViewVisibility(ids.first, if (item != null) View.VISIBLE else View.GONE)
            if (item != null) views.setTextViewText(ids.second, legendValue(item, copy))
        }
    }

    /** "3h 20m", or "2/3" for routines, as the in-app legend reads. */
    fun legendValue(item: DialLegendItem, copy: DialHubCopy): String =
        if (item.key == DialLegendKey.ROUTINES) "${item.done}/${item.total}" else copy.duration(item.minutes ?: 0.0)
}
