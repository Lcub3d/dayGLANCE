package com.dayglance.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import com.dayglance.app.R
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Draws one month-grid cell into a bitmap: the iOS MonthGridCellView
 * (MonthGridWidget.swift), stroke for stroke, with Canvas instead of SwiftUI.
 *
 * WHY BITMAPS: a bar sits at a computed offset inside its cell, and
 * RemoteViews cannot place a child at a computed position below API 31
 * (setViewLayoutMargin and friends are 31+; minSdk is 26). The habit ring in
 * the agenda widget already draws itself for the same reason; this extends
 * that pattern to a whole cell. And WHY ONE PER CELL: a bitmap of the whole
 * grid at a 4 × 4 placement is past the 1 MB Binder transaction limit at
 * xxhdpi (docs/day-dial-widget-feasibility.md §7), so the cells go through a
 * GridView collection instead, each its own transaction of ~100–250 KB.
 *
 * Everything is in dp from [MonthGridMetrics] and multiplied by the display
 * density here, so the bitmap draws 1:1 in an ImageView whose width the
 * GridView sets to the same cell width (widget_month_cell.xml).
 *
 * The palette is the mockup's, dark only like iOS (widget_month_colors.xml).
 */
internal class MonthGridCellPainter(private val context: Context) {

    private val density: Float = context.resources.displayMetrics.density

    private val dateColor = context.getColor(R.color.month_widget_date)
    private val emphasisColor = context.getColor(R.color.month_widget_date_emphasis)
    private val mutedColor = context.getColor(R.color.month_widget_muted)
    private val hairlineColor = context.getColor(R.color.month_widget_hairline)
    private val todayFillColor = context.getColor(R.color.month_widget_today_fill)
    private val pipColor = context.getColor(R.color.month_widget_pip)
    private val deadlinePipColor = context.getColor(R.color.month_widget_pip_deadline)

    private val regular: Typeface = Typeface.DEFAULT
    /** iOS's `.medium` weight; bold where the API has no weights. */
    private val emphasis: Typeface =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Typeface.create(Typeface.DEFAULT, 500, false)
        else Typeface.DEFAULT_BOLD

    private fun px(dp: Double): Float = (dp * density).toFloat()

    /** A transparent cell of the right size: the collection's loading view,
     *  so the grid keeps its row height while cells arrive. */
    fun blank(metrics: MonthGridMetrics): Bitmap = createBitmap(metrics)

    private fun createBitmap(metrics: MonthGridMetrics): Bitmap {
        val w = max(1, px(metrics.cellWidth).roundToInt())
        val h = max(1, px(metrics.cellHeight).roundToInt())
        return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    }

    fun draw(cell: MonthGridCell, metrics: MonthGridMetrics): Bitmap {
        val bitmap = createBitmap(metrics)
        val canvas = Canvas(bitmap)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

        // The first of a month: a hairline box, the mockup's 0.5pt (never
        // thinner than a pixel here).
        if (cell.isFirstOfMonth) {
            val stroke = max(1f, px(0.5))
            val box = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = stroke; color = hairlineColor
            }
            val half = stroke / 2
            canvas.drawRoundRect(
                RectF(half, half, bitmap.width - half, bitmap.height - half),
                px(MonthGridMetrics.BOX_RADIUS), px(MonthGridMetrics.BOX_RADIUS), box,
            )
        }

        // The track. No lanes: overlapping bars stack, later on top.
        val trackLeft = px(MonthGridMetrics.CELL_INSET)
        val trackRight = trackLeft + px(metrics.trackWidth)
        val trackTop = px(metrics.trackTop)
        val radius = px(metrics.barRadius)
        for (bar in cell.bars) {
            val f = MonthGrid.barFrame(bar, metrics.trackHeight, metrics.minBarHeight)
            if (f.height <= 0) continue
            fill.color = safeColor(bar.c)
            val top = trackTop + px(f.y)
            canvas.drawRoundRect(RectF(trackLeft, top, trackRight, top + px(f.height)), radius, radius, fill)
        }

