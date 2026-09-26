package com.dayglance.app.widget.dial

import org.json.JSONObject
import java.security.MessageDigest
import kotlin.math.max

// ─────────────────────────────────────────────────────────────────────────────
// What the face draws, resolved from one day of the snapshot (`dial` + `sky`,
// of the pushed day or a projected `days[]` entry): the port of the iOS
// DialFaceInput.swift. The face is keyed from THIS rather than the raw JSON,
// so a push that only changed goals or Up Next does not redraw it. Pure.
// ─────────────────────────────────────────────────────────────────────────────

data class DialMoonGlyph(val fraction: Double, val waxing: Boolean, val minutes: Double, val mirror: Boolean = false)

data class DialFaceInput(
    val blocks: List<DialFaceBlock>,
    /** Empty when the snapshot has no sky: the ring is drawn unlit, no glyphs. */
    val sky: List<DialSpec.SkySegment> = emptyList(),
    val sunriseMin: Double? = null,
    val sunsetMin: Double? = null,
    val moon: DialMoonGlyph? = null,
    /** A projected day: completion flags are not information. */
    val projectedDay: Boolean = false,
) {
    /**
     * Canonical text of everything the FACE's ring draws. Titles, tags and
     * true ends are the hub's and stay out, as on iOS.
     */
    val seed: String
        get() = buildList {
            add("tier=${if (projectedDay) "projected" else "pushed"}")
            for (b in blocks) {
                add("b:${b.id}|${b.kind}|${b.startMin}|${b.endMin}|${b.endsNextDay.bit()}${b.startedPrevDay.bit()}" +
                    "${b.completed.bit()}|${b.colorHex ?: "-"}|${b.lane}/${b.laneCount}")
            }
            for (s in sky) add("s:${s.hour}|${s.body}|${s.strength}")
            add("rise=${sunriseMin ?: "-"}|set=${sunsetMin ?: "-"}")
            moon?.let { add("moon=${it.fraction}|${it.waxing.bit()}|${it.minutes}|${if (it.mirror) "s" else "n"}") }
        }.joinToString("\n")

    companion object {
        private fun Boolean.bit() = if (this) 1 else 0

        /** From one day's fields (`dial`, `sky`); null fields draw an empty day. */
        fun from(fields: JSONObject?, projectedDay: Boolean): DialFaceInput {
            val blocks = ArrayList<DialFaceBlock>()
            val arr = fields?.optJSONObject("dial")?.optJSONArray("blocks")
            for (i in 0 until (arr?.length() ?: 0)) {
                val b = arr?.optJSONObject(i) ?: continue
                val start = b.optDouble("startMin", 0.0).let { if (it.isNaN()) 0.0 else it }
                val duration = b.optDouble("durationMin", 0.0).let { if (it.isNaN()) 0.0 else it }
                if (duration <= 0) continue
                val kind = DialBlockKind.of(b.str("type"))
                blocks += DialFaceBlock(
                    id = b.str("id") ?: "${kind.name.lowercase()}-${start.toInt()}",
                    kind = kind,
                    startMin = start,
                    endMin = start + duration,
                    endsNextDay = b.optBoolean("endsNextDay", false),
                    startedPrevDay = b.optBoolean("startedPrevDay", false),
                    completed = b.optBoolean("completed", false),
                    colorHex = b.str("colorHex"),
                    lane = b.optInt("lane", 0),
                    laneCount = max(1, b.optInt("laneCount", 1)),
                    endMinTrue = if (b.has("endMinTrue") && !b.isNull("endMinTrue")) b.optDouble("endMinTrue") else null,
                    title = b.str("title"),
                    tag = b.str("tag"),
                )
            }
            val sky = fields?.optJSONObject("sky")
            var segments = emptyList<DialSpec.SkySegment>()
            var moon: DialMoonGlyph? = null
            val hours = sky?.optJSONArray("hours")
            if (hours != null && hours.length() > 0) {
                segments = DialSpec.skySegments((0 until hours.length()).map { i ->
                    val h = hours.optJSONObject(i)
                    h.num("sun") to h.num("moon")
                })
                val m = sky.optJSONObject("moon")
                val glyphMin = m?.num("glyphMin")
                if (m != null && glyphMin != null) {
                    moon = DialMoonGlyph(m.num("fraction") ?: 0.0, if (m.has("waxing") && !m.isNull("waxing")) m.optBoolean("waxing") else true,
                        glyphMin, sky.optBoolean("southern", false))
                }
            }
            return DialFaceInput(blocks, segments, sky?.num("sunriseMin"), sky?.num("sunsetMin"), moon, projectedDay)
        }

        /** The gallery / never-opened face: a plausible summer sky, no blocks. */
        val PLACEHOLDER: DialFaceInput by lazy {
            val sun = listOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1852, 0.3867, 0.5712, 0.7303, 0.8571, 0.9459,
                0.9929, 0.9958, 0.9547, 0.8712, 0.7492, 0.594, 0.4125, 0.2127, 0.0035, 0.0, 0.0, 0.0)
            val moon = listOf(0.433, 0.4924, 0.4924, 0.433, 0.3214, 0.171, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.171, 0.3214)
            DialFaceInput(
                blocks = emptyList(),
                sky = DialSpec.skySegments(sun.zip(moon).map { (s, m) -> s to m }),
                sunriseMin = 5.0 * 60 + 37, sunsetMin = 20.0 * 60 + 31,
                moon = DialMoonGlyph(0.5, true, 120.0),
            )
        }

        /** A string field, or null when absent, JSON null or empty. org.json
         *  returns the text "null" for an explicit null, hence the check. */
        internal fun JSONObject.str(key: String): String? =
            if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

        internal fun JSONObject?.num(key: String): Double? {
            if (this == null || !has(key) || isNull(key)) return null
            return optDouble(key).takeIf { !it.isNaN() }
        }

        /** Short stable hex digest, for naming a face. */
        fun digest(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).take(10).joinToString("") { "%02x".format(it) }
    }
}
