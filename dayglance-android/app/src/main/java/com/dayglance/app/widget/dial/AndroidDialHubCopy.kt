package com.dayglance.app.widget.dial

import android.content.Context
import android.icu.text.MeasureFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import android.icu.util.ULocale
import android.text.format.DateFormat
import com.dayglance.app.R
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The hub's words on device: the string resources (translated with the
 * other widgets' strings; the iOS widget's catalog carries the same phrases)
 * and the locale's own clock and duration formats. The clock follows the
 * app's 24-hour setting when the snapshot carries one, as every widget does.
 */
internal class AndroidDialHubCopy(
    private val context: Context,
    private val locale: Locale,
    use24Hour: Boolean,
) : DialHubCopy {

    private val clockFormat: DateTimeFormatter = runCatching {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, if (use24Hour) "Hm" else "hm"), locale)
    }.getOrDefault(DateTimeFormatter.ofPattern(if (use24Hour) "HH:mm" else "h:mm a", locale))

    private val durationFormat: MeasureFormat =
        MeasureFormat.getInstance(ULocale.forLocale(locale), MeasureFormat.FormatWidth.NARROW)

    override fun clock(minutesOfDay: Double): String {
        val day = DialGeometry.DAY_MINUTES.toInt()
        val m = ((minutesOfDay.roundToInt() % day) + day) % day
        return LocalTime.of(m / 60, m % 60).format(clockFormat)
    }

    /** "1h 10m", "45m", "2h": hours and minutes, zero units hidden. */
    override fun duration(minutes: Double): String {
        val total = max(0, minutes.roundToInt())
        val h = total / 60
        val m = total % 60
        val parts = buildList {
            if (h > 0) add(Measure(h, MeasureUnit.HOUR))
            if (m > 0 || h == 0) add(Measure(m, MeasureUnit.MINUTE))
        }
        return durationFormat.formatMeasures(*parts.toTypedArray())
    }

    override fun until(clock: String) = context.getString(R.string.day_dial_until, clock)
    override fun left(duration: String) = context.getString(R.string.day_dial_left, duration)
    override fun open(duration: String) = context.getString(R.string.day_dial_open, duration)
    override fun untilSleepAt(clock: String) = context.getString(R.string.day_dial_until_sleep_at, clock)
    override fun untilAt(title: String, clock: String) = context.getString(R.string.day_dial_until_at, title, clock)
    override fun nothingElseToday() = context.getString(R.string.day_dial_nothing_else_today)
    override fun thenOpen(duration: String) = context.getString(R.string.day_dial_then_open, duration)
    override fun thenUntilSleep(duration: String) = context.getString(R.string.day_dial_then_until_sleep, duration)
    override fun sleep() = context.getString(R.string.day_dial_sleep)
    override fun outdated() = context.getString(R.string.widget_outdated)
    override fun zoneChanged() = context.getString(R.string.day_dial_zone_changed)
    override fun openToRefresh() = context.getString(R.string.day_dial_open_to_refresh)
    override fun openToSetUp() = context.getString(R.string.day_dial_open_to_set_up)
}
