package com.dayglance.app.widget.dial

import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

// ─────────────────────────────────────────────────────────────────────────────
// The next clock-app alarm on the home-screen dial: the port of
// dialAlarmMark (src/utils/nextAlarm.js), held to the same cases
// (DialAlarmTest.kt mirrors nextAlarm.test.js). Tomorrow's alarm stands at 00
// with its time beside the "00" label, from the user's chosen time of day on;
// after midnight it moves to its real minute until it rings. The alarm itself
// is read natively (ClockAlarm, clock apps only); the prefs come from the
// app through the widget snapshot's `dialAlarm`. Pure.
// ─────────────────────────────────────────────────────────────────────────────

enum class DialAlarmMode { TOMORROW, TODAY }

data class DialAlarmMark(
    val mode: DialAlarmMode,
    /** Where the line goes: 0 for tomorrow, the alarm's minute today. */
    val minute: Double,
    /** The alarm's own minute of day, for its time label. */
    val alarmMinute: Double,
)

data class DialAlarmPrefs(val on: Boolean = true, val fromMin: Int = 18 * 60) {
    companion object {
        /** From the snapshot; absent (an app build before the prefs) is the app's default. */
        fun from(root: JSONObject?): DialAlarmPrefs {
            val p = root?.optJSONObject("dialAlarm") ?: return DialAlarmPrefs()
            val from = p.optInt("fromMin", 18 * 60)
            return DialAlarmPrefs(p.optBoolean("on", true), if (from in 0 until 1440) from else 18 * 60)
        }
    }
}

object DialAlarm {
    const val COLOR_HEX = "#38bdf8"

    fun mark(nowMs: Long, alarmMs: Long?, fromMin: Int, zone: ZoneId): DialAlarmMark? {
        if (alarmMs == null || alarmMs <= nowMs) return null
        val now = Instant.ofEpochMilli(nowMs).atZone(zone)
        val alarm = Instant.ofEpochMilli(alarmMs).atZone(zone)
        val alarmMin = alarm.hour * 60.0 + alarm.minute
        return when (alarm.toLocalDate()) {
            now.toLocalDate() -> DialAlarmMark(DialAlarmMode.TODAY, alarmMin, alarmMin)
            now.toLocalDate().plusDays(1) ->
                if (now.hour * 60 + now.minute >= fromMin) DialAlarmMark(DialAlarmMode.TOMORROW, 0.0, alarmMin) else null
            else -> null
        }
    }

    /** An hour label gives way to the mark once it stands at its real time (in the labels' band). */
    fun labelYields(labelMin: Int, mark: DialAlarmMark?): Boolean {
        if (mark == null || mark.mode != DialAlarmMode.TODAY) return false
        val d = Math.abs(mark.minute - labelMin) % DialGeometry.DAY_MINUTES
        return minOf(d, DialGeometry.DAY_MINUTES - d) < LABEL_CLEARANCE_MIN
    }

    /** SUN_LABEL_CLEARANCE_MIN in dayDial.js. */
    const val LABEL_CLEARANCE_MIN = 30.0

    // Radii on the widget's canvas: the line crosses the block band and the
    // ticks; today's glyph stands just past the ticks, in the labels' band.
    const val LINE_INNER_RADIUS = 124.0
    const val LINE_OUTER_RADIUS = 168.0
    const val GLYPH_RADIUS = 177.0
}
