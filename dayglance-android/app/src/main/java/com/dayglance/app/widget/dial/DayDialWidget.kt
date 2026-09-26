package com.dayglance.app.widget.dial

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.RemoteViews
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import com.dayglance.app.widget.MidnightRolloverReceiver
import com.dayglance.app.widget.WidgetDayTier
import com.dayglance.app.widget.WidgetLinks
import com.dayglance.app.widget.WidgetUpdateWorker
import com.dayglance.app.widget.exactWidgetSizes
import com.dayglance.app.widget.formatPlannedLabel
import com.dayglance.app.widget.formatStaleDetail
import com.dayglance.app.widget.resolveWidgetDay
import com.dayglance.app.widget.widgetLocale
import com.dayglance.app.widget.widgetUses24HourClock
import org.json.JSONObject
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import kotlin.math.max
import kotlin.math.min

/**
 * The Day Dial home-screen widget: the Android port of the iOS DayDialWidget
 * (dayglance-ios/DayGlanceWidget/Dial), drawing the same face from the same
 * snapshot fields (`dial`, `sky`, `days[]`, `timezone`).
 *
 * HOW IT MOVES. iOS hands WidgetKit a timeline of prerendered entries; Android
 * has no timeline, so the widget keeps its own minute tick ([DayDialTicker]):
 * a NON-wakeup alarm at each minute boundary, which fires while the screen is
 * on and waits while the device sleeps, catching up the moment it wakes. Each
 * tick recomputes the render and compares its FACE KEY with the one the
 * widget last drew:
 *
 *   - same key (the usual minute): a partial update carrying the needle's
 *     level (one int; the <rotate> drawable turns) and the live row's strip;
 *   - new key (a block started or ended, the day changed, a push changed
 *     the day, a resize): a full update with a freshly drawn face.
 *
 * The key covers everything baked into the face: the ring's input (block
 * spans, states, sky), how many blocks have ended, the hub's static rows,
 * the size, and a salt of the boot count and install time, because the
 * system forgets widget views across a reboot and an app update and a
 * partial update onto nothing draws nothing. The device test of the spike
 * (#1818) measured this design: a ~9 MB face on a tablet delivered cleanly,
 * the level-driven needle landed on the drawn minute, and a night of ticks
 * cost no measurable battery.
 *
 * Every other refresh path is shared with the other widgets: each push
 * (NativeBridge.updateWidgetSnapshot), [MidnightRolloverReceiver],
 * [WidgetUpdateWorker] and TimeChangeReceiver call [requestUpdate].
 */
class DayDialWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        DayDialRenderer.render(context, appWidgetManager, appWidgetIds)
        DayDialTicker.arm(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
        DayDialRenderer.render(context, appWidgetManager, intArrayOf(appWidgetId))
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        runCatching { WidgetUpdateWorker.schedule(context) }
        runCatching { MidnightRolloverReceiver.arm(context) }
        DayDialTicker.arm(context)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        DayDialRenderer.forget(context, appWidgetIds)
    }

    override fun onDisabled(context: Context) {
        DayDialTicker.cancel(context)
        DayDialRenderer.forgetAll(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == DayDialTicker.ACTION_TICK) {
            // Re-arm first, so a throw in the render cannot end the chain.
            DayDialTicker.arm(context)
            // The CPU can be awake with the screen off (music, a sync): the
            // alarm fires then too, and nobody can see the dial. Skip the
            // draw; the first tick after the screen comes on catches up.
            val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (power?.isInteractive == false) return
            val manager = AppWidgetManager.getInstance(context)
            DayDialRenderer.render(context, manager, ids(context, manager))
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        internal fun ids(context: Context, manager: AppWidgetManager): IntArray =
            runCatching { manager.getAppWidgetIds(ComponentName(context, DayDialWidget::class.java)) }.getOrDefault(IntArray(0))

        /**
         * Redraws every dial in full, whatever it last drew: after a reboot the
         * system has forgotten the views, and a partial update onto nothing
         * draws nothing. The face key's salt covers this where the device
         * reports a boot count; this covers it everywhere.
         */
        fun requestRedraw(context: Context) {
            DayDialRenderer.forgetAll(context)
            requestUpdate(context)
        }

        /** Re-renders every placed Day Dial from the stored snapshot. */
        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = ids(context, manager)
                if (ids.isEmpty()) return
                context.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, DayDialWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                })
            } catch (_: Throwable) { }
        }
    }
}

