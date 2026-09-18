package com.dayglance.app.widget

import android.content.Context
import android.text.format.DateFormat
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Date
import java.util.Locale

/**
 * Whether the stored widget snapshot still describes the current local day.
 *
 * The only writer of task content is the WebView effect in App.jsx, and a
 * backgrounded app never re-runs it. So a phone left alone across midnight
 * wakes up with every widget holding yesterday's agenda. Nothing can refresh
 * that content from here (see docs/widget-background-refresh-plan.md); what
 * the widgets CAN do is stop presenting it as current. This is the one place
 * that decides, so all four widgets and the list factory agree, and the Day
 * Dial widget inherits it.
 *
 * "Stale" is a calendar-day fact, not an age: a snapshot from 23:50 is fresh
 * at 23:59 and stale at 00:00. The two-hour-old snapshot is the normal case
 * while the app is open in the background and is not stale.
 *
 * [WidgetFreshnessRules] is pure (no Android types) and unit-tested; the
 * Context-taking functions below only read the store and format the label.
 */
data class WidgetFreshness(
    /** The snapshot's day differs from the current local day. */
    val isStale: Boolean,
    /** Whole local days from the snapshot's day to today. 0 when fresh; can be
     *  negative when the clock moved back (travel west across midnight). */
    val daysOld: Int,
    /** The day the snapshot describes, or null when it did not say. */
    val snapshotDate: LocalDate?,
    /** Epoch ms when the content was captured, or 0 when unknown. */
    val capturedAtMs: Long,
) {
    companion object {
        /** A snapshot that did not say what day it is — never flagged. */
        val UNKNOWN = WidgetFreshness(isStale = false, daysOld = 0, snapshotDate = null, capturedAtMs = 0L)
    }
}

object WidgetFreshnessRules {
    /**
     * @param snapshotDate the snapshot's "date" field, "yyyy-MM-dd" in local time
     *                     as App.jsx writes it (dateToString), or null/blank.
     * @param capturedAtMs when the content was captured; 0 when unknown.
     * @param today        the current LOCAL day.
     */
    fun evaluate(snapshotDate: String?, capturedAtMs: Long, today: LocalDate): WidgetFreshness {
        val day = parseDay(snapshotDate) ?: return WidgetFreshness.UNKNOWN.copy(capturedAtMs = capturedAtMs)
        val days = ChronoUnit.DAYS.between(day, today).toInt()
        return WidgetFreshness(
            isStale = days != 0,
            daysOld = days,
            snapshotDate = day,
            capturedAtMs = capturedAtMs,
        )
    }

    /** Strict "yyyy-MM-dd"; anything else is "did not say" rather than an error. */
    fun parseDay(value: String?): LocalDate? {
        if (value.isNullOrBlank()) return null
        return try { LocalDate.parse(value.trim()) } catch (_: DateTimeParseException) { null }
    }
}

/**
 * What [WidgetUpdateWorker] may do to the stored snapshot on a background run.
 * Pure, so the rule is testable without a Context or org.json.
 */
enum class SnapshotPatchDecision {
    /** Nothing stored yet: build the calendar-only snapshot and stamp it — that
     *  content IS regenerated, so today's date and a fresh timestamp are true. */
    CREATE,
    /** The stored snapshot is today's: refresh the native-owned fields (steps,
     *  device calendar) in place. Its date, label and capture time are the JS
     *  content's and stay as they are. */
    PATCH_NATIVE_FIELDS,
    /** The stored snapshot is another day's: leave it alone. Restamping it
     *  would present yesterday's agenda under today's date, and patching
     *  today's calendar into it would blend two days. A stale snapshot has to
     *  look stale. */
    LEAVE_UNTOUCHED,
}

