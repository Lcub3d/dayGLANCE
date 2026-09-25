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

/**
 * The most a cell's two bitmaps may weigh together before the factory sends
 * one instead: well under the ~1 MB Binder transaction limit, leaving room
 * for the rest of the RemoteViews. A phone's cells (~50dp at 3–3.5×) are
 * ~100–200 KB each; a tablet's large placements approach this.
 */
private const val MAX_TWO_THEME_BYTES = 700_000L

internal class MonthGridCellFactory(
    private val context: Context,
    data: Uri?,
) : RemoteViewsService.RemoteViewsFactory {

    private val widthDp = data?.getQueryParameter("w")?.toIntOrNull() ?: MonthGridMetrics.MIN_WIDGET_WIDTH.toInt()
    private val heightDp = data?.getQueryParameter("h")?.toIntOrNull() ?: MonthGridMetrics.MIN_WIDGET_HEIGHT.toInt()
    private val noteShown = data?.getQueryParameter("note") == "1"
    private val kind = data?.getQueryParameter("kind") ?: MonthGridCellService.KIND_GRID
    private val isAgenda = kind == MonthGridCellService.KIND_AGENDA
    private val appWidgetId = data?.pathSegments?.firstOrNull()?.toIntOrNull()

    private val metrics = MonthGridMetrics(
        widthDp.toDouble(), heightDp.toDouble(),
        if (noteShown) MonthGridMetrics.NOTE_HEIGHT else 0.0,
    )
    // One painter per theme: every cell is drawn light and night, and the
    // cell layout's night variant picks which one the launcher shows.
    private val lightPainter = MonthGridCellPainter(context, MonthCellPalette.forKind(context, kind, night = false))
    private val nightPainter = MonthGridCellPainter(context, MonthCellPalette.forKind(context, kind, night = true))

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
            val blank = lightPainter.blank(metrics)
            setImageViewBitmap(R.id.iv_month_cell, blank)
            setImageViewBitmap(R.id.iv_month_cell_night, blank)
        }

    override fun getViewAt(position: Int): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_month_cell)
        val cell = cells.getOrNull(position)
        if (cell == null) {
            val blank = lightPainter.blank(metrics)
            rv.setImageViewBitmap(R.id.iv_month_cell, blank)
            rv.setImageViewBitmap(R.id.iv_month_cell_night, blank)
            rv.setOnClickFillInIntent(R.id.month_cell_root, Intent())
            return rv
        }
        val isSelected = cell.date == selected
        val light = lightPainter.draw(cell, metrics, selected = isSelected)
        val night = nightPainter.draw(cell, metrics, selected = isSelected)
        if (light.byteCount.toLong() + night.byteCount > MAX_TWO_THEME_BYTES) {
            // Too big to send both in one transaction (large cells on a dense
            // screen): the current theme's bitmap in both slots, which the
            // RemoteViews bitmap cache sends once. A theme switch then shows
            // at the next redraw instead of at once.
            val current = if (MonthCellPalette.isNight(context)) night else light
            rv.setImageViewBitmap(R.id.iv_month_cell, current)
            rv.setImageViewBitmap(R.id.iv_month_cell_night, current)
        } else {
            rv.setImageViewBitmap(R.id.iv_month_cell, light)
            rv.setImageViewBitmap(R.id.iv_month_cell_night, night)
        }
        rv.setContentDescription(R.id.month_cell_root, describe(cell))
        // The day's link rides the fill-in: MonthGridWidget's template is an
        // ACTION_VIEW to MainActivity with no data, so this data completes it
        // and the app opens MONTH on the day (utils/dayLink.js).
        val fillIn = Intent()
        if (links) fillIn.data = Uri.parse(cell.url)
        rv.setOnClickFillInIntent(R.id.month_cell_root, fillIn)
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
