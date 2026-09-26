package com.dayglance.app.widget.dial

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

// ─────────────────────────────────────────────────────────────────────────────
// The Day Dial widget's geometry: the Android port of the iOS DayDialGeometry
// package (dayglance-ios/Packages/DayDialGeometry: DialSpec, DialGeometry,
// DialTicks), which is itself the port of src/utils/dayDial.js plus the
// widget spec (docs/day-dial-widget-spec.html). The two widgets draw one
// design, so every constant here is the iOS one, by the same name; where the
// iOS file explains why a value is what it is, that explanation is the
// reference and is not repeated.
//
// Canvas 364×382 points, centre (182, 189). 24-hour, midnight at the top,
// clockwise, y grows downward. Pure: no Android types, JVM-tested against the
// shared vector fixture (dayglance-ios/TestFixtures/dayDial.vectors.json).
// ─────────────────────────────────────────────────────────────────────────────

data class DialPoint(val x: Double, val y: Double)

object DialGeometry {
    const val DAY_MINUTES = 1440.0

    /** Minutes past midnight → radians, clockwise from the top. The JS order:
     *  (min / 1440) * 2 * π, so the two agree to the last bit. */
    fun angle(minutes: Double): Double = (minutes / DAY_MINUTES) * 2 * Math.PI

    /** Degrees from the +x axis, clockwise positive: what Canvas.drawArc takes.
     *  Midnight is -90, 06:00 is 0, 12:00 is 90. */
    fun canvasDegrees(minutes: Double): Double = minutes / DAY_MINUTES * 360.0 - 90.0

    fun point(cx: Double, cy: Double, r: Double, minutes: Double): DialPoint {
        val a = angle(minutes)
        return DialPoint(cx + r * sin(a), cy - r * cos(a))
    }
}

enum class DialTickKind { HOUR, QUARTER, MINOR }
data class DialTick(val minutes: Int, val kind: DialTickKind)

object DialSpec {
    const val CANVAS_WIDTH = 364.0
    const val CANVAS_HEIGHT = 382.0
    const val CX = 182.0
    const val CY = 189.0

    const val SKY_RADIUS = 119.0
    const val SKY_WIDTH = 6.0
    const val BLOCK_RADIUS = 140.0
    const val BLOCK_WIDTH = 22.0
    const val BLOCK_INNER_RADIUS = BLOCK_RADIUS - BLOCK_WIDTH / 2
    const val BLOCK_OUTER_RADIUS = BLOCK_RADIUS + BLOCK_WIDTH / 2

    const val TICK_INNER_RADIUS = 155.0
    const val TICK_OUTER_RADIUS = 166.0
    const val TICK_MINOR_RADIUS = 161.0
    const val TICK_MAJOR_WIDTH = 1.5
    const val TICK_MINOR_WIDTH = 1.0
    const val TICK_MAJOR_OPACITY = 0.30
    const val TICK_MINOR_OPACITY = 0.13

    const val BACKGROUND_HEX = "#0b0b0e"
    const val TRACK_OPACITY = 0.045
    const val SKY_UNLIT_OPACITY = 0.045

    const val LABEL_FONT_SIZE = 10.5
    const val LABEL_TRACKING = 1.4
    const val LABEL_OPACITY = 0.44
    const val LABEL_CARDINAL_RADIUS = 172.0
    const val LABEL_DIAGONAL_RADIUS = 181.0

    const val NEEDLE_COLOR_HEX = "#f5a623"
    const val GLYPH_RADIUS = 104.0
    const val NEEDLE_INNER_RADIUS = 126.0
    const val NEEDLE_OUTER_RADIUS = 159.0
    const val NEEDLE_WIDTH = 2.6
    const val NEEDLE_DOT_RADIUS = 3.4

    const val SEPARATOR_LINE_WIDTH = 1.6

    /** The spec's 15-minute schedule: major on the hour, minor at the quarters. */
    val ticks: List<DialTick> = schedule(15)

