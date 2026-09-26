package com.dayglance.app.widget.dial

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import kotlin.math.max

// ─────────────────────────────────────────────────────────────────────────────
// Draws the Day Dial's static face and the hub's static rows into a bitmap,
// and the hub's live row into a strip: the Android counterpart of the iOS
// DialFaceView (face) and DialHubView (hub), in the same spec coordinates.
// The needle is not drawn here: it is a <rotate> drawable over the face,
// turned by ImageView.setImageLevel (day_dial_needle.xml), so the minute tick
// never resends the face.
//
// Layer order, as iOS: sky ring, glyphs, block track, ticks, block band,
// separators, hour labels; then the hub over it. A stale or mis-zoned day
// dims the FACE only (0.45, half grey); the hub carries the label.
// ─────────────────────────────────────────────────────────────────────────────

/** The typefaces the dial draws with. Built once per render from the app's
 *  resources on device (Lora for the date, the system sans for the rest). */
class DialFonts(
    val date: Typeface,
    val medium: Typeface,
    val semibold: Typeface,
    val regular: Typeface = Typeface.DEFAULT,
    val italic: Typeface = Typeface.create(Typeface.DEFAULT, Typeface.ITALIC),
)

/** The hub's two fixed rows: the upper-cased weekday and "July 7". */
data class DialHubHeader(val eyebrow: String, val date: String)

class DialFacePainter(private val fonts: DialFonts) {