object WidgetSnapshotPatchPolicy {
    fun decide(existingSnapshotDate: String?, hasExisting: Boolean, today: LocalDate): SnapshotPatchDecision {
        if (!hasExisting) return SnapshotPatchDecision.CREATE
        val day = WidgetFreshnessRules.parseDay(existingSnapshotDate)
        // A snapshot with no date predates the field: it cannot be proven stale,
        // and stamping a date onto it now would be inventing one. Patch native
        // fields only, exactly as for a same-day snapshot.
        if (day == null || day == today) return SnapshotPatchDecision.PATCH_NATIVE_FIELDS
        return SnapshotPatchDecision.LEAVE_UNTOUCHED
    }
}

/** Freshness of the stored snapshot as the widgets read it. */
internal fun snapshotFreshness(
    snapshot: JSONObject?,
    dataStore: SharedDataStore,
    today: LocalDate = LocalDate.now(),
): WidgetFreshness {
    if (snapshot == null) return WidgetFreshness.UNKNOWN
    // The store's timestamp is written by NativeBridge.updateWidgetSnapshot at
    // push time; the snapshot's own updatedAt is the JS clock at build time.
    // Same moment to within a bridge call; prefer the store, fall back to JSON.
    val captured = dataStore.widgetSnapshotUpdatedAt.takeIf { it > 0L }
        ?: snapshot.optLong("updatedAt", 0L)
    return WidgetFreshnessRules.evaluate(snapshot.optString("date", ""), captured, today)
}

/** Alpha applied to a stale widget's content so it reads as inactive before any text is parsed. */
internal const val STALE_CONTENT_ALPHA = 0.45f

/**
 * "Outdated · as of Thu, Sep 17, 8:42 PM", plus "· 3 days old" from two days
 * on, so a phone left over a weekend never reads as "Thu" alone. Absolute on
 * purpose: "2 hours ago" invites misreading and breaks down past a day. The
 * pattern comes from the locale's own skeleton, so day/month order and the
 * 12/24-hour clock follow the device, with the snapshot's clock preference
 * winning when it carries one.
 */
internal fun formatStaleLabel(context: Context, freshness: WidgetFreshness, use24Hour: Boolean): String {
    val locale = context.resources.configuration.locales.let { if (it.isEmpty) Locale.getDefault() else it[0] }
    val parts = mutableListOf(context.getString(R.string.widget_outdated))
    if (freshness.capturedAtMs > 0L) {
        val skeleton = if (use24Hour) "EEEMMMdHm" else "EEEMMMdhm"
        val pattern = DateFormat.getBestDateTimePattern(locale, skeleton)
        val stamp = SimpleDateFormat(pattern, locale).format(Date(freshness.capturedAtMs))
        parts += context.getString(R.string.widget_as_of, stamp)
    } else if (freshness.snapshotDate != null) {
        parts += context.getString(R.string.widget_as_of, formatWidgetDate(context, freshness.snapshotDate))
    }
    if (freshness.daysOld >= 2) {
        parts += context.resources.getQuantityString(R.plurals.widget_days_old, freshness.daysOld, freshness.daysOld)
    }
    return parts.joinToString("  ·  ")
}

/**
 * The one flag the native side reads off a pushed snapshot BEFORE storing it
 * as-is: whether this push should redraw the widgets. The JS dedupe sets it
 * false when nothing the widgets currently show has changed (a day beyond
 * tomorrow in the day-keyed payload); see utils/widgetSnapshotDedupe.js.
 *
 * A key match on the raw text rather than a full parse: the payload is tens
 * of kilobytes and is parsed again by every widget that renders, so this path
 * stays O(1)-ish, and the key name exists nowhere else in the snapshot.
 * Absent or unparseable → true, so an older web bundle keeps its old
 * behaviour and a malformed flag can never suppress a redraw.
 */
object WidgetSnapshotEnvelope {
    private val RELOAD_FALSE = Regex("\"reloadWidgets\"\\s*:\\s*false")

    fun wantsReload(snapshotJson: String?): Boolean =
        snapshotJson == null || !RELOAD_FALSE.containsMatchIn(snapshotJson)
}