    /** dialTicks generalised by step (DialTicks.schedule). */
    fun schedule(stepMinutes: Int): List<DialTick> {
        require(stepMinutes > 0)
        val out = ArrayList<DialTick>()
        var m = 0
        while (m < DialGeometry.DAY_MINUTES.toInt()) {
            val kind = when {
                m % 60 == 0 -> DialTickKind.HOUR
                m % 15 == 0 -> DialTickKind.QUARTER
                else -> DialTickKind.MINOR
            }
            out += DialTick(m, kind)
            m += stepMinutes
        }
        return out
    }

    data class HourLabel(val minutes: Int, val text: String, val radius: Double)

    /** Six labels, no 06 / 18 (they would overflow the width; the sun glyphs live there). */
    val hourLabels: List<HourLabel> = listOf(
        HourLabel(0, "00", LABEL_CARDINAL_RADIUS),
        HourLabel(180, "03", LABEL_DIAGONAL_RADIUS),
        HourLabel(540, "09", LABEL_DIAGONAL_RADIUS),
        HourLabel(720, "12", LABEL_CARDINAL_RADIUS),
        HourLabel(900, "15", LABEL_DIAGONAL_RADIUS),
        HourLabel(1260, "21", LABEL_DIAGONAL_RADIUS),
    )

    fun point(r: Double, minutes: Double): DialPoint = DialGeometry.point(CX, CY, r, minutes)
    fun labelPoint(label: HourLabel): DialPoint = point(label.radius, label.minutes.toDouble())
    fun glyphPoint(minutes: Double): DialPoint = point(GLYPH_RADIUS, minutes)

    fun tickLine(tick: DialTick): Pair<DialPoint, DialPoint> {
        val rIn = if (tick.kind == DialTickKind.HOUR) TICK_INNER_RADIUS else TICK_MINOR_RADIUS
        return point(rIn, tick.minutes.toDouble()) to point(TICK_OUTER_RADIUS, tick.minutes.toDouble())
    }

    fun separatorLine(minutes: Double): Pair<DialPoint, DialPoint> =
        point(BLOCK_INNER_RADIUS, minutes) to point(BLOCK_OUTER_RADIUS, minutes)

    /** Boundaries between touching blocks (a.end == b.start) in a start-sorted
     *  list. Exact equality: a one-minute gap is a gap, not a boundary. */
    fun separatorMinutes(spans: List<Pair<Double, Double>>): List<Double> {
        val out = ArrayList<Double>()
        for (i in 0 until spans.size - 1) if (spans[i + 1].first == spans[i].second) out += spans[i].second
        return out
    }

    // ── Sky ring ─────────────────────────────────────────────────────────────

    enum class SkyBody { SUN, MOON }
    data class SkySegment(val hour: Int, val startMin: Double, val endMin: Double,
                          val body: SkyBody, val strength: Double, val opacity: Double)

    const val SKY_SUN_COLOR_HEX = "#d9b33c"
    const val SKY_MOON_COLOR_HEX = "#c3c3e8"

    fun skyOpacity(body: SkyBody, strength: Double): Double = when (body) {
        SkyBody.SUN -> 0.10 + strength * 0.66
        SkyBody.MOON -> 0.09 + strength * 0.52
    }

    /** The 24 hourly segments from `sky.hours` (sampled at hh:30 on the JS side,
     *  never re-solved). The greater of sun and moon picks the body, sun on a tie. */
    fun skySegments(hours: List<Pair<Double?, Double?>>): List<SkySegment> =
        hours.take(24).mapIndexed { h, (sunIn, moonIn) ->
            val sun = sunIn ?: 0.0
            val moon = moonIn ?: 0.0
            val body = if (sun >= moon) SkyBody.SUN else SkyBody.MOON
            val strength = if (body == SkyBody.SUN) sun else moon
            SkySegment(h, h * 60.0, h * 60.0 + 60, body, strength, skyOpacity(body, strength))
        }

    // ── Glyphs, in glyph-local coordinates (y down, origin on the ring) ──────