    /**
     * The whole static image at [scale] pixels per spec point, transparent
     * outside the drawing (the widget's own background shows through).
     */
    fun drawFace(scale: Float, input: DialFaceInput, nowMin: Double, header: DialHubHeader,
                 rows: DialHubRows, dimmed: Boolean): Bitmap {
        val bmp = Bitmap.createBitmap(px(DialSpec.CANVAS_WIDTH, scale), px(DialSpec.CANVAS_HEIGHT, scale), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(scale, scale)

        // The face in its own layer: the separators cut out of it (DST_OUT)
        // rather than painting background over it, and dimming applies to the
        // layer as a whole.
        val layerPaint = Paint().apply {
            if (dimmed) {
                alpha = (0.45f * 255).toInt()
                colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0.5f) })
            }
        }
        c.saveLayer(0f, 0f, DialSpec.CANVAS_WIDTH.toFloat(), DialSpec.CANVAS_HEIGHT.toFloat(), layerPaint)
        drawSky(c, input)
        drawGlyphs(c, input)
        drawTrack(c)
        drawTicks(c)
        val styles = DialBand.styles(input.blocks, nowMin, input.projectedDay)
        drawBlocks(c, styles)
        drawSeparators(c, styles)
        drawLabels(c)
        c.restore()

        drawHub(c, header, rows)
        return bmp
    }

    /** The live row alone, on a transparent strip the size of its slot. */
    fun drawLiveStrip(scale: Float, slot: DialLiveSlot, row: DialHubRow): Bitmap {
        val r = slot.rect
        val bmp = Bitmap.createBitmap(px(r[2], scale), px(r[3], scale), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(scale, scale)
        c.translate(-r[0].toFloat(), -r[1].toFloat())
        drawRow(c, row, slot.baseline)
        return bmp
    }

    /** Width of [text] in the DETAIL row's font, in spec points. */
    fun measureDetail(text: String): Double = paintFor(DialHubRowStyle.DETAIL).measureText(text).toDouble()

    // ── Face ─────────────────────────────────────────────────────────────────

    private fun drawSky(c: Canvas, input: DialFaceInput) {
        val p = stroke(DialSpec.SKY_WIDTH, Paint.Cap.BUTT)
        if (input.sky.isEmpty()) {
            p.color = white(DialSpec.SKY_UNLIT_OPACITY)
            c.drawCircle(DialSpec.CX.toFloat(), DialSpec.CY.toFloat(), DialSpec.SKY_RADIUS.toFloat(), p)
            return
        }
        val oval = oval(DialSpec.SKY_RADIUS)
        for (seg in input.sky) {
            p.color = color(if (seg.body == DialSpec.SkyBody.SUN) DialSpec.SKY_SUN_COLOR_HEX else DialSpec.SKY_MOON_COLOR_HEX, seg.opacity)
            c.drawArc(oval, start(seg.startMin), sweep(seg.startMin, seg.endMin), false, p)
        }
    }

    // No glyphs without a sky: rise, set and moon are facts about a place.
    private fun drawGlyphs(c: Canvas, input: DialFaceInput) {
        if (input.sky.isEmpty()) return
        input.sunriseMin?.let { drawSun(c, DialSpec.glyphPoint(it), rising = true) }
        input.sunsetMin?.let { drawSun(c, DialSpec.glyphPoint(it), rising = false) }
        input.moon?.let { drawMoon(c, DialSpec.glyphPoint(it.minutes), it) }
    }

    private fun drawSun(c: Canvas, at: DialPoint, rising: Boolean) {
        val g = DialSpec.SunGlyph
        val hex = if (rising) g.SUNRISE_COLOR_HEX else g.SUNSET_COLOR_HEX
        c.save()
        c.translate(at.x.toFloat(), at.y.toFloat())
        val s = stroke(g.STROKE_WIDTH, Paint.Cap.ROUND).apply { strokeJoin = Paint.Join.ROUND }

        val strokes = Path()
        for (r in g.rays) { strokes.moveTo(r[0].toFloat(), r[1].toFloat()); strokes.lineTo(r[2].toFloat(), r[3].toFloat()) }
        val chevron = if (rising) g.sunriseChevron else g.sunsetChevron
        strokes.moveTo(chevron[0].x.toFloat(), chevron[0].y.toFloat())
        for (pt in chevron.drop(1)) strokes.lineTo(pt.x.toFloat(), pt.y.toFloat())
        s.color = color(hex, g.STROKE_OPACITY)
        c.drawPath(strokes, s)

        // The upper half of the disc, its flat side on the horizon.
        val disc = Path().apply {
            val r = g.DISC_RADIUS.toFloat()
            val y = g.HORIZON_Y.toFloat()
            moveTo(-r, y)
            arcTo(RectF(-r, y - r, r, y + r), 180f, 180f)
            close()
        }
        c.drawPath(disc, fill(color(hex, g.DISC_FILL_OPACITY)))

        s.color = color(hex, g.HORIZON_OPACITY)
        c.drawLine(g.horizon[0].toFloat(), g.horizon[1].toFloat(), g.horizon[2].toFloat(), g.horizon[3].toFloat(), s)
        c.restore()
    }

    private fun drawMoon(c: Canvas, at: DialPoint, moon: DialMoonGlyph) {
        val g = DialSpec.MoonGlyph
        val r = g.RADIUS.toFloat()
        val geo = MoonPhase.geometry(g.RADIUS, moon.fraction, moon.waxing, moon.mirror)
        c.save()
        c.translate(at.x.toFloat(), at.y.toFloat())
        c.drawCircle(0f, 0f, r, stroke(g.STROKE_WIDTH, Paint.Cap.BUTT).apply { color = color(g.COLOR_HEX, g.STROKE_OPACITY) })
        // "M 0 -r A r r 0 0 s 0 r A rx r 0 0 t 0 -r Z": SVG sweep 1 is clockwise
        // on screen, which is a positive sweep here.
        val lit = Path().apply {
            moveTo(0f, -r)
            arcTo(RectF(-r, -r, r, r), -90f, if (geo.limbSweep == 1) 180f else -180f)
            val rx = geo.terminatorRx.toFloat()
            if (rx > 0f) arcTo(RectF(-rx, -r, rx, r), 90f, if (geo.terminatorSweep == 1) 180f else -180f)
            close()
        }
        c.drawPath(lit, fill(color(g.COLOR_HEX, g.FILL_OPACITY)))
        c.restore()
    }

    private fun drawTrack(c: Canvas) {
        c.drawCircle(DialSpec.CX.toFloat(), DialSpec.CY.toFloat(), DialSpec.BLOCK_RADIUS.toFloat(),
            stroke(DialSpec.BLOCK_WIDTH, Paint.Cap.BUTT).apply { color = white(DialSpec.TRACK_OPACITY) })
    }

    private fun drawTicks(c: Canvas) {
        val major = stroke(DialSpec.TICK_MAJOR_WIDTH, Paint.Cap.ROUND).apply { color = white(DialSpec.TICK_MAJOR_OPACITY) }
        val minor = stroke(DialSpec.TICK_MINOR_WIDTH, Paint.Cap.BUTT).apply { color = white(DialSpec.TICK_MINOR_OPACITY) }
        for (tick in DialSpec.ticks) {
            val (a, b) = DialSpec.tickLine(tick)
            c.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), if (tick.kind == DialTickKind.HOUR) major else minor)
        }
    }

    // Variant C: a sector fill across the lane's band plus a rim on its outer edge.
    private fun drawBlocks(c: Canvas, styles: List<DialBlockStyle>) {
        for (s in styles) {
            val start = start(s.startMin)
            val sweep = sweep(s.startMin, s.endMin)
            if (s.fillOpacity > 0) {
                val sector = Path().apply {
                    arcTo(oval(s.rOuter), start, sweep, true)
                    arcTo(oval(s.rInner), start + sweep, -sweep)
                    close()
                }
                c.drawPath(sector, fill(color(s.colorHex, s.fillOpacity)))
            }
            c.drawArc(oval(s.rimRadius), start, sweep, false,
                stroke(s.rimWidth, Paint.Cap.BUTT).apply { color = color(s.colorHex, s.rimOpacity) })
        }
    }

    private fun drawSeparators(c: Canvas, styles: List<DialBlockStyle>) {
        val cut = stroke(DialSpec.SEPARATOR_LINE_WIDTH, Paint.Cap.BUTT).apply {
            color = Color.BLACK
            xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
        }
        for (m in DialSpec.separatorMinutes(styles.map { it.startMin to it.endMin })) {
            val (a, b) = DialSpec.separatorLine(m)
            c.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), cut)
        }
    }

    private fun drawLabels(c: Canvas) {
        val p = text(fonts.medium, DialSpec.LABEL_FONT_SIZE, white(DialSpec.LABEL_OPACITY)).apply {
            letterSpacing = (DialSpec.LABEL_TRACKING / DialSpec.LABEL_FONT_SIZE).toFloat()
        }
        for (label in DialSpec.hourLabels) {
            val pt = DialSpec.labelPoint(label)
            c.drawText(label.text, pt.x.toFloat(), centredBaseline(pt.y, p), p)
        }
    }

    // ── Hub ──────────────────────────────────────────────────────────────────

    private fun drawHub(c: Canvas, header: DialHubHeader, rows: DialHubRows) {
        val h = DialSpec.Hub
        val eyebrow = text(fonts.semibold, h.EYEBROW_FONT_SIZE, white(h.EYEBROW_OPACITY)).apply {
            letterSpacing = (h.EYEBROW_TRACKING / h.EYEBROW_FONT_SIZE).toFloat()
        }
        drawCentred(c, header.eyebrow, h.EYEBROW_Y, eyebrow, shrinks = false)
        drawCentred(c, header.date, h.DATE_Y, text(fonts.date, h.DATE_FONT_SIZE, white(h.DATE_OPACITY)), shrinks = true)

        c.drawLine((DialSpec.CX - h.RULE_HALF_WIDTH).toFloat(), h.RULE_Y.toFloat(), (DialSpec.CX + h.RULE_HALF_WIDTH).toFloat(),
            h.RULE_Y.toFloat(), stroke(h.RULE_LINE_WIDTH, Paint.Cap.BUTT).apply { color = white(h.RULE_OPACITY) })

        rows.title?.let { if (!(rows.hasLive && rows.liveIndex == null)) drawRow(c, it, h.TITLE_Y) }
        rows.stack.forEachIndexed { i, r -> if (!(rows.hasLive && rows.liveIndex == i)) drawRow(c, r, h.rowBaseline(i)) }
    }

    private fun drawRow(c: Canvas, row: DialHubRow, baseline: Double) {
        drawCentred(c, row.text, baseline, paintFor(row.style), row.shrinks)
    }

    private fun paintFor(style: DialHubRowStyle): TextPaint {
        val h = DialSpec.Hub
        return when (style) {
            DialHubRowStyle.TITLE -> text(fonts.semibold, h.TITLE_FONT_SIZE, white(h.TITLE_OPACITY))
            DialHubRowStyle.TITLE_OPEN -> text(fonts.semibold, h.TITLE_FONT_SIZE, color(h.OPEN_COLOR_HEX, h.TITLE_OPACITY))
            DialHubRowStyle.TITLE_STATUS -> text(fonts.semibold, h.TITLE_FONT_SIZE, color(h.STATUS_COLOR_HEX, h.TITLE_OPACITY))
            DialHubRowStyle.TITLE_SLEEP -> text(fonts.semibold, h.TITLE_FONT_SIZE, white(h.SLEEP_OPACITY))
            DialHubRowStyle.TAG -> text(fonts.italic, h.TAG_FONT_SIZE, white(h.TAG_OPACITY))
            DialHubRowStyle.DETAIL -> text(fonts.regular, h.COUNTDOWN_FONT_SIZE, white(h.COUNTDOWN_OPACITY))
            DialHubRowStyle.RUNWAY -> text(fonts.regular, h.RUNWAY_FONT_SIZE, color(h.RUNWAY_COLOR_HEX, h.RUNWAY_OPACITY))
            DialHubRowStyle.NOTE -> text(fonts.regular, h.NOTE_FONT_SIZE, white(h.NOTE_OPACITY))
        }
    }

    /**
     * One line centred on the dial's axis with its baseline at [baseline], no
     * wider than the hub's chord there: shrunk to 0.8 when allowed, then cut
     * with an ellipsis.
     */
    private fun drawCentred(c: Canvas, text: String, baseline: Double, paint: TextPaint, shrinks: Boolean) {
        if (text.isEmpty()) return
        val room = DialSpec.Hub.width(baseline, DialSpec.Hub.CHORD_INSET).toFloat()
        if (room <= 0f) return
        var width = paint.measureText(text)
        if (width > room && shrinks) {
            val scale = max(DialSpec.Hub.MINIMUM_SCALE.toFloat(), room / width)
            paint.textSize *= scale
            width = paint.measureText(text)
        }
        val shown = if (width > room) TextUtils.ellipsize(text, paint, room, TextUtils.TruncateAt.END).toString() else text
        paint.textAlign = Paint.Align.CENTER
        c.drawText(shown, DialSpec.CX.toFloat(), baseline.toFloat(), paint)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun px(points: Double, scale: Float) = max(1, (points * scale).toInt())

    private fun oval(r: Double) = RectF((DialSpec.CX - r).toFloat(), (DialSpec.CY - r).toFloat(),
        (DialSpec.CX + r).toFloat(), (DialSpec.CY + r).toFloat())

    private fun start(minutes: Double) = DialGeometry.canvasDegrees(minutes).toFloat()
    private fun sweep(startMin: Double, endMin: Double) = ((endMin - startMin) / DialGeometry.DAY_MINUTES * 360.0).toFloat()

    private fun stroke(width: Double, cap: Paint.Cap) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = width.toFloat()
        strokeCap = cap
    }

    private fun fill(color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }

    private fun text(face: Typeface, size: Double, color: Int) = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = face
        textSize = size.toFloat()
        this.color = color
        textAlign = Paint.Align.CENTER
    }

    /** The baseline that centres a line's ascent-to-descent box on [y]. */
    private fun centredBaseline(y: Double, p: Paint): Float {
        val fm = p.fontMetrics
        return (y - (fm.ascent + fm.descent) / 2).toFloat()
    }

    private fun white(opacity: Double) = Color.argb((opacity * 255).toInt(), 255, 255, 255)

    private fun color(hex: String, opacity: Double): Int {
        val rgb = runCatching { Color.parseColor(hex) }.getOrDefault(Color.WHITE)
        return Color.argb((opacity * 255).toInt(), Color.red(rgb), Color.green(rgb), Color.blue(rgb))
    }
}
