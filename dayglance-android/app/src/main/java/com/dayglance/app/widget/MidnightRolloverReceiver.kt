package com.dayglance.app.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Fires once at the next local midnight and re-renders every widget, so the
 * day boundary is punctual instead of waiting for the next
 * [WidgetUpdateWorker] run (15 minutes nominal; an hour or more inside Doze
 * maintenance windows on an untouched phone).
 *
 * It changes no data. Each widget re-reads the stored snapshot and resolves
 * the current local day against it (WidgetFreshness.kt): the pushed day, a
 * projected day from the day-keyed payload, or the stale state. This alarm is
 * what makes that resolution happen AT 00:00.
 *
 * Armed from every place the stored snapshot or the clock changes:
 * NativeBridge.updateWidgetSnapshot (each push), WidgetUpdateWorker (15-minute
 * backstop, which also covers process death and OEM battery killers),
 * TimeChangeReceiver (timezone or clock change moves midnight) and the
 * BOOT_COMPLETED handler in ReminderReceiver (alarms do not survive a reboot).
 * Re-arms itself on each fire. Arming is idempotent: one PendingIntent, so a
 * new call replaces the previous alarm.
 *
 * Exactness degrades rather than failing: SCHEDULE_EXACT_ALARM is user-
 * revocable on Android 12+ (Settings ▸ Alarms & reminders), so
 * [AlarmManager.canScheduleExactAlarms] is checked AT ARM TIME, every time,
 * never assumed from install. Denied → setAndAllowWhileIdle, up to ~9 minutes
 * late in Doze, which is imperceptible for a day boundary. Nothing here
 * prompts for the permission; the reminders flow already owns that ask.
 */
class MidnightRolloverReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        // Re-arm FIRST, so a throw in the widget refresh can never leave the
        // chain dead until the next push.
        runCatching { arm(context) }
        runCatching { DayGlanceWidget.requestUpdate(context) }
        runCatching { UpNextWidget.requestUpdate(context) }
        runCatching { GoalWidget.requestUpdate(context) }
        runCatching { ProjectWidget.requestUpdate(context) }
        runCatching { MonthGridWidget.requestUpdate(context) }
        // The month + agenda widget's paged-to day resets to today at 00:00
        // (MonthDaySelection.resolve also reads yesterday's pick as today, so
        // a late or missed alarm still resets on the next render).
        runCatching { MonthAgendaSelectionStore.clearAll(context) }
        runCatching { MonthAgendaWidget.requestUpdate(context) }
        runCatching { com.dayglance.app.widget.dial.DayDialWidget.requestUpdate(context) }
    }

    companion object {
        const val ACTION = "com.dayglance.app.widget.MIDNIGHT_ROLLOVER"
        private const val REQUEST_CODE = 4200

        /** Seconds past 00:00:00 to fire — clear of the boundary, so LocalDate.now()
         *  in the widgets is unambiguously the new day even with clock jitter. */
        internal const val FIRE_OFFSET_SECONDS = 5L

        /**
         * Epoch millis of the next local midnight (plus [FIRE_OFFSET_SECONDS])
         * after [now] in [zone]. Pure, so it is unit-tested across a DST change:
         * built from the local date, never by adding 24h.
         */
        fun nextFireMillis(now: ZonedDateTime, zone: ZoneId = now.zone): Long {
            val nextDay: LocalDate = now.toLocalDate().plusDays(1)
            return nextDay.atTime(LocalTime.MIDNIGHT).atZone(zone)
                .plusSeconds(FIRE_OFFSET_SECONDS)
                .toInstant().toEpochMilli()
        }

        /** Whether an exact alarm may be set right now. Pure over its inputs. */
        fun useExact(sdkInt: Int, canScheduleExactAlarms: () -> Boolean): Boolean =
            sdkInt < Build.VERSION_CODES.S || canScheduleExactAlarms()

        /** (Re)arms the alarm for the next local midnight. Safe to call often. */
        fun arm(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val at = nextFireMillis(ZonedDateTime.now())
            val pi = pendingIntent(context)
            val exact = useExact(Build.VERSION.SDK_INT) {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()
            }
            if (exact) {
                try {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                    return
                } catch (_: SecurityException) {
                    // Revoked between the check and the call: fall through.
                }
            }
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }

        private fun pendingIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context, REQUEST_CODE,
                Intent(context, MidnightRolloverReceiver::class.java).apply { action = ACTION },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }
}
