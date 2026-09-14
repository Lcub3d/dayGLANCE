// The app's view modes, in the order the switchers cycle through them.
//
// Desktop and landscape tablet use the ViewCycler over `viewMode`; phones and
// portrait tablets use the MobileViewToggle over `mobileViewMode`. MONTH is
// in both (it is the phone's case above all) and sits before SCHED, so the
// calendar views come first and the agenda last: 1 MULTI, 2 DAY, 3 WEEK,
// 4 MONTH, 5 SCHED. While the Day Dial is up (the kiosk runs it unattended)
// MONTH is left out of every switcher, so a day sheet cannot be opened with
// nobody there to dismiss it.
//
// Views can be turned off per device (settings, "Views on this device"). A
// hidden view leaves the switcher, the number keys and the C cycle, and the
// default-view picker, on that device only; nothing it shows is lost. The
// hidden views are kept per switcher: one list for the desktop cycler, one
// for the phone toggle, so a tablet (the phone toggle in portrait, the
// cycler in landscape) can hide MONTH in one orientation and keep it in the
// other. The one rule is that at least one view stays on in each list.
// Wherever the app needs a view to land on (a persisted default since
// hidden, a window too narrow for the view it was on) it takes the first
// view still on for that width, and only when a width leaves none does it
// show the list's first view regardless.

export const DESKTOP_VIEW_MODES = ['multi', 'day', 'week', 'month', 'sched'];
/** Narrow desktop and landscape tablet: DAY and WEEK need the 3-column grid. */
export const NARROW_DESKTOP_VIEW_MODES = ['multi', 'month', 'sched'];
export const MOBILE_VIEW_MODES = ['grid', 'list', 'month', 'sched'];

/** The two switchers hidden views are kept for: the desktop cycler and the phone toggle. */
export const VIEW_SCOPES = { desktop: DESKTOP_VIEW_MODES, mobile: MOBILE_VIEW_MODES };
/** The number key that jumps to each desktop view. */
export const VIEW_SHORTCUT_KEYS = { multi: '1', day: '2', week: '3', month: '4', sched: '5' };

/** A persisted or URL view value, or the fallback when it is not one we know (an older or newer build wrote it). */
export function resolveStoredView(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * The persisted hidden-views value as clean lists, one per switcher: known
 * views only, no duplicates, in switcher order. A list that would hide every
 * view of its switcher (a hand-edited one) is ignored: at least one view
 * stays on. A plain array (the first build of this setting) applies its
 * names to both switchers.
 */
export function normalizeHiddenViews(value) {
  const source = Array.isArray(value) ? { desktop: value, mobile: value } : (value && typeof value === 'object' ? value : {});
  const clean = (views, list) => {
    const hidden = Array.isArray(list) ? views.filter((v) => list.includes(v)) : [];
    return hidden.length === views.length ? [] : hidden;
  };
  return { desktop: clean(DESKTOP_VIEW_MODES, source.desktop), mobile: clean(MOBILE_VIEW_MODES, source.mobile) };
}

/** `views` minus the hidden ones. */
export function enabledViews(views, hidden = []) {
  return views.filter((v) => !hidden.includes(v));
}

/** Where to land among `views`: the first still on, else the list's first view regardless. */
export function homeView(views, hidden = []) {
  return enabledViews(views, hidden)[0] || views[0];
}

/** A switcher never has nothing to show: an empty list of states becomes the list's first view. */
const orFirst = (views, states) => (states.length ? states : [views[0]]);

/** The desktop cycler's states for the current width, minus MONTH while the Day Dial is up, minus the device's hidden views. */
export function cyclerStates(canShowViewCycler, dialActive = false, hidden = []) {
  const views = canShowViewCycler ? DESKTOP_VIEW_MODES : NARROW_DESKTOP_VIEW_MODES;
  const states = enabledViews(views, hidden);
  return orFirst(views, dialActive ? states.filter((v) => v !== 'month') : states);
}

/** The mobile toggle's states, minus MONTH while the Day Dial is up, minus the device's hidden views. */
export function mobileToggleStates(dialActive = false, hidden = []) {
  const states = enabledViews(MOBILE_VIEW_MODES, hidden);
  return orFirst(MOBILE_VIEW_MODES, dialActive ? states.filter((v) => v !== 'month') : states);
}

/** The state after `current` in `states`, wrapping; the first state when `current` is not in the list. */
export function nextState(states, current) {
  const idx = states.indexOf(current);
  return states[(idx + 1) % states.length];
}
