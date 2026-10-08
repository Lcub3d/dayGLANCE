// Keeps the in-app language and Android's per-app language the same choice
// (LocaleBridge.kt). Android 13+ only: below that, and on iOS, Electron and the
// web, every call here is an inert no-op.
//
// Direction matters. Only an explicit pick in the in-app picker is sent to
// Android: sending the language i18next detected at startup would pin every
// user's app to whatever their phone's language was that day and stop it from
// following the system. In the other direction, a language set in Android
// Settings is adopted whenever Android reports one, because that is the user
// choosing it.
//
// Ported from lastGLANCE (krelltunez/lastGLANCE#333). The Android check is
// inlined so this module's only import is the language resolver.

import { resolveLanguage } from '../locales.js';

const bridge = () => {
  if (typeof window === 'undefined' || window.DayGlanceIOS) return null;
  const native = window.DayGlanceNative;
  return native && typeof native.getAppLocale === 'function' ? native : null;
};

function readNative(native) {
  try {
    const parsed = JSON.parse(native.getAppLocale());
    return parsed && parsed.supported ? parsed : null;
  } catch {
    return null;
  }
}

/** Send an explicit in-app language choice to Android. */
export function setNativeAppLanguage(lng) {
  const native = bridge();
  if (!native || !readNative(native)) return;
  try {
    native.setAppLocale(lng);
  } catch {
    // Best effort: the web UI already switched, which is what the user sees.
  }
}

/**
 * Adopt Android's per-app language at startup and whenever it changes in
 * Settings (MainActivity calls window.__dayglanceAppLocaleChanged). Resolved
 * through the same function as the detector, so a tag Android reports in
 * another shape ("pt", "zh-Hans-CN") lands on a language that ships.
 */
export function syncAppLanguageFromNative(i18n) {
  const native = bridge();
  const state = native && readNative(native);
  if (!state) return;
  const adopt = (tag) => {
    if (!tag) return;
    const lng = resolveLanguage(tag);
    if (lng !== resolveLanguage(i18n.resolvedLanguage || i18n.language)) i18n.changeLanguage(lng);
  };
  adopt(state.tag);
  window.__dayglanceAppLocaleChanged = adopt;
}

// iOS. iOS keeps the app language itself: Settings > dayGLANCE > Language, or
// the phone's language when none is set. The widgets follow it directly, but
// the web UI reads i18next's cached choice before navigator.language, so after
// a change in Settings the screens stayed on the old language while the
// widgets switched.
//
// There is no API to ask iOS whether the user set a per-app language, so this
// watches for change instead: the language iOS hands the WebView is
// remembered, and when it differs at the next launch (Settings relaunches the
// app), the user changed it there, and the UI follows. The in-app picker still
// works on its own terms in between, and is the only way to choose a language
// when the phone has a single preferred language and iOS shows no Language row.
//
// Ported from lastGLANCE (krelltunez/lastGLANCE#334).
export const IOS_LANGUAGE_SEEN_KEY = 'dayglance-ios-language-seen';

export function followIOSLanguageChanges(
  i18n,
  reported = typeof navigator === 'undefined' ? undefined : navigator.language,
  storage = typeof localStorage === 'undefined' ? undefined : localStorage,
) {
  if (typeof window === 'undefined' || !window.DayGlanceIOS || !reported || !storage) return;
  try {
    const seen = storage.getItem(IOS_LANGUAGE_SEEN_KEY);
    storage.setItem(IOS_LANGUAGE_SEEN_KEY, reported);
    // First launch with this code: nothing to compare against, and adopting
    // here would override every existing user's in-app choice.
    if (seen === null || seen === reported) return;
    const lng = resolveLanguage(reported);
    if (lng !== resolveLanguage(i18n.resolvedLanguage || i18n.language)) i18n.changeLanguage(lng);
  } catch {
    // Storage unavailable: keep the cached language, as before.
  }
}
