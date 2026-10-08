package com.dayglance.app.bridge

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList
import androidx.annotation.ChecksSdkIntAtLeast
import com.dayglance.app.notifications.UpNextNotificationUpdater
import com.dayglance.app.widget.DayGlanceWidget
import com.dayglance.app.widget.GoalWidget
import com.dayglance.app.widget.MonthAgendaWidget
import com.dayglance.app.widget.MonthGridWidget
import com.dayglance.app.widget.ProjectWidget
import com.dayglance.app.widget.UpNextWidget
import com.dayglance.app.widget.dial.DayDialWidget
import org.json.JSONObject

/**
 * Keeps the in-app language and Android's per-app language (Android 13+,
 * Settings > Apps > dayGLANCE > Language) the same choice.
 *
 * The web UI picks its language itself, but everything native (widget text,
 * the Up Next notification, tiles, shortcuts, the native settings screen) is
 * resolved by Android from the app's locale. Without this, picking Polish in
 * the app left all of those following the phone's language, and a language
 * chosen in Settings was ignored by the web UI once i18next had cached one.
 *
 * Below Android 13 there is no per-app locale the system honours outside an
 * activity, so this reports unsupported and changes nothing.
 *
 * Ported from lastGLANCE (AppLocalePlugin, krelltunez/lastGLANCE#333).
 */
object LocaleBridge {

    @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.TIRAMISU)
    fun isSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    /** The app's own language as a BCP-47 tag, or null when it follows the system. */
    fun currentTag(context: Context): String? {
        if (!isSupported()) return null
        val list = context.getSystemService(LocaleManager::class.java).applicationLocales
        return if (list.isEmpty) null else list[0].toLanguageTag()
    }

    /** {"supported": bool, "tag": string|null}, for NativeBridge.getAppLocale. */
    fun describe(context: Context): String =
        JSONObject()
            .put("supported", isSupported())
            .put("tag", currentTag(context) ?: JSONObject.NULL)
            .toString()

    /**
     * Sets the app language; an empty tag returns it to the system's. This is a
     * configuration change, which MainActivity handles in place (configChanges
     * includes locale), so the WebView is not reloaded. Widgets and the
     * notification are rebuilt from MainActivity.onConfigurationChanged once
     * the new locale is in effect.
     */
    fun set(context: Context, tag: String) {
        if (!isSupported()) return
        val list = if (tag.isEmpty()) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(tag)
        context.getSystemService(LocaleManager::class.java).applicationLocales = list
    }

    /**
     * Re-render every native surface whose text comes from string resources.
     * They only pick up a new locale when rebuilt; the stored snapshot is
     * unchanged, so this is a redraw, not new data.
     */
    fun refreshNativeSurfaces(context: Context) {
        runCatching {
            DayGlanceWidget.requestUpdate(context)
            UpNextWidget.requestUpdate(context)
            GoalWidget.requestUpdate(context)
            ProjectWidget.requestUpdate(context)
            MonthGridWidget.requestUpdate(context)
            MonthAgendaWidget.requestUpdate(context)
            DayDialWidget.requestUpdate(context)
            UpNextNotificationUpdater.refresh(context)
        }
    }
}
