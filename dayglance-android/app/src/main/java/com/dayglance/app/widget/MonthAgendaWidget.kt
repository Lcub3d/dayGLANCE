package com.dayglance.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import java.time.LocalDate
import kotlin.math.floor

/**
 * Month + agenda home-screen widget: the month grid widget's grid paired with
 * one day's agenda, paged with two arrows. A separate widget in the picker;
 * the grid widget ([MonthGridWidget]) is unchanged.
 *
 * WHAT IS SHARED. The grid is the grid widget's: the same model
 * ([MonthGridState] via [loadMonthGrid]), the same per-cell bitmaps
 * ([MonthGridCellService] / [MonthGridCellPainter], asked for the
 * `agenda` kind: the other widgets' light/dark palette and a ring on the
 * selected day) and the same pane binding ([bindMonthGridPane]). The agenda
 * is the Today widget's list ([DayGlanceWidgetListFactory], in its month
 * agenda mode): its row types and styles, and for today its very content,
 * habits left out. Every rule is in [MonthAgendaModel.kt] and unit-tested.
 *
 * LAYOUT BY SHAPE ([MonthAgendaLayout]): side by side (grid left, agenda
 * right) on wide placements, stacked (grid on top) otherwise. Android 12+
 * gets one layout per size the host lists; below that the portrait and
 * landscape layouts are each chosen from their own size, and a resize
 * ([onAppWidgetOptionsChanged]) redraws.
 *
 * THE ARROWS (and "Today", shown when paged away) are the only in-widget
 * interaction: PendingIntent broadcasts to this provider ([ACTION_SELECT_DAY],
 * [ACTION_SELECT_TODAY]) that store the target day
 * ([MonthAgendaSelectionStore]) and redraw — header, arrows, the grid's ring
 * and the list — without launching the app. They page across the 42 visible
 * days and disable at both ends. Grid cells stay deep links (`view=month`),
 * exactly as in the grid widget.
 *
 * MIDNIGHT: the stored selection carries the day it was made and reads as
 * today on any other day; [MidnightRolloverReceiver] also clears it and
 * redraws at 00:00. Staleness and the dated "Planned as of" label are the grid
 * widget's (the coverage rule), and a stale widget dims its list too.
 */