/**
 * The minute tick: one alarm for every placed dial, at the next minute
 * boundary. RTC, not RTC_WAKEUP — a dial nobody can see is not worth waking
 * the device for. Exact when the app may set exact alarms; otherwise a window,
 * which Android 12+ widens to about ten minutes, so the needle and the live
 * row can lag by that much without the grant (the rest of the face does not
 * depend on the tick: pushes, midnight and the worker redraw it).
 */
object DayDialTicker {
    const val ACTION_TICK = "com.dayglance.app.widget.dial.TICK"
    private const val REQUEST_CODE = 4400

    /** The next minute boundary after [nowMs], plus a second of clearance. Pure. */
    fun nextTickMillis(nowMs: Long): Long = (nowMs / 60_000L + 1) * 60_000L + 1_000L

    fun arm(context: Context) {
        try {
            val manager = AppWidgetManager.getInstance(context)
            if (DayDialWidget.ids(context, manager).isEmpty()) { cancel(context); return }
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val at = nextTickMillis(System.currentTimeMillis())
            val pi = pendingIntent(context)
            val exact = MidnightRolloverReceiver.useExact(Build.VERSION.SDK_INT) {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()
            }
            if (exact) {
                try {
                    am.setExact(AlarmManager.RTC, at, pi)
                    return
                } catch (_: SecurityException) { }
            }
            am.setWindow(AlarmManager.RTC, at, 60_000L, pi)
        } catch (_: Throwable) { }
    }

    fun cancel(context: Context) {
        runCatching { (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pendingIntent(context)) }
    }

