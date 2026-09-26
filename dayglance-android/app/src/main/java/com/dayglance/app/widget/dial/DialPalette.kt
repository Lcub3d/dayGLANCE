package com.dayglance.app.widget.dial

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// ─────────────────────────────────────────────────────────────────────────────
// The block band and its palette: the port of the iOS DialPalette.swift,
// DialBand.swift and the lane/moon helpers (DialSegments.swift,
// MoonPhase.swift). Variant C of docs/day-dial-palette-study.html: each block
// is an annular sector fill across the band plus a rim on the band's outer
// edge; the app's muted colours, duration curve and state multipliers. Pure.
// ─────────────────────────────────────────────────────────────────────────────

/** What is on the ring, as the snapshot's `dial.blocks[].type` names it. */
enum class DialBlockKind {
    TASK, EVENT, ROUTINE, SLEEP;

    companion object {
        /** Unknown or absent types draw as a task, as on iOS. */
        fun of(type: String?): DialBlockKind = when (type) {
            "event" -> EVENT
            "routine" -> ROUTINE
            "sleep" -> SLEEP
            else -> TASK
        }
    }
}

/** One block as the face and hub need it: a snapshot `dial.blocks[]` entry. */
data class DialFaceBlock(
    val id: String,
    val kind: DialBlockKind,
    /** The DRAWN span, clipped at midnight. */
    val startMin: Double,
    val endMin: Double,
    val endsNextDay: Boolean = false,
    val startedPrevDay: Boolean = false,
    val completed: Boolean = false,
    val colorHex: String? = null,
    val lane: Int = 0,
    val laneCount: Int = 1,
    /** The true end when [endsNextDay], minutes into the next day. */
    val endMinTrue: Double? = null,
    val title: String? = null,
    val tag: String? = null,
) {
    /** Minutes from midnight to the real end: past 1440 for a block into tomorrow. */
    val trueEndMin: Double
        get() = if (endsNextDay && endMinTrue != null) DialGeometry.DAY_MINUTES + endMinTrue else endMin
}

data class DialTone(val fill: Double, val edge: Double)

data class DialBlockStyle(
    val id: String,
    val kind: DialBlockKind,
    val startMin: Double,
    val endMin: Double,
    val rInner: Double,
    val rOuter: Double,
    val colorHex: String,
    val fillOpacity: Double,
    val rimRadius: Double,
    val rimWidth: Double,
    val rimOpacity: Double,
    val isPast: Boolean,
)

object DialPalette {
    /** DIAL_COLORS.effort, returned RAW for an unparseable colour. */
    const val FALLBACK_HEX = "#93c5fd"
    const val SATURATION_MINUTES = 180.0

    const val PAST_MUTE = 0.6
    const val DONE_EDGE_MUTE = 0.25
    const val UNDONE_FILL_MUTE = 0.35
    const val SLEEP_MUTE = 0.6
    const val ROUTINE_OPACITY = 0.5
    const val ROUTINE_DONE_OPACITY = 0.18

    /** muteDialColor: keep the hue, cap saturation at 0.5, pin lightness at 0.73. */
    fun mute(hex: String?): String {
        val rgb = rgb(hex) ?: return FALLBACK_HEX
        val (r, g, b) = rgb
        val mx = maxOf(r, g, b)
        val mn = minOf(r, g, b)
        var h = 0.0
        if (mx != mn) {
            val d = mx - mn
            h = when (mx) {
                r -> ((g - b) / d + (if (g < b) 6 else 0)) / 6
                g -> ((b - r) / d + 2) / 6
                else -> ((r - g) / d + 4) / 6
            }
        }
        val l0 = (mx + mn) / 2
        val s0 = if (mx == mn) 0.0 else (mx - mn) / (1 - abs(2 * l0 - 1))
        val s = min(s0, 0.5)
        val l = 0.73
        val c = (1 - abs(2 * l - 1)) * s
        val x = c * (1 - abs((h * 6) % 2 - 1))
        val m2 = l - c / 2
        val seg = floor(h * 6).toInt() % 6
        val (r1, g1, b1) = when (seg) {
            0 -> Triple(c, x, 0.0)
            1 -> Triple(x, c, 0.0)
            2 -> Triple(0.0, c, x)
            3 -> Triple(0.0, x, c)
            4 -> Triple(x, 0.0, c)
            else -> Triple(c, 0.0, x)
        }
        fun byte(v: Double) = "%02x".format(JsNumber.roundHalfAway((v + m2) * 255).toInt())
        return "#${byte(r1)}${byte(g1)}${byte(b1)}"
    }

