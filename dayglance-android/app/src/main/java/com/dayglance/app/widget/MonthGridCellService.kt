package com.dayglance.app.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.dayglance.app.R
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * RemoteViewsService behind the month grid's GridView: 42 cells, one bitmap
 * each ([MonthGridCellPainter]), so no single Binder transaction carries the
 * whole grid.
 *
 * The size the cells are drawn at is in the adapter intent's data URI
 * (`dayglance-widget://month/<id>?w=<dp>&h=<dp>&note=<0|1>&kind=<grid|agenda>`),
 * written by [bindMonthGridPane] from the host's AppWidgetOptions. `kind`
 * says which widget the cells are for: the month grid widget (its dark
 * palette) or the month + agenda widget (the other widgets' light/dark
 * palette, and a ring on the selected day, MonthAgendaSelectionStore). The URI, not extras,
 * because the host keys factories by intent identity (action, data, type,
 * class, categories — never extras): a portrait and a landscape layout of the
 * same widget need two factories, and a resize needs a fresh one.
 */
class MonthGridCellService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        MonthGridCellFactory(applicationContext, intent.data)

    companion object {
        const val SCHEME = "dayglance-widget"
        const val HOST = "month"
        const val KIND_GRID = "grid"
        const val KIND_AGENDA = "agenda"

        fun adapterUri(appWidgetId: Int, widthDp: Int, heightDp: Int, noteShown: Boolean, kind: String = KIND_GRID): Uri =
            Uri.Builder().scheme(SCHEME).authority(HOST).appendPath(appWidgetId.toString())
                .appendQueryParameter("w", widthDp.toString())
                .appendQueryParameter("h", heightDp.toString())
                .appendQueryParameter("note", if (noteShown) "1" else "0")
                .appendQueryParameter("kind", kind)
                .build()
    }
}

internal class MonthGridCellFactory(
    private val context: Context,
    data: Uri?,
) : RemoteViewsService.RemoteViewsFactory {

    private val widthDp = data?.getQueryParameter("w")?.toIntOrNull() ?: MonthGridMetrics.MIN_WIDGET_WIDTH.toInt()
    private val heightDp = data?.getQueryParameter("h")?.toIntOrNull() ?: MonthGridMetrics.MIN_WIDGET_HEIGHT.toInt()
    private val noteShown = data?.getQueryParameter("note") == "1"
    private val isAgenda = data?.getQueryParameter("kind") == MonthGridCellService.KIND_AGENDA
    private val appWidgetId = data?.pathSegments?.firstOrNull()?.toIntOrNull()

    private val metrics = MonthGridMetrics(
        widthDp.toDouble(), heightDp.toDouble(),
        if (noteShown) MonthGridMetrics.NOTE_HEIGHT else 0.0,
    )
    private val painter = MonthGridCellPainter(
        context,
        if (isAgenda) MonthCellPalette.systemWidget(context) else MonthCellPalette.monthWidget(context),
    )

    private var cells: List<MonthGridCell> = emptyList()
    /** False for the placeholder grid: its cells open the app, not a day. */
    private var links = false
    /** The month + agenda widget's selected day, ringed; null for the grid widget. */
    private var selected: String? = null

    override fun onCreate() { /* loading is done in onDataSetChanged */ }

    override fun onDataSetChanged() {
        try {
            val render = loadMonthGrid(context)
            val state = render.state ?: MonthGridState.placeholder(LocalDate.now(), render.placeholderWeekStart, render.monthDayLabel)
            cells = state.cells
            links = render.state != null
            selected = if (isAgenda && appWidgetId != null) {
                MonthDaySelection.resolve(
                    MonthAgendaSelectionStore.load(context, appWidgetId), cells, MonthGrid.isoDay(LocalDate.now()),
                )
            } else null
        } catch (_: Throwable) {
            cells = emptyList()
            links = false
        }
    }

    override fun onDestroy() { cells = emptyList() }

    override fun getCount(): Int = cells.size
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true

    override fun getLoadingView(): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_month_cell).apply {
            setImageViewBitmap(R.id.iv_month_cell, painter.blank(metrics))
        }

    override fun getViewAt(position: Int): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_month_cell)
        val cell = cells.getOrNull(position)
        if (cell == null) {
            rv.setImageViewBitmap(R.id.iv_month_cell, painter.blank(metrics))
            rv.setOnClickFillInIntent(R.id.iv_month_cell, Intent())
            return rv
        }
        rv.setImageViewBitmap(R.id.iv_month_cell, painter.draw(cell, metrics, selected = cell.date == selected))
        rv.setContentDescription(R.id.iv_month_cell, describe(cell))
        // The day's link rides the fill-in: MonthGridWidget's template is an
        // ACTION_VIEW to MainActivity with no data, so this data completes it
        // and the app opens MONTH on the day (utils/dayLink.js).
        val fillIn = Intent()
        if (links) fillIn.data = Uri.parse(cell.url)
        rv.setOnClickFillInIntent(R.id.iv_month_cell, fillIn)
        return rv
    }

    private fun describe(cell: MonthGridCell): String {
        val parts = ArrayList<String>(3)
        WidgetFreshnessRules.parseDay(cell.date)?.let {
            parts += it.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(widgetLocale(context)))
        }
        if (cell.totalBars > 0) {
            parts += context.resources.getQuantityString(R.plurals.widget_month_scheduled, cell.totalBars, cell.totalBars)
        }
        if (cell.hasPip) parts += context.getString(R.string.widget_month_all_day_or_due)
        return parts.joinToString(", ")
    }
}