    private fun pendingIntent(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context, REQUEST_CODE,
            Intent(ACTION_TICK).setComponent(ComponentName(context, DayDialWidget::class.java)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}

/** Builds and sends the RemoteViews; decides full versus partial per widget. */
internal object DayDialRenderer {
    private const val PREFS = "day_dial_widget"
    private const val REQUEST_OPEN = 4401

    private val LIVE_SLOT_VIEWS = mapOf(
        DialLiveSlot.TITLE to R.id.iv_day_dial_live_title,
        DialLiveSlot.ROW1 to R.id.iv_day_dial_live_row1,
        DialLiveSlot.ROW2 to R.id.iv_day_dial_live_row2,
    )

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
        if (ids.isEmpty()) return
        val frame = try { DayDialFrame.build(context, ZonedDateTime.now()) } catch (_: Throwable) { return }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val salt = salt(context)
        for (id in ids) {
            try {
                val options = runCatching { manager.getAppWidgetOptions(id) }.getOrDefault(Bundle())
                val (wDp, hDp) = placementSizeDp(context, options)
                // Inside the root's 4dp padding.
                val arrangement = DialArrangement.choose(wDp - 8.0, hDp - 8.0, frame.cards)
                val scale = faceScale(context, arrangement)
                val key = DialFaceInput.digest("${frame.faceKey}\n$arrangement\nscale=$scale\nsalt=$salt")
                if (prefs.getString(keyPref(id), null) == key) {
                    partial(context, manager, id, frame, arrangement, scale)
                } else {
                    full(context, manager, id, frame, arrangement, scale)
                    prefs.edit().putString(keyPref(id), key).apply()
                }
            } catch (_: Throwable) {
                // A failed full update must not leave a key that claims it drew.
                prefs.edit().remove(keyPref(id)).apply()
            }
        }
    }

    fun forget(context: Context, ids: IntArray) {
        val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        ids.forEach { edit.remove(keyPref(it)) }
        edit.apply()
    }

    fun forgetAll(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun keyPref(id: Int) = "face_$id"

    private fun layoutFor(arrangement: DialArrangement) = when (arrangement.placement) {
        DialPlacement.DIAL -> R.layout.widget_day_dial
        DialPlacement.TALL -> R.layout.widget_day_dial_tall
        DialPlacement.WIDE -> R.layout.widget_day_dial_wide
    }

    private fun full(context: Context, manager: AppWidgetManager, id: Int, frame: DayDialFrame,
                     arrangement: DialArrangement, scale: Float) {
        val views = RemoteViews(context.packageName, layoutFor(arrangement))
        views.setImageViewBitmap(R.id.iv_day_dial_face,
            frame.painter.drawFace(scale, frame.input, frame.nowMin, frame.header, frame.rows, frame.dimmed))
        views.setInt(R.id.iv_day_dial_needle, "setImageLevel", frame.needleLevel)
        for ((slot, viewId) in LIVE_SLOT_VIEWS) {
            views.setViewVisibility(viewId, if (slot == frame.rows.liveSlot) View.VISIBLE else View.GONE)
        }
        bindLive(views, frame, scale)
        DayDialCardsBinder.bind(views, arrangement, frame.cards, frame.copy)
        views.setContentDescription(R.id.day_dial_root, frame.summary)
        views.setOnClickPendingIntent(R.id.day_dial_root, WidgetLinks.pendingIntent(context, REQUEST_OPEN, frame.tapUrl))
        manager.updateAppWidget(id, views)
    }

    private fun partial(context: Context, manager: AppWidgetManager, id: Int, frame: DayDialFrame,
                        arrangement: DialArrangement, scale: Float) {
        val views = RemoteViews(context.packageName, layoutFor(arrangement))
        views.setInt(R.id.iv_day_dial_needle, "setImageLevel", frame.needleLevel)
        bindLive(views, frame, scale)
        views.setContentDescription(R.id.day_dial_root, frame.summary)
        manager.partiallyUpdateAppWidget(id, views)
    }

    private fun bindLive(views: RemoteViews, frame: DayDialFrame, scale: Float) {
        val slot = frame.rows.liveSlot ?: return
        val row = frame.rows.liveRow ?: return
        val viewId = LIVE_SLOT_VIEWS[slot] ?: return
        views.setImageViewBitmap(viewId, frame.painter.drawLiveStrip(scale, slot, row))
    }

    /**
     * The widget's size in dp as the host shows it NOW: the portrait size in
     * portrait, the landscape one in landscape (a phone widget has both, and
     * the arrangement differs: cards below in portrait, beside in landscape).
     * A rotation is picked up by the next minute's tick, whose key includes
     * the arrangement. Android 12+ lists the exact sizes; below that the
     * options' min/max pairs are portrait (min width × max height) and
     * landscape (max width × min height), as the other widgets read them.
     */
    private fun placementSizeDp(context: Context, options: Bundle): Pair<Double, Double> {
        val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val sizes = exactWidgetSizes(options)
        if (sizes.isNotEmpty()) {
            val s = if (landscape) sizes.maxByOrNull { it.width / it.height }!! else sizes.maxByOrNull { it.height / it.width }!!
            return s.width.toDouble() to s.height.toDouble()
        }
        val minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val maxW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0)
        val minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
        val maxH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
        val (w, h) = if (landscape) maxW to minH else minW to maxH
        return (if (w > 0) w.toDouble() else 300.0) to (if (h > 0) h.toDouble() else 315.0)
    }

    /**
     * Pixels per spec point for the box the arrangement leaves the dial. At a
     * full tablet screen that is ~9 MB, which the spike delivered cleanly.
     */
    private fun faceScale(context: Context, arrangement: DialArrangement): Float {
        val density = context.resources.displayMetrics.density
        val scale = min(arrangement.dialWidthDp / DialSpec.CANVAS_WIDTH, arrangement.dialHeightDp / DialSpec.CANVAS_HEIGHT).toFloat() * density
        // Rounded so a size report jittering by a pixel does not redraw the face.
        return max(0.5f, (scale * 8).toInt() / 8f)
    }

    /** What makes the system forget a widget's views: a reboot, an app update. */
    private fun salt(context: Context): String {
        val boot = runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrDefault(-1)
        val installed = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime }.getOrDefault(0L)
        return "$boot/$installed"
    }
}