    /** `/^#([0-9a-f]{6})$/i` → components in 0..1, else null. */
    internal fun rgb(hex: String?): Triple<Double, Double, Double>? {
        if (hex == null || hex.length != 7 || hex[0] != '#') return null
        val body = hex.substring(1)
        if (!body.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
        val n = body.toInt(16)
        return Triple(((n shr 16) and 255) / 255.0, ((n shr 8) and 255) / 255.0, (n and 255) / 255.0)
    }

    /** 0..1 by duration, saturating at three hours. */
    fun t(durationMinutes: Double): Double = max(0.0, min(1.0, durationMinutes / SATURATION_MINUTES))

    /**
     * DayDial.jsx's state multipliers, with the widget's projected-day rule:
     * on a projected day completion flags carry no information, so every past
     * task and routine takes the past-event tone rather than "past undone".
     */
    fun tone(kind: DialBlockKind, completed: Boolean, past: Boolean,
             startedPrevDay: Boolean = false, projectedDay: Boolean = false): DialTone = when (kind) {
        DialBlockKind.SLEEP -> {
            val m = if (past) SLEEP_MUTE * PAST_MUTE else SLEEP_MUTE
            DialTone(m, m)
        }
        DialBlockKind.ROUTINE -> {
            val done = if (projectedDay) past else completed
            DialTone(0.0, if (done) ROUTINE_DONE_OPACITY else ROUTINE_OPACITY)
        }
        DialBlockKind.TASK, DialBlockKind.EVENT -> when {
            completed && !projectedDay -> DialTone(PAST_MUTE, DONE_EDGE_MUTE)
            !past -> DialTone(1.0, 1.0)
            projectedDay -> DialTone(PAST_MUTE, PAST_MUTE)
            kind == DialBlockKind.EVENT || startedPrevDay -> DialTone(PAST_MUTE, PAST_MUTE)
            else -> DialTone(UNDONE_FILL_MUTE, 1.0)
        }
    }
}

/** The band treatment's widget-scale reweighting (DialBandTreatment). */
object DialBandTreatment {
    const val FILL_SCALE = 3.5
    const val RIM_WIDTH_MIN = 1.5
    const val RIM_WIDTH_MAX = 2.5

    fun fillOpacity(t: Double, stateFill: Double): Double = min(1.0, (0.05 + 0.11 * t) * FILL_SCALE * stateFill)
    fun rimWidth(t: Double): Double = RIM_WIDTH_MIN + (RIM_WIDTH_MAX - RIM_WIDTH_MIN) * t
    fun rimOpacity(t: Double, stateEdge: Double): Double = min(1.0, (0.45 + 0.55 * t) * stateEdge)
}

object DialBand {
    /** teal-300, ROUTINE_COLOR. Not muted. */
    const val ROUTINE_COLOR_HEX = "#5eead4"
    /** violet-300, DIAL_COLORS.sleep. Not muted. */
    const val SLEEP_COLOR_HEX = "#c4b5fd"

    /** Wholly behind the needle; a block into tomorrow is never past today. */
    fun isPast(block: DialFaceBlock, nowMin: Double): Boolean = !block.endsNextDay && block.endMin <= nowMin

    fun colorHex(block: DialFaceBlock): String = when (block.kind) {
        DialBlockKind.ROUTINE -> ROUTINE_COLOR_HEX
        DialBlockKind.SLEEP -> SLEEP_COLOR_HEX
        DialBlockKind.TASK, DialBlockKind.EVENT -> DialPalette.mute(block.colorHex)
    }

    fun style(block: DialFaceBlock, nowMin: Double, projectedDay: Boolean): DialBlockStyle {
        val past = isPast(block, nowMin)
        val tone = DialPalette.tone(block.kind, block.completed, past, block.startedPrevDay, projectedDay)
        val t = DialPalette.t(block.endMin - block.startMin)
        val (rIn, rOut) = laneBand(DialSpec.BLOCK_INNER_RADIUS, DialSpec.BLOCK_OUTER_RADIUS, block.lane, block.laneCount)
        val rimWidth = DialBandTreatment.rimWidth(t)
        val fill: Double
        val rim: Double
        if (block.kind == DialBlockKind.ROUTINE) {
            fill = 0.0
            rim = tone.edge
        } else {
            fill = DialBandTreatment.fillOpacity(t, tone.fill)
            rim = DialBandTreatment.rimOpacity(t, tone.edge)
        }
        return DialBlockStyle(block.id, block.kind, block.startMin, block.endMin, rIn, rOut, colorHex(block),
            fill, rOut - rimWidth / 2, rimWidth, rim, past)
    }

    fun styles(blocks: List<DialFaceBlock>, nowMin: Double, projectedDay: Boolean): List<DialBlockStyle> =
        blocks.map { style(it, nowMin, projectedDay) }

    /** How many blocks have ended by [nowMin]: the face's time-dependent part. */
    fun pastBucket(blocks: List<DialFaceBlock>, nowMin: Double): Int = blocks.count { isPast(it, nowMin) }

    /** Radial breathing room between lanes. */
    const val LANE_GAP = 6.0

    /** The radial band one lane occupies (dialLaneBand), rounded as the JS does. */
    fun laneBand(rInner: Double, rOuter: Double, lane: Int = 0, laneCount: Int = 1): Pair<Double, Double> {
        if (laneCount <= 1) return rInner to rOuter
        val span = rOuter - rInner
        val gap = min(LANE_GAP, span / (laneCount * 5.0))
        val depth = (span - gap * (laneCount - 1)) / laneCount
        val base = rInner + lane * (depth + gap)
        return JsNumber.round3(base) to JsNumber.round3(base + depth)
    }
}

/** The lit part of a moon disc (moonPhasePath): the limb and a terminator ellipse. */
data class MoonPhaseGeometry(val radius: Double, val terminatorRx: Double, val limbSweep: Int, val terminatorSweep: Int)

object MoonPhase {
    fun geometry(r: Double, fraction: Double, waxing: Boolean, mirror: Boolean = false): MoonPhaseGeometry {
        val k = max(0.0, min(1.0, fraction))
        val rx = JsNumber.roundHalfAway(r * abs(1 - 2 * k) * 1e3) / 1e3
        val sweep = if (k < 0.5) 0 else 1
        val litRight = waxing == !mirror
        return MoonPhaseGeometry(r, rx, if (litRight) 1 else 0, if (litRight) sweep else 1 - sweep)
    }
}
