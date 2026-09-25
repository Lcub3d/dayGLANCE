package com.dayglance.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.format.DateFormat
import android.text.style.StyleSpan
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.WeekFields
import java.util.Locale
import kotlin.math.floor

/**
 * Month grid home-screen widget: six weeks of days as a 7 × 6 grid, each cell
 * a miniature vertical timeline of that day's blocks. The Android port of the
 * iOS systemLarge MonthGridWidget; the rules are [MonthGridModel.kt] and are
 * shared with it, this file only puts them on screen.
 *
 * HOW IT IS DRAWN. RemoteViews cannot place a bar at a computed offset below
 * API 31, and one bitmap of the whole grid is past the Binder transaction
 * limit, so the cells are a GridView collection ([MonthGridCellService]) of
 * per-cell bitmaps ([MonthGridCellPainter]). Everything else — the note line
 * (stale banner or "Planned as of …"), the day-of-week row, the dimming — is
 * ordinary RemoteViews.
 *
 * SIZE. The cell size depends on the placement, so this is the first widget
 * here to read [AppWidgetManager.getAppWidgetOptions]. On Android 12+ the host
 * lists the exact sizes the widget can be shown at (OPTION_APPWIDGET_SIZES:
 * portrait, landscape, a foldable's inner and outer screen), and each gets
 * its own RemoteViews in a size map, so the launcher shows the one drawn for
 * the space it actually has. Below 12, or when a host lists none, portrait is
 * drawn at min width × max height and landscape at max width × min height
 * ([MonthWidgetSizes]). Each layout's adapter intent carries its size, and a
 * resize ([onAppWidgetOptionsChanged]) redraws. The provider's minimum is
 * 4 × 4 launcher cells (widget_month_info.xml; why: MonthGridMetrics).
 *
 * ROLLOVER. No timeline: [MidnightRolloverReceiver] re-renders every widget
 * at 00:00, [WidgetUpdateWorker] every 15 minutes as a backstop, and each
 * push from the app ([com.dayglance.app.bridge.NativeBridge.updateWidgetSnapshot])
 * immediately. Each render resolves today against the stored window: live
 * while the window covers today's whole grid, stale after (the coverage
 * rule, MonthGridState.resolve), never a partial grid.
 *
 * TAPS. Each cell's fill-in intent carries `dayglance://day?date=…&view=month`
 * against an ACTION_VIEW template to MainActivity, which stores it for the
 * web layer (SharedDataStore.pendingDeepLink → NativeBridge.getPendingDeepLink
 * → App.jsx openDayFromLink): MONTH with the day selected, or the default view
 * when MONTH is off.
 */
class MonthGridWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) {
            try { updateWidget(context, appWidgetManager, id) } catch (_: Throwable) { }
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
        try { updateWidget(context, appWidgetManager, appWidgetId) } catch (_: Throwable) { }
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        try { WidgetUpdateWorker.schedule(context) } catch (_: Throwable) { }
        try { MidnightRolloverReceiver.arm(context) } catch (_: Throwable) { }
    }

    // onDisabled: do NOT cancel the worker — the other widgets may still need it.

    // ── Rendering ─────────────────────────────────────────────────────────────

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val options = try { appWidgetManager.getAppWidgetOptions(appWidgetId) } catch (_: Throwable) { Bundle() }
        val sizes = MonthWidgetSizes.fromOptions(
            minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0),
            maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0),
            minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0),
            maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0),
        )
        val render = loadMonthGrid(context)
        val views = exactSizeViews(context, appWidgetId, options, render) ?: RemoteViews(
            build(context, appWidgetId, sizes.landscapeWidth, sizes.landscapeHeight, render),
            build(context, appWidgetId, sizes.portraitWidth, sizes.portraitHeight, render),
        )
        appWidgetManager.updateAppWidget(appWidgetId, views)
        // The factory re-reads the store on this; a size change already
        // replaced the adapter intent, and this covers a same-size push.
        try {
            @Suppress("DEPRECATION")
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.gv_month)
        } catch (_: Throwable) { }
    }

    /**
     * Android 12+: one layout per size the host says it can show, drawn at
     * that size (whole dp, rounded down, so a cell never comes out taller
     * than the space it has). Null below 12 or when the host lists no sizes.
     */
    private fun exactSizeViews(context: Context, appWidgetId: Int, options: Bundle, render: MonthGridRender): RemoteViews? {
        val usable = exactWidgetSizes(options)
        if (usable.isEmpty()) return null
        return RemoteViews(usable.associateWith { size ->
            build(context, appWidgetId, floor(size.width).toInt(), floor(size.height).toInt(), render)
        })
    }

    private fun build(context: Context, appWidgetId: Int, widthDp: Int, heightDp: Int, render: MonthGridRender): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_month)
        bindMonthGridPane(
            context, views, appWidgetId, widthDp.toDouble(), heightDp.toDouble(), render,
            MonthGridCellService.KIND_GRID,
        )

        // The padding and the header open the app.
        try {
            val launch = Intent(context, MainActivity::class.java)
            val pi = PendingIntent.getActivity(
                context, REQUEST_OPEN_APP, launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.month_root, pi)
        } catch (_: Throwable) { }

        return views
    }

    companion object {
        private const val REQUEST_OPEN_APP = 4311

        /** Re-renders every placed month grid from the stored snapshot. */
        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, MonthGridWidget::class.java))
                if (ids.isEmpty()) return
                val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, MonthGridWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                context.sendBroadcast(intent)
            } catch (_: Throwable) { }
        }
    }
}