/** One minute's render, shared by every placed dial. */
internal class DayDialFrame(
    val input: DialFaceInput,
    val nowMin: Double,
    val header: DialHubHeader,
    val rows: DialHubRows,
    val dimmed: Boolean,
    val tapUrl: String,
    val summary: String,
    val painter: DialFacePainter,
    val cards: DialCards,
    val copy: DialHubCopy,
) {
    /** 0 at midnight, 10000 a full turn (day_dial_needle.xml). */
    val needleLevel: Int get() = DialNeedle.level(nowMin)

    val faceKey: String
        get() = listOf(
            input.seed,
            "past=${DialBand.pastBucket(input.blocks, nowMin)}",
            "hdr=${header.eyebrow}|${header.date}",
            rows.staticKey,
            "live=${rows.liveSlot}",
            "dim=$dimmed",
            cards.key,
        ).joinToString("\n")

    companion object {
        fun build(context: Context, now: ZonedDateTime): DayDialFrame {
            val store = SharedDataStore(context)
            val root = store.widgetSnapshot?.let { runCatching { JSONObject(it) }.getOrNull() }
            val today = now.toLocalDate()
            val day = resolveWidgetDay(root, store, today)
            val use24 = widgetUses24HourClock(context, root)
            val locale = widgetLocale(context)
            val hasData = root != null
            val nowMin = now.hour * 60.0 + now.minute

            val input = if (hasData) DialFaceInput.from(day.fields, day.isProjected) else DialFaceInput.PLACEHOLDER
            val hub = if (hasData) DialHub.resolve(input.blocks, nowMin) else DialHubState()
            val zoneChanged = hasData && DialZone.changed(root?.optString("timezone", ""), now)
            val status = when {
                !hasData -> DialHubStatus.SET_UP
                day.isStale -> DialHubStatus.OUTDATED
                zoneChanged -> DialHubStatus.ZONE_CHANGED
                else -> DialHubStatus.LIVE
            }
            val copy = AndroidDialHubCopy(context, locale, use24)
            val painter = DialFacePainter(DialFontsFactory.fonts(context))
            val planned = if (status == DialHubStatus.LIVE && day.isProjected) formatPlannedLabel(context, day.freshness, use24) else null
            val detail = if (status == DialHubStatus.OUTDATED) formatStaleDetail(context, day.freshness, use24) else null
            val rows = DialHubRows.build(status, hub, copy, detail, planned, painter::measureDetail)

            val header = DialHubHeader(
                eyebrow = now.dayOfWeek.getDisplayName(TextStyle.FULL, locale).uppercase(locale),
                date = runCatching {
                    now.format(DateTimeFormatter.ofPattern(android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMMd"), locale))
                }.getOrDefault(now.toLocalDate().toString()),
            )
            // The day the widget is showing, in the Day Dial (App.jsx's day route).
            val shown = when {
                day.isProjected -> day.fields?.optString("date", "")
                day.tier == WidgetDayTier.PUSHED -> root?.optString("date", "")
                else -> null
            }?.takeIf { it.isNotEmpty() } ?: today.toString()
            val tap = "dayglance://day?date=$shown&view=dial"

            // The cards describe a live day; an outdated or mis-zoned one gets none.
            val cards = if (status == DialHubStatus.LIVE) DialCards.from(day.fields, input.blocks) else DialCards.NONE

            val summary = listOfNotNull(header.eyebrow + ", " + header.date,
                rows.title?.text, *rows.stack.map { it.text }.toTypedArray()).joinToString(". ")
            return DayDialFrame(input, nowMin, header, rows, status == DialHubStatus.OUTDATED || status == DialHubStatus.ZONE_CHANGED,
                tap, summary, painter, cards, copy)
        }
    }
}

object DialNeedle {
    /** A minute of day → the rotate drawable's level, 0..10000. Pure. */
    fun level(minutes: Double): Int = (minutes / DialGeometry.DAY_MINUTES * 10000).toInt().coerceIn(0, 10000)
}

object DialZone {
    /**
     * The snapshot's clock minutes were computed in another UTC offset than
     * the device's now: every block would sit at the wrong angle. Unknown or
     * unparseable zones are never "changed" (WidgetFreshness.zoneChanged on iOS).
     */
    fun changed(snapshotZone: String?, now: ZonedDateTime): Boolean {
        if (snapshotZone.isNullOrEmpty()) return false
        val zone = runCatching { java.time.ZoneId.of(snapshotZone) }.getOrNull() ?: return false
        return zone.rules.getOffset(now.toInstant()) != now.offset
    }
}

internal object DialFontsFactory {
    @Volatile private var cached: DialFonts? = null

    fun fonts(context: Context): DialFonts = cached ?: DialFonts(
        date = runCatching { context.resources.getFont(R.font.lora_medium) }
            .getOrElse { Typeface.create(Typeface.SERIF, Typeface.NORMAL) },
        medium = Typeface.create("sans-serif-medium", Typeface.NORMAL),
        semibold = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Typeface.create(Typeface.DEFAULT, 600, false)
                   else Typeface.create("sans-serif-medium", Typeface.NORMAL),
    ).also { cached = it }
}
