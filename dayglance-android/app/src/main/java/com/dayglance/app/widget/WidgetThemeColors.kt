package com.dayglance.app.widget

import android.content.Context
import android.os.Build
import android.widget.RemoteViews

// ─────────────────────────────────────────────────────────────────────────────
// Theme colours set from code. Colours in the layout XML resolve when the
// launcher inflates the view, so they follow a light/dark switch by
// themselves; a colour the widget resolves in code (getColor) is a fixed
// value baked into the RemoteViews, and stays in the old theme until the next
// redraw (up to the worker's 15 minutes). On Android 12+ RemoteViews.setColor
// carries the RESOURCE and the host resolves it in its own configuration, so
// these follow the theme like the XML does. Below 12 they resolve now.
// ─────────────────────────────────────────────────────────────────────────────

internal fun RemoteViews.setThemedColor(context: Context, viewId: Int, method: String, res: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setColor(viewId, method, res)
    else setInt(viewId, method, context.getColor(res))
}

internal fun RemoteViews.setThemedTextColor(context: Context, viewId: Int, res: Int) =
    setThemedColor(context, viewId, "setTextColor", res)

internal fun RemoteViews.setThemedBackgroundColor(context: Context, viewId: Int, res: Int) =
    setThemedColor(context, viewId, "setBackgroundColor", res)
