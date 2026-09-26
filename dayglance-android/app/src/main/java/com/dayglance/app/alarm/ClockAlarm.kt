package com.dayglance.app.alarm

import android.app.AlarmManager
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// ─────────────────────────────────────────────────────────────────────────────
// The next alarm the user set in a CLOCK app — the "when am I waking up?"
// alarm GLANCEahead shows (and, later, the Android Day Dial).
//
// AlarmManager.getNextAlarmClock() (no permission) returns the single next
// alarm-clock alarm of ANY app, calendar apps included: a calendar's event
// reminder scheduled as an alarm clock showed up as the wake-up time. It
// carries no label, so "Wake up" cannot be matched by name; what it does carry
// is the show intent, whose creator says which app set the alarm. Only alarms
// a known clock app created count. A null show intent, or any other app, is no
// alarm.
//
// PACKAGE VISIBILITY (Android 11+): the system names the creator only when
// this app can see it, so the clock packages are declared in the manifest's
// <queries> (keep the two lists in sync). Without them the creator read as
// null and every clock alarm was rejected. The creator's uid is the fallback
// when the package still comes back null.
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
     * or Samsung's is not left with no alarm at all. Mirrored in the
     * manifest's <queries>.
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

    /** Whether any of the creator's candidate packages is a clock app. Pure. */
    fun isClockApp(creatorPackage: String?, uidPackages: List<String>): Boolean =
        isClockApp(creatorPackage) || uidPackages.any { it in CLOCK_PACKAGES }

    /** What the system reported for the next alarm clock, and the verdict. */
    data class Reading(
        val triggerTime: Long?,
        val hasShowIntent: Boolean,
        val creatorPackage: String?,
        val creatorUid: Int?,
        val uidPackages: List<String>,
        val accepted: Boolean,
    )

    fun read(context: Context): Reading {
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        val next = am?.nextAlarmClock
            ?: return Reading(null, false, null, null, emptyList(), false)
        val show = next.showIntent
        val creator = try { show?.creatorPackage } catch (_: Throwable) { null }
        val uid = try { show?.creatorUid } catch (_: Throwable) { null }
        val uidPackages = if (creator == null && uid != null && uid >= 0) {
            try { context.packageManager.getPackagesForUid(uid)?.toList().orEmpty() } catch (_: Throwable) { emptyList() }
        } else emptyList()
        return Reading(
            triggerTime = next.triggerTime,
            hasShowIntent = show != null,
            creatorPackage = creator,
            creatorUid = uid,
            uidPackages = uidPackages,
            accepted = show != null && isClockApp(creator, uidPackages),
        )
    }

    /** Epoch millis of the next clock-app alarm, or null (none, or another app's). */
    fun nextTriggerMillis(context: Context): Long? =
        read(context).let { if (it.accepted) it.triggerTime else null }

    /** TEMPORARY diagnostic (GLANCEahead readout): the reading as JSON. */
    fun debugJson(context: Context): String {
        val r = read(context)
        return JSONObject()
            .put("triggerTime", r.triggerTime ?: JSONObject.NULL)
            .put("hasShowIntent", r.hasShowIntent)
            .put("creatorPackage", r.creatorPackage ?: JSONObject.NULL)
            .put("creatorUid", r.creatorUid ?: JSONObject.NULL)
            .put("uidPackages", JSONArray(r.uidPackages))
            .put("accepted", r.accepted)
            .toString()
    }
}