// ── Shared between the provider and the cell factory ─────────────────────────

/** What one render of the month grid reads from the store. */
internal class MonthGridRender(
    /** Null when there is nothing to draw: no snapshot, or one without a window. */
    val state: MonthGridState?,
    val use24Hour: Boolean,
    val locale: Locale,
    /** The device's first day of the week, for the placeholder grid. */
    val placeholderWeekStart: Int,
    val monthDayLabel: (LocalDate) -> String,
)

/**
 * The provider (note, weekday row, dimming) and the factory (cells) each call
 * this and resolve the same stored window against the same local day, so they
 * agree; the one moment they could not — a render straddling midnight — is
 * followed by the rollover alarm's own render.
 */
internal fun loadMonthGrid(context: Context, today: LocalDate = LocalDate.now()): MonthGridRender {
    val dataStore = SharedDataStore(context)
    val locale = widgetLocale(context)
    val json = dataStore.widgetSnapshot
    val snapshot: JSONObject? = json?.let { runCatching { JSONObject(it) }.getOrNull() }
    val window = snapshot?.let { MonthWindowStore.decode(it) }
    val pushed = snapshotFreshness(snapshot, dataStore, today)
    val label = monthDayLabel(locale)
    val state = MonthGridState.resolve(pushed, window, today, label)
    return MonthGridRender(
        state = state,
        use24Hour = widgetUses24HourClock(context, snapshot),
        locale = locale,
        placeholderWeekStart = WeekFields.of(locale).firstDayOfWeek.value % 7,
        monthDayLabel = label,
    )
}

/**
 * Fills a month grid pane — the note line (stale banner or "Planned as of"),
 * the day-of-week row, the dimming and the cell collection with its deep-link
 * template — in any layout that carries the grid's views (tv_month_note,
 * tv_month_wd_0…6, gv_month). The month grid widget's whole layout is one
 * such pane; the month + agenda widget has one beside or above its agenda.
 * [paneWidthDp] × [paneHeightDp] is the pane's size, which the cells are
 * drawn for (MonthGridMetrics); [kind] tells the cell factory which widget
 * it serves (palette and selection ring). Returns the resolved state.
 *
 * THEMES. Everything in the layout XML follows the launcher's light/dark
 * theme by itself (values / values-night). The note line's colour is set
 * here, so on Android 12+ it is set as a light/night pair (setColorInt) and
 * follows too; below 12 it takes this process's theme. The cells carry a
 * bitmap per theme (MonthGridCellFactory).
 */
