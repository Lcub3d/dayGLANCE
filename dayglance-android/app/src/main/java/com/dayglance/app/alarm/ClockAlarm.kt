package com.dayglance.app.alarm

import android.app.AlarmManager
import android.content.Context

// ─────────────────────────────────────────────────────────────────────────────
// The next alarm the user set in a CLOCK app — the "when am I waking up?"
// alarm GLANCEahead shows (and, later, the Android Day Dial).
//
// AlarmManager.getNextAlarmClock() (no permission) returns the single next
// alarm-clock alarm of ANY app, calendar apps included: a calendar's event
// reminder scheduled as an alarm clock showed up as the wake-up time. It
// carries no label, so "Wake up" cannot be matched by name; what it does carry
// is the show intent, whose creator package says which app set the alarm.
// Only alarms a known clock app created count. A null show intent, or any
// other app, is no alarm.
//
// The API gives only ONE alarm: when a calendar or other app's alarm comes
// first, the wake alarm behind it is hidden until that one fires. Showing
// nothing then is the accepted failure (design session, Sep 24).
// ─────────────────────────────────────────────────────────────────────────────

object ClockAlarm {
    /**
     * Clock apps whose alarms count, by package. Google Clock and Samsung
     * Clock (the two the design names), AOSP's (also Xiaomi/MIUI), and the
     * other large OEMs' system clocks, so a phone whose clock is not Google's
     * or Samsung's is not left with no alarm at all.
     */
    val CLOCK_PACKAGES: Set<String> = setOf(
        "com.google.android.deskclock",      // Google Clock (Pixel, Motorola, most stock Android)
        "com.sec.android.app.clockpackage",  // Samsung Clock
        "com.android.deskclock",             // AOSP Clock, Xiaomi/MIUI
        "com.oneplus.deskclock",             // OnePlus (OxygenOS, older)
        "com.coloros.alarmclock",            // OPPO / realme / OnePlus (ColorOS)
        "com.huawei.deskclock",              // Huawei (EMUI)
        "com.hihonor.deskclock",             // Honor
    )

    /** Whether an alarm created by [creatorPackage] is a clock-app alarm. Pure. */
    fun isClockApp(creatorPackage: String?): Boolean =
        creatorPackage != null && creatorPackage in CLOCK_PACKAGES

    /** Epoch millis of the next clock-app alarm, or null (none, or another app's). */
    fun nextTriggerMillis(context: Context): Long? {
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return null
        val next = am.nextAlarmClock ?: return null
        val creator = try { next.showIntent?.creatorPackage } catch (_: Throwable) { null }
        return if (isClockApp(creator)) next.triggerTime else null
    }
}