        drawHeader(canvas, cell, metrics, fill)
        return bitmap
    }

    /**
     * The header row: the date label (in today's fill when today), the pip or
     * pips after it, and a `+N` at the trailing edge. Every text sits on the
     * same baseline — today's fill is a background with a fixed height and
     * horizontal padding only, so the number does not move (the mockup's box
     * model: content at least 14pt wide, 3pt either side, pulled 2pt left).
     */
    private fun drawHeader(canvas: Canvas, cell: MonthGridCell, metrics: MonthGridMetrics, fill: Paint) {
        val headerHeight = px(metrics.headerHeight)
        val midY = headerHeight / 2
        val cellWidth = px(metrics.cellWidth)
        // iOS: .padding(.leading, 1).padding(.horizontal, cellInset).
        val leading = px(MonthGridMetrics.CELL_INSET + 1)
        val trailing = cellWidth - px(MonthGridMetrics.CELL_INSET + 1)

        // `+N` first, right-aligned, so the label knows what room is left.
        var labelLimit = trailing
        if (cell.overflow > 0) {
            val overflowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = mutedColor; textSize = px(metrics.overflowFontSize); typeface = regular
                textAlign = Paint.Align.RIGHT
            }
            val text = "+${cell.overflow}"
            canvas.drawText(text, trailing, baseline(overflowPaint, midY), overflowPaint)
            // 2pt at least between the pip and a `+N`.
            labelLimit = trailing - overflowPaint.measureText(text) - px(2.0)
        }

        // Which pips, and the room they take after the label.
        val pips = ArrayList<Int>(2)
        if (metrics.showsTwoPips) {
            if (cell.hasAllDay) pips += pipColor
            if (cell.hasDeadline) pips += deadlinePipColor
        } else if (cell.hasPip) {
            pips += pipColor
        }
        val pipSize = px(metrics.pipSize)
        val pipGap = px(metrics.pipGap)
        val pipsWidth = if (pips.isEmpty()) 0f else pips.size * pipSize + pips.size * pipGap

        // The label, shrunk (to 80% at most, like the iOS minimumScaleFactor)
        // when the header is too narrow for it.
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = px(metrics.dateFontSize); typeface = if (cell.isBold) emphasis else regular
        }
        val todayPadding = px(metrics.todayPadding)
        val todayMinWidth = px(metrics.todayMinWidth)
        val labelStart = if (cell.isToday) leading - px(2.0) else leading
        val room = labelLimit - labelStart - pipsWidth - (if (cell.isToday) 2 * todayPadding else 0f)
        var textWidth = labelPaint.measureText(cell.label)
        if (textWidth > room && room > 0) {
            val factor = max(0.8f, room / textWidth)
            labelPaint.textSize *= factor
            textWidth = labelPaint.measureText(cell.label)
        }

        val labelEnd: Float
        if (cell.isToday) {
            val content = max(todayMinWidth, textWidth)
            val fillHeight = px(metrics.todayFillHeight)
            val fillRadius = px(4.0 * metrics.scale)
            fill.color = todayFillColor
            canvas.drawRoundRect(
                RectF(labelStart, midY - fillHeight / 2, labelStart + content + 2 * todayPadding, midY + fillHeight / 2),
                fillRadius, fillRadius, fill,
            )
            labelPaint.color = Color.WHITE
            canvas.drawText(cell.label, labelStart + todayPadding + (content - textWidth) / 2, baseline(labelPaint, midY), labelPaint)
            labelEnd = labelStart + content + 2 * todayPadding
        } else {
            labelPaint.color = if (cell.isBold) emphasisColor else dateColor
            canvas.drawText(cell.label, labelStart, baseline(labelPaint, midY), labelPaint)
            labelEnd = labelStart + textWidth
        }

        var x = labelEnd + pipGap
        for (color in pips) {
            fill.color = color
            canvas.drawCircle(x + pipSize / 2, midY, pipSize / 2, fill)
            x += pipSize + pipGap
        }
    }

    /** The baseline that centres a line of [paint]'s text on [midY]. */
    private fun baseline(paint: Paint, midY: Float): Float {
        val fm = paint.fontMetrics
        return midY - (fm.ascent + fm.descent) / 2
    }

    private fun safeColor(hex: String): Int =
        try { Color.parseColor(hex) } catch (_: Throwable) { dateColor }
}