    object SunGlyph {
        const val SUNRISE_COLOR_HEX = "#f5c542"
        const val SUNSET_COLOR_HEX = "#f59942"
        const val STROKE_WIDTH = 1.3
        const val STROKE_OPACITY = 0.92
        const val HORIZON_OPACITY = 0.62
        const val DISC_FILL_OPACITY = 0.92
        /** x1, y1, x2, y2 */
        val rays: List<DoubleArray> = listOf(
            doubleArrayOf(-4.10, 2.13, -5.65, 1.04),
            doubleArrayOf(0.0, 0.0, 0.0, -1.9),
            doubleArrayOf(4.10, 2.13, 5.65, 1.04),
        )
        const val DISC_RADIUS = 3.4
        const val HORIZON_Y = 5.0
        val horizon = doubleArrayOf(-7.0, 5.0, 7.0, 5.0)
        val sunriseChevron = listOf(DialPoint(-2.4, -3.2), DialPoint(0.0, -5.6), DialPoint(2.4, -3.2))
        val sunsetChevron = listOf(DialPoint(-2.4, 7.0), DialPoint(0.0, 9.4), DialPoint(2.4, 7.0))
    }

    object MoonGlyph {
        const val COLOR_HEX = "#d8d8f0"
        const val RADIUS = 3.6
        const val STROKE_WIDTH = 1.1
        const val STROKE_OPACITY = 0.55
        const val FILL_OPACITY = 0.85
    }

    // ── Hub: the centre stack. Every y is a TEXT BASELINE (the spec's SVG text) ──

    object Hub {
        const val EYEBROW_Y = 138.0
        const val EYEBROW_FONT_SIZE = 9.5
        const val EYEBROW_TRACKING = 3.2
        const val EYEBROW_OPACITY = 0.46

        const val DATE_Y = 172.0
        const val DATE_FONT_SIZE = 28.0
        const val DATE_OPACITY = 0.96

        const val RULE_Y = CY
        const val RULE_HALF_WIDTH = 34.0
        const val RULE_LINE_WIDTH = 1.0
        const val RULE_OPACITY = 0.16

        const val TITLE_Y = 211.0
        const val TITLE_FONT_SIZE = 15.0
        const val TITLE_OPACITY = 0.95

        const val TAG_FONT_SIZE = 11.0
        const val TAG_OPACITY = 0.44

        const val COUNTDOWN_FONT_SIZE = 11.5
        const val COUNTDOWN_OPACITY = 0.58

        const val RUNWAY_FONT_SIZE = 11.0
        const val RUNWAY_OPACITY = 0.72
        const val RUNWAY_COLOR_HEX = "#4ec9b0"
        const val RUNWAY_MINIMUM_MINUTES = 30.0

        const val OPEN_COLOR_HEX = RUNWAY_COLOR_HEX
        const val SLEEP_OPACITY = 0.55
        const val STATUS_COLOR_HEX = "#f0a848"
        const val NOTE_FONT_SIZE = 9.0
        const val NOTE_OPACITY = 0.40

        /** Rows under the title stack at this pitch, each state using only the rows it has. */
        const val ROW_PITCH = 16.0
        fun rowBaseline(index: Int): Double = TITLE_Y + ROW_PITCH * (index + 1)

        /** How far a row may shrink before it truncates. */
        const val MINIMUM_SCALE = 0.8
        /** Breathing room between a row's ends and the sky ring. */
        const val CHORD_INSET = 6.0

        /** The hub's boundary: the sky ring's inner edge. */
        const val RADIUS = SKY_RADIUS - SKY_WIDTH / 2

        /** Half the chord of the hub circle at baseline `y`, less `inset`. */
        fun halfWidth(y: Double, inset: Double = 0.0): Double {
            val dy = y - CY
            if (abs(dy) >= RADIUS) return 0.0
            return max(0.0, sqrt(RADIUS * RADIUS - dy * dy) - inset)
        }

        fun width(y: Double, inset: Double = 0.0): Double = 2 * halfWidth(y, inset)
    }

    // ── Needle ───────────────────────────────────────────────────────────────

    fun needle(minutes: Double): Pair<DialPoint, DialPoint> =
        point(NEEDLE_INNER_RADIUS, minutes) to point(NEEDLE_OUTER_RADIUS, minutes)
}

/** How JavaScript rounds the numbers dayDial.js emits (see the iOS JSNumber). */
internal object JsNumber {
    /** `Math.round(x * 1e3) / 1e3`, ties away from zero. */
    fun round3(v: Double): Double = roundHalfAway(v * 1000) / 1000

    fun roundHalfAway(v: Double): Double = if (v < 0) -floor(-v + 0.5) else floor(v + 0.5)
}
