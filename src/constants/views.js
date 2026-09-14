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
// hidden view leaves the switchers, the number keys and the C cycle, and the
// default-view pickers, on that device only; nothing it shows is lost. The
// home view of each form factor (MULTI on desktop, GRID on the phone) is
// always on, so there is always somewhere to land and a persisted default
// that has since been hidden falls back the way an unknown value does.

export const DESKTOP_VIEW_MODES = ['multi', 'day', 'week', 'month', 'sched'];
/** Narrow desktop and landscape tablet: DAY and WEEK need the 3-column grid. */
export const NARROW_DESKTOP_VIEW_MODES = ['multi', 'month', 'sched'];
export const MOBILE_VIEW_MODES = ['grid', 'list', 'month', 'sched'];

/** The views that cannot be turned off: each form factor's home. */
export const ALWAYS_ON_VIEWS = ['multi', 'grid'];
/** The views a device may turn off, every form factor together (MONTH and SCHED are one view in both switchers). */
export const HIDEABLE_VIEWS = ['day', 'week', 'list', 'month', 'sched'];
/** The number key that jumps to each desktop view. */
export const VIEW_SHORTCUT_KEYS = { multi: '1', day: '2', week: '3', month: '4', sched: '5' };

/** A persisted or URL view value, or the fallback when it is not one we know (an older or newer build wrote it). */
export function resolveStoredView(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** The persisted hidden-views value as a clean list: known, hideable, no duplicates; anything else is ignored. */
export function normalizeHiddenViews(value) {
  if (!Array.isArray(value)) return [];
  return HIDEABLE_VIEWS.filter((v) => value.includes(v));
}

/** `views` minus the hidden ones; a home view stays whatever the list says. */
export function enabledViews(views, hidden = []) {
  return views.filter((v) => ALWAYS_ON_VIEWS.includes(v) || !hidden.includes(v));
}

/** The desktop cycler's states for the current width, minus MONTH while the Day Dial is up, minus the device's hidden views. */
export function cyclerStates(canShowViewCycler, dialActive = false, hidden = []) {
  const states = enabledViews(canShowViewCycler ? DESKTOP_VIEW_MODES : NARROW_DESKTOP_VIEW_MODES, hidden);
  return dialActive ? states.filter((v) => v !== 'month') : states;
}

/** The mobile toggle's states, minus MONTH while the Day Dial is up, minus the device's hidden views. */
export function mobileToggleStates(dialActive = false, hidden = []) {
  const states = enabledViews(MOBILE_VIEW_MODES, hidden);
  return dialActive ? states.filter((v) => v !== 'month') : states;
}

/** The state after `current` in `states`, wrapping; the first state when `current` is not in the list. */
export function nextState(states, current) {
  const idx = states.indexOf(current);
  return states[(idx + 1) % states.length];
}
