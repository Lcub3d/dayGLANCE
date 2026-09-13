// The app's view modes, in the order the switchers cycle through them.
//
// Desktop and landscape tablet use the ViewCycler over `viewMode`; phones and
// portrait tablets use the MobileViewToggle over `mobileViewMode`. MONTH is
// in both (it is the phone's case above all) and sits before SCHED, so the
// calendar views come first and the agenda last: 1 MULTI, 2 DAY, 3 WEEK,
// 4 MONTH, 5 SCHED. While the Day Dial is up (the kiosk runs it unattended)
// MONTH is left out of every switcher, so a day sheet cannot be opened with
// nobody there to dismiss it.

export const DESKTOP_VIEW_MODES = ['multi', 'day', 'week', 'month', 'sched'];
/** Narrow desktop and landscape tablet: DAY and WEEK need the 3-column grid. */
export const NARROW_DESKTOP_VIEW_MODES = ['multi', 'month', 'sched'];
export const MOBILE_VIEW_MODES = ['grid', 'list', 'month', 'sched'];

/** A persisted or URL view value, or the fallback when it is not one we know (an older or newer build wrote it). */
export function resolveStoredView(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** The desktop cycler's states for the current width, minus MONTH while the Day Dial is up. */
export function cyclerStates(canShowViewCycler, dialActive = false) {
  const states = canShowViewCycler ? DESKTOP_VIEW_MODES : NARROW_DESKTOP_VIEW_MODES;
  return dialActive ? states.filter((v) => v !== 'month') : states;
}

/** The mobile toggle's states, minus MONTH while the Day Dial is up. */
export function mobileToggleStates(dialActive = false) {
  return dialActive ? MOBILE_VIEW_MODES.filter((v) => v !== 'month') : MOBILE_VIEW_MODES;
}

/** The state after `current` in `states`, wrapping; the first state when `current` is not in the list. */
export function nextState(states, current) {
  const idx = states.indexOf(current);
  return states[(idx + 1) % states.length];
}