internal fun bindMonthGridPane(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    paneWidthDp: Double,
    paneHeightDp: Double,
    render: MonthGridRender,
    kind: String,
): MonthGridState? {
    val state = render.state

    // ── The note line: banner, caption, or nothing ────────────────────────
    val note: String? = when {
        state == null -> context.getString(R.string.widget_open_to_refresh)
        state.isStale -> formatStaleLabel(context, state.freshness, render.use24Hour)
        state.isProjected -> formatMonthPlannedLabel(context, state.freshness, render.use24Hour)
        else -> null
    }
    if (note != null) {
        // As on iOS: the stale banner bold in the warning colour (StaleBanner),
        // the "Planned as of" caption muted.
        val stale = state?.isStale == true
        val text = if (stale) SpannableString(note).apply {
            setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        } else note
        views.setTextViewText(R.id.tv_month_note, text)
        val light = MonthCellPalette.forKind(context, kind, night = false)
        val night = MonthCellPalette.forKind(context, kind, night = true)
        fun noteColor(p: MonthCellPalette) = if (stale) p.staleNote else p.plannedNote
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColorInt(R.id.tv_month_note, "setTextColor", noteColor(light), noteColor(night))
        } else {
            views.setTextColor(R.id.tv_month_note, noteColor(if (MonthCellPalette.isNight(context)) night else light))
        }
        views.setViewVisibility(R.id.tv_month_note, View.VISIBLE)
    } else {
        views.setViewVisibility(R.id.tv_month_note, View.GONE)
    }
    // A stale grid reads as inactive before any text is parsed.
    views.setFloat(R.id.gv_month, "setAlpha", if (state?.isStale == true) STALE_CONTENT_ALPHA else 1f)

    // ── Day-of-week row ───────────────────────────────────────────────────
    val weekStart = state?.weekStart ?: render.placeholderWeekStart
    val initials = MonthGrid.weekdayInitials(weekStart, render.locale)
    MONTH_WEEKDAY_IDS.forEachIndexed { i, id -> views.setTextViewText(id, initials.getOrElse(i) { "" }) }

    // ── The cells ─────────────────────────────────────────────────────────
    val adapterIntent = Intent(context, MonthGridCellService::class.java).apply {
        data = MonthGridCellService.adapterUri(
            appWidgetId, paneWidthDp.toInt(), paneHeightDp.toInt(), noteShown = note != null, kind = kind,
        )
    }
    @Suppress("DEPRECATION")
    views.setRemoteAdapter(R.id.gv_month, adapterIntent)

    // The tap template: ACTION_VIEW to MainActivity with NO data, so each
    // cell's fill-in supplies the day's URL. Mutable, because a fill-in is
    // a mutation (Android 12 rejects it on an immutable PendingIntent).
    val template = Intent(context, MainActivity::class.java).apply { action = Intent.ACTION_VIEW }
    val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    views.setPendingIntentTemplate(
        R.id.gv_month,
        PendingIntent.getActivity(context, REQUEST_MONTH_CELL_TEMPLATE, template, PendingIntent.FLAG_UPDATE_CURRENT or mutable),
    )
    return state
}

/**
 * The exact sizes the host lists for a widget instance (Android 12+,
 * OPTION_APPWIDGET_SIZES), at most 16 (RemoteViews(Map)'s limit), or empty
 * below 12 or when the host lists none.
 */
internal fun exactWidgetSizes(options: Bundle): List<SizeF> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
    val sizes = try {
        @Suppress("DEPRECATION")
        options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
    } catch (_: Throwable) { null }
    return sizes.orEmpty().filter { it.width > 0f && it.height > 0f }.distinct().take(16)
}

private const val REQUEST_MONTH_CELL_TEMPLATE = 4310

internal val MONTH_WEEKDAY_IDS = intArrayOf(
    R.id.tv_month_wd_0, R.id.tv_month_wd_1, R.id.tv_month_wd_2, R.id.tv_month_wd_3,
    R.id.tv_month_wd_4, R.id.tv_month_wd_5, R.id.tv_month_wd_6,
)

internal fun widgetLocale(context: Context): Locale {
    val locales = context.resources.configuration.locales
    return if (locales.isEmpty) Locale.getDefault() else locales[0]
}

/** "Oct 1" by the locale's own skeleton, so day/month order follows the device. */
internal fun monthDayLabel(locale: Locale): (LocalDate) -> String {
    val formatter = runCatching {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "MMMd"), locale)
    }.getOrNull() ?: return MonthGrid.defaultMonthDayLabel(locale)
    return { date -> runCatching { date.format(formatter) }.getOrElse { MonthGrid.defaultMonthDayLabel(locale)(date) } }
}
