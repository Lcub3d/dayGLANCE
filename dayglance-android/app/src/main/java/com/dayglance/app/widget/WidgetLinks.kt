package com.dayglance.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.dayglance.app.MainActivity

// ─────────────────────────────────────────────────────────────────────────────
// Where a widget's tap lands in the app: a dayglance:// link, stored by
// MainActivity (storeDeepLink) and applied by the web layer (App.jsx,
// utils/goalsLink.js and utils/dayLink.js), the same URLs the iOS widgets open.
//
//   dayglance://today          today's calendar (Today, Up Next)
//   dayglance://goal?id=…      that goal in Goals & Projects (Goal)
//   dayglance://project?id=…   that project, its card in view (Project)
//   dayglance://task?id=…      that task on its day, or in the inbox (Today rows)
//
// A plain launch intent would bring the app forward wherever it was, on
// another day or in the Goals space; a link says where to go.
// ─────────────────────────────────────────────────────────────────────────────

object WidgetLinks {
    const val TODAY = "dayglance://today"

    /** The goal's link; with no goal configured, the Goals & Projects space. */
    fun goal(id: String?): String = link("goal", id)

    /** The project's link; with no project configured, the space. */
    fun project(id: String?): String = link("project", id)

    /** A task's link: its day (or the inbox), the task highlighted. */
    fun task(id: String): String = link("task", id)

    /** Ids are percent-encoded (Uri.encode leaves only unreserved characters),
     *  so an id with '+', '&' or spaces reaches URLSearchParams intact. */
    private fun link(host: String, id: String?): String =
        if (id.isNullOrEmpty()) "dayglance://$host" else "dayglance://$host?id=${Uri.encode(id)}"

    /** A VIEW intent for [url], explicit to MainActivity so no other app can
     *  answer it, for a root click or a collection's pending-intent template. */
    fun intent(context: Context, url: String): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java)

    /** A collection's click template: VIEW to MainActivity with no data, for
     *  the rows' fill-in intents to supply (the data of a fill-in is applied
     *  only where the template has none). Mutable on Android 12+, as a
     *  template must be there (MonthGridWidget does the same); explicit, so
     *  nothing but MainActivity can receive it. */
    fun rowTemplate(context: Context, requestCode: Int): PendingIntent =
        PendingIntent.getActivity(
            context, requestCode,
            Intent(Intent.ACTION_VIEW).setClass(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
        )

    fun pendingIntent(context: Context, requestCode: Int, url: String): PendingIntent =
        PendingIntent.getActivity(
            context, requestCode, intent(context, url),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}
