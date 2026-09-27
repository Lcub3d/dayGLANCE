package com.dayglance.app.widget.dial

import kotlin.math.max
import kotlin.math.min

// ─────────────────────────────────────────────────────────────────────────────
// Frames on the dial (docs/day-dial-frames-spec.html): each of the day's
// frames drawn as an ENCLOSURE around the span of the block band it covers.
// The port of the iOS DialFrames.swift (dayDial.js's dialFrameRadii,
// dialCurrentFrame, dialFrameAvailableMinutes), held to the same vectors.
// Nesting depth and the Frames percentage are the app's: they arrive in the
// snapshot's `dial.frames[].depth` and `dial.totals.framesPercent`. Pure.
// ─────────────────────────────────────────────────────────────────────────────

/** One frame as the snapshot's `dial.frames[]` carries it. */
data class DialFrame(
    val name: String,
    val colorHex: String?,
    val startMin: Double,
    val endMin: Double,
    /** 0 for a top-level frame; already capped at [DialFrames.MAX_DEPTH]. */
    val depth: Int = 0,
    /** Free time inside the frame, NOT floored at now. */
    val slots: List<Pair<Double, Double>> = emptyList(),
)

data class DialFrameRadii(val inner: Double, val outer: Double, val width: Double)

object DialFrames {
    // Fractions of the block band's width, from the widget spec's 22pt band.
    const val INNER_GAP = 3.0 / 22
    const val OUTER_GAP = 2.0 / 22
    const val STEP = 3.2 / 22
    /** 1.8pt: the spec's 1.2pt read too faint on device. */
    const val STROKE = 1.8 / 22
    const val OPACITY = 0.45
    /** One level of nesting is drawn; a second step would cross the wedges. */
    const val MAX_DEPTH = 1
    /** Shorter frames are not drawn as an enclosure (the hub still sees them). */
    const val MIN_MINUTES = 10.0
    // The softened mute (DIAL_FRAME_MUTE).
    const val SATURATION_CAP = 0.28
    const val LIGHTNESS = 0.62

    /** dialFrameRadii. */
    fun radii(bandInner: Double, bandOuter: Double, depth: Int): DialFrameRadii {
        val w = bandOuter - bandInner
        val d = max(0, min(MAX_DEPTH, depth)).toDouble()
        return DialFrameRadii(
            inner = bandInner - INNER_GAP * w + d * STEP * w,
            outer = bandOuter + OUTER_GAP * w - d * STEP * w,
            width = STROKE * w,
        )
    }

    /** The widget's own band. */
    fun radii(depth: Int): DialFrameRadii = radii(DialSpec.BLOCK_INNER_RADIUS, DialSpec.BLOCK_OUTER_RADIUS, depth)

    fun drawn(frame: DialFrame): Boolean = frame.endMin - frame.startMin >= MIN_MINUTES

    /** dialCurrentFrame: the innermost frame [nowMin] is inside, or null. */
    fun current(frames: List<DialFrame>, nowMin: Double): DialFrame? {
        var pick: DialFrame? = null
        for (f in frames) {
            if (f.startMin <= nowMin && nowMin < f.endMin) {
                val p = pick
                if (p == null || f.depth > p.depth || (f.depth == p.depth && f.startMin >= p.startMin)) pick = f
            }
        }
        return pick
    }

    /** dialFrameAvailableMinutes: each slot from the later of its start and now. */
    fun availableMinutes(frame: DialFrame, nowMin: Double): Double =
        frame.slots.sumOf { (s, e) -> max(0.0, e - max(s, nowMin)) }
}