class MonthAgendaWidget : AppWidgetProvider() {

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

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        super.onDeleted(context, appWidgetIds)
        for (id in appWidgetIds) runCatching { MonthAgendaSelectionStore.clear(context, id) }
    }

    // onDisabled: do NOT cancel the worker — the other widgets may still need it.

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_SELECT_TODAY) {
            // Clearing the selection IS "today": it resolves to the day it is
            // when read, so a tap just after midnight cannot land on yesterday.
            val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
                runCatching {
                    MonthAgendaSelectionStore.clear(context, id)
                    updateWidget(context, AppWidgetManager.getInstance(context), id)
                }
            }
            return
        }
        if (intent.action == ACTION_SELECT_DAY) {
            val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            val date = intent.getStringExtra(EXTRA_DATE)
            if (id != AppWidgetManager.INVALID_APPWIDGET_ID && date != null && WidgetFreshnessRules.parseDay(date) != null) {
                runCatching {
                    MonthAgendaSelectionStore.save(context, id, MonthDaySelection(date, MonthGrid.isoDay(LocalDate.now())))
                    updateWidget(context, AppWidgetManager.getInstance(context), id)
                }
            }
            return
        }
        super.onReceive(context, intent)
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val options = try { appWidgetManager.getAppWidgetOptions(appWidgetId) } catch (_: Throwable) { Bundle() }
        val today = LocalDate.now()
        val render = loadMonthGrid(context, today)
        val cells = (render.state ?: MonthGridState.placeholder(today, render.placeholderWeekStart, render.monthDayLabel)).cells
        val selected = MonthDaySelection.resolve(
            MonthAgendaSelectionStore.load(context, appWidgetId), cells, MonthGrid.isoDay(today),
        )
        val frame = Frame(render, cells, selected)

        val exact = exactWidgetSizes(options)
        val views = if (exact.isNotEmpty()) {
            RemoteViews(exact.associateWith { build(context, appWidgetId, floor(it.width).toDouble(), floor(it.height).toDouble(), frame) })
        } else {
            val sizes = MonthWidgetSizes.fromOptions(
                minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0),
                maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0),
                minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0),
                maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0),
                fallbackWidth = MonthAgendaLayout.MIN_WIDTH,
                fallbackHeight = MonthAgendaLayout.MIN_HEIGHT,
            )
            RemoteViews(
                build(context, appWidgetId, sizes.landscapeWidth.toDouble(), sizes.landscapeHeight.toDouble(), frame),
                build(context, appWidgetId, sizes.portraitWidth.toDouble(), sizes.portraitHeight.toDouble(), frame),
            )
        }
        appWidgetManager.updateAppWidget(appWidgetId, views)
        // Both collections re-read the store: the grid for the ring, the list
        // for the day. A size change already replaced the grid's adapter.
        try {
            @Suppress("DEPRECATION")
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.gv_month)
            @Suppress("DEPRECATION")
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.lv_month_agenda)
        } catch (_: Throwable) { }
    }

    /** What every size of one render shares. */
    private class Frame(val render: MonthGridRender, val cells: List<MonthGridCell>, val selected: String?)

    private fun build(context: Context, appWidgetId: Int, widthDp: Double, heightDp: Double, frame: Frame): RemoteViews {
        val arrangement = MonthAgendaLayout.arrangement(widthDp, heightDp)
        val layout = when (arrangement) {
            MonthAgendaArrangement.SIDE_BY_SIDE -> R.layout.widget_month_agenda_side
            MonthAgendaArrangement.STACKED ->
                if (MonthAgendaLayout.stackedIsEven(heightDp)) R.layout.widget_month_agenda_stacked_even
                else R.layout.widget_month_agenda_stacked
        }
        val views = RemoteViews(context.packageName, layout)

        // ── The grid pane: shared with the month grid widget ──────────────
        val (paneW, paneH) = MonthAgendaLayout.gridPane(widthDp, heightDp)
        val state = bindMonthGridPane(
            context, views, appWidgetId, paneW, paneH, frame.render,
            MonthCellPalette.systemWidget(context), MonthGridCellService.KIND_AGENDA,
        )

        // ── The agenda header: the day, and the arrows ────────────────────
        val selectedDay = frame.selected?.let { WidgetFreshnessRules.parseDay(it) } ?: LocalDate.now()
        views.setTextViewText(R.id.tv_agenda_date, formatWidgetDate(context, selectedDay))
        bindToday(context, views, appWidgetId, MonthDaySelection.showsToday(frame.selected, frame.cells, MonthGrid.isoDay(LocalDate.now())))
        val (previous, next) = MonthDaySelection.neighbours(frame.selected, frame.cells)
        bindArrow(context, views, appWidgetId, R.id.iv_agenda_prev, previous, frame.selected, DIRECTION_PREVIOUS)
        bindArrow(context, views, appWidgetId, R.id.iv_agenda_next, next, frame.selected, DIRECTION_NEXT)

        // ── The agenda list: the Today widget's rows ──────────────────────
        val listIntent = Intent(context, MonthAgendaListService::class.java).apply {
            data = MonthAgendaListService.adapterUri(appWidgetId)
        }
        @Suppress("DEPRECATION")
        views.setRemoteAdapter(R.id.lv_month_agenda, listIntent)
        // Rows open the app, as the Today widget's rows do.
        views.setPendingIntentTemplate(
            R.id.lv_month_agenda,
            PendingIntent.getActivity(
                context, REQUEST_OPEN_APP, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        views.setFloat(R.id.lv_month_agenda, "setAlpha", if (state?.isStale == true) STALE_CONTENT_ALPHA else 1f)

        // The padding and the headers open the app.
        views.setOnClickPendingIntent(
            R.id.month_agenda_root,
            PendingIntent.getActivity(
                context, REQUEST_OPEN_APP, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        return views
    }

    /** "Today": shown when paged away from today (MonthDaySelection.showsToday). */
    private fun bindToday(context: Context, views: RemoteViews, appWidgetId: Int, shown: Boolean) {
        views.setViewVisibility(R.id.tv_agenda_today, if (shown) android.view.View.VISIBLE else android.view.View.GONE)
        if (!shown) return
        val intent = Intent(context, MonthAgendaWidget::class.java).apply {
            action = ACTION_SELECT_TODAY
            data = Uri.Builder().scheme(MonthGridCellService.SCHEME).authority("month-agenda")
                .appendPath(appWidgetId.toString()).appendPath("today").build()
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        }
        views.setOnClickPendingIntent(
            R.id.tv_agenda_today,
            PendingIntent.getBroadcast(context, REQUEST_ARROW, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
    }

    /**
     * An arrow: a broadcast to this provider that selects [target], or — at
     * either end of the grid — drawn faded, with a tap that re-selects the
     * current day (a no-op) rather than falling through to the root, which
     * would open the app.
     */
    private fun bindArrow(
        context: Context,
        views: RemoteViews,
        appWidgetId: Int,
        viewId: Int,
        target: String?,
        current: String?,
        direction: String,
    ) {
        val date = target ?: current
        views.setFloat(viewId, "setAlpha", if (target != null) 1f else DISABLED_ARROW_ALPHA)
        if (date == null) return
        val intent = Intent(context, MonthAgendaWidget::class.java).apply {
            action = ACTION_SELECT_DAY
            // One PendingIntent per instance and direction: the data URI keeps
            // them apart (extras do not), and FLAG_UPDATE_CURRENT refreshes the
            // target on every render.
            data = Uri.Builder().scheme(MonthGridCellService.SCHEME).authority("month-agenda")
                .appendPath(appWidgetId.toString()).appendPath(direction).build()
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            putExtra(EXTRA_DATE, date)
        }
        views.setOnClickPendingIntent(
            viewId,
            PendingIntent.getBroadcast(context, REQUEST_ARROW, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
    }

    companion object {
        const val ACTION_SELECT_DAY = "com.dayglance.app.widget.MONTH_AGENDA_SELECT_DAY"
        const val ACTION_SELECT_TODAY = "com.dayglance.app.widget.MONTH_AGENDA_SELECT_TODAY"
        const val EXTRA_DATE = "date"
        private const val DIRECTION_PREVIOUS = "previous"
        private const val DIRECTION_NEXT = "next"
        private const val REQUEST_OPEN_APP = 4321
        private const val REQUEST_ARROW = 4322
        private const val DISABLED_ARROW_ALPHA = 0.3f

        /** Re-renders every placed month + agenda widget from the stored snapshot. */
        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, MonthAgendaWidget::class.java))
                if (ids.isEmpty()) return
                val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, MonthAgendaWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                context.sendBroadcast(intent)
            } catch (_: Throwable) { }
        }
    }
}

/**
 * The month + agenda widget's selected day per instance, in its own
 * SharedPreferences file. Only the arrows write it; MidnightRolloverReceiver
 * clears it at 00:00 and onDeleted when an instance is removed. What it holds
 * is read through [MonthDaySelection.resolve], which also treats a record
 * from another day as absent, so a missed midnight still resets.
 */
internal object MonthAgendaSelectionStore {
    private const val PREFS = "dayglance_month_agenda"
    private fun key(id: Int) = "selection_$id"

    fun load(context: Context, appWidgetId: Int): MonthDaySelection? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key(appWidgetId), null) ?: return null
        val parts = raw.split('|')
        if (parts.size != 2) return null
        return MonthDaySelection(date = parts[0], setOn = parts[1])
    }

    fun save(context: Context, appWidgetId: Int, selection: MonthDaySelection) {
        // commit(), not apply(): the redraw that follows reads it back at once,
        // from the cell and list factories as well as here.
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(key(appWidgetId), "${selection.date}|${selection.setOn}").commit()
    }

    fun clear(context: Context, appWidgetId: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key(appWidgetId)).commit()
    }

    fun clearAll(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
    }
}

/**
 * RemoteViewsService behind the month + agenda widget's list: the Today
 * widget's factory in its month agenda mode, one per widget instance (the
 * instance id rides the adapter intent's data URI, which the host keys
 * factories by).
 */
class MonthAgendaListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        DayGlanceWidgetListFactory(
            applicationContext,
            monthAgendaWidgetId = intent.data?.pathSegments?.firstOrNull()?.toIntOrNull() ?: AppWidgetManager.INVALID_APPWIDGET_ID,
        )

    companion object {
        fun adapterUri(appWidgetId: Int): Uri =
            Uri.Builder().scheme(MonthGridCellService.SCHEME).authority("month-agenda-list")
                .appendPath(appWidgetId.toString()).build()
    }
}
